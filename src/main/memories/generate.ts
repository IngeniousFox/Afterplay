import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Chapter, ChapterScope } from '../../shared/memory/chapters';
import type { RecapPayload } from '../../shared/memory/payload';
import { withDbAccess } from '../db';
import { insertMemory } from '../db/queries/memories/insertMemory';
import { stripTags } from '../curiosities/stripTags';
import { chapterHash } from './hash';

// La llamada al modelo: los hechos de un periodo cerrado → su recap. Una por
// mes y otra por año en régimen normal (~13 al año, céntimos) — el resultado
// se guarda en la DB (sincroniza por Turso) y se lee de ahí para siempre.
//
// Sonnet 5 y sin herramientas. La lección de costes de las curiosidades
// sigue cocinada — sin búsqueda web (no hay nada que buscar, los hechos
// vienen ya calculados) y prompt pequeño — y eso es justo lo que hace a
// Sonnet asequible AQUÍ: lo que arruinó las curiosidades fue la búsqueda
// metiendo decenas de miles de tokens por juego, no la tarifa del modelo.
// Con ~1-2k de entrada y ~300 de salida, el recap sale a ~2 céntimos y el
// año normal (13 llamadas) a céntimos. Se cambió desde Haiku porque Haiku
// fallaba en fidelidad: derivaba ordinales mal y corría fechas un día.
//
// OJO al contrato de la API de Sonnet 5 (distinto del de Haiku 4.5):
//   · `temperature` no-default devuelve 400 — se omite y se gobierna con el
//     prompt (las reglas de exactitud del system prompt).
//   · El thinking va ACTIVADO por defecto (adaptativo). Se deja adaptativo
//     con effort 'low' — para una narración de 2k tokens piensa poco o nada,
//     y la guía de migración lo recomienda sobre apagarlo del todo.
export const MODEL = 'claude-sonnet-5';
// Con hueco para el thinking adaptativo (comparte tope con la respuesta) y
// para el tokenizador nuevo de Sonnet 5 (~30% más tokens por el mismo
// texto). Es un tope, no un gasto: solo se paga lo generado.
const MAX_TOKENS = 4_096;

// Versionado del prompt (§3.4). No es solo trazabilidad: un recap escrito
// con una versión anterior cuenta como desactualizado en Ajustes (status.ts)
// — la prosa se escribiría distinta hoy, y regenerarla sigue siendo decisión
// manual, como todo lo que cuesta dinero.
//
// v2 (2026-07-31): registrar juegos del pasado sin sesiones trackeadas es lo
// NORMAL en esta app, y la v1 lo trataba como noticia — titulares tipo "Two
// finishes, no playtime". Ahora el prompt lo explica de serie, no se le
// enseñan ceros al modelo, y las horas manuales van nombradas como "logged
// by hand" en vez de desaparecer.
//
// v3 (2026-07-31): Haiku derivaba ordinales por su cuenta sobre listas
// largas y fallaba — llamó "your last 2025 finish" a un juego de noviembre
// con tres finales de diciembre delante. La regla del diseño es que la IA
// nunca deriva, solo redacta: ahora el "último final del periodo" va YA
// CALCULADO y etiquetado en los hechos, y el prompt prohíbe inventarse
// primeros/últimos/rachas sin etiqueta. (En esta misma tanda el modelo pasó
// de Haiku a Sonnet 5 — ver MODEL; el cambio de modelo también cuenta como
// desactualización, ver status.ts.)
//
// v4 (2026-07-31): con Sonnet 5 a effort 'low', el mismo año de 19 finales
// volvió a fallar — esta vez CONTANDO la lista mal ("eighteen" en vez de
// 19). El total ahora también va precalculado (§ "Total finishes"), y el
// esfuerzo sube a 'medium' (ver la llamada más abajo).
export const PROMPT_VERSION = 4;

// Mismo truco de cliente reutilizado que curiosities/generate.ts: el backfill
// encadena decenas de llamadas y renegociar TLS en cada una es tirar tiempo.
let cachedClient: { apiKey: string; client: Anthropic } | null = null;

const getClient = (apiKey: string): Anthropic => {
  if (cachedClient?.apiKey !== apiKey) {
    cachedClient = { apiKey, client: new Anthropic({ apiKey }) };
  }
  return cachedClient.client;
};

// Las lecciones de la v1 cocinadas de serie (§3.4): segunda persona, cálido y
// concreto; los hechos se AFIRMAN (nunca se cuestionan ni se especula sobre
// por qué un número es como es); prohibido cubrirse, prohibido el juego de
// palabras forzado, prohibida cualquier etiqueta. JSON exacto y nada más.
const SYSTEM_PROMPT = `You write the recap of a period of someone's gaming life for Afterplay, a personal game-tracking app. You receive the verified facts of a closed month or year — hours, sessions, games, finishes, notable moments — and turn them into a short, warm recap addressed to the player in second person.

About the data: Afterplay tracks play sessions automatically, but people routinely log games from their past by hand — a finish date, or a block of hours, with no tracked sessions behind it. That is ordinary bookkeeping in this app, not part of the story. Never point out missing, low or unmeasured play time; never contrast a finish against its recorded hours; never suggest the player barely played or didn't play. Tell the story of what is there, and simply leave out what isn't.

Accuracy rules — these outrank everything else:
- Every number, title and date you mention must come from the provided facts. Never invent, estimate or extrapolate anything.
- State the facts plainly. Never question them, never speculate about why a number is what it is, never guess at feelings or reasons.
- Never derive orderings yourself: no "first", "last", "earliest", "latest", "busiest" or streak claims unless the fact list labels that exact thing explicitly. If a fact is labeled (for example "the period's last finish"), you may use it as labeled.
- If the period has little to tell, write less. Short and modest always beats filler.

Style rules:
- English. Warm, concrete and plain — a friend who remembers, not a year-in-review ad.
- No hedging ("maybe", "either... or", "which means"). No forced wordplay. No exclamation marks.
- Plain prose only: no markdown, no <cite>, no tags or citation apparatus of any kind.

Respond with ONLY a JSON object in exactly this shape, no other text before or after:
{
  "headline": "a short title for the period, under 60 characters, no trailing period",
  "narrative": "the story of the period in 2 to 4 sentences, second person",
  "highlights": ["0 to 3 short standalone lines worth keeping — records, returns, finishes; use [] if nothing stands out"],
  "closingLine": "one quiet sentence to close"
}`;

const payloadSchema = z.object({
  headline: z.string(),
  narrative: z.string(),
  highlights: z.array(z.string()),
  closingLine: z.string(),
});

// "June 2026" para meses, "the year 2026" para años — como se lee en el
// prompt. El renderer tiene su propio formateo; esto es solo para hablar con
// el modelo y para las etiquetas de progreso.
export const scopeLabel = (scope: ChapterScope): string =>
  scope.type === 'month'
    ? new Date(scope.year, scope.month, 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : String(scope.year);

const shortDate = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

const hoursText = (hours: number): string => `${Math.round(hours * 10) / 10} hours`;

// Los hechos del capítulo, en líneas que el modelo no pueda malinterpretar.
// AQUÍ está la frontera de privacidad (§3.5): cifras, títulos, fechas y
// momentos — jamás notas de sesión, rutas, ejecutables ni nada de la máquina.
const buildUserPrompt = (chapter: Chapter): string => {
  const scope: ChapterScope =
    chapter.month === null
      ? { type: 'year', year: chapter.year }
      : { type: 'month', year: chapter.year, month: chapter.month };

  const lines: string[] = [];
  lines.push(
    chapter.month === null
      ? `Period: the year ${chapter.year}`
      : `Period: ${scopeLabel(scope)} (one month)`,
  );
  // Solo se cuenta lo que EXISTE: un periodo sin sesiones trackeadas no
  // enseña ningún "0 hours" que el modelo pueda convertir en titular — la
  // lección de la v1 ("Two finishes, no playtime"). Las horas manuales van
  // nombradas como lo que son, nunca disfrazadas de sesiones.
  const measuredHours = chapter.hours - chapter.manualHours;
  if (chapter.sessionCount > 0) {
    lines.push(
      `Tracked play: ${hoursText(measuredHours)} across ${chapter.sessionCount} ${chapter.sessionCount === 1 ? 'session' : 'sessions'}.`,
    );
  }
  if (chapter.manualHours > 0) {
    lines.push(`Logged by hand (past or untracked play): ${hoursText(chapter.manualHours)}.`);
  }

  if (chapter.games.length > 0) {
    lines.push('Games played, most time first:');
    // Un año cargado puede tocar decenas de juegos: el modelo no necesita la
    // cola infinita para contar la historia, y el prompt se paga por token.
    const shown = chapter.games.slice(0, 12);
    for (const game of shown) {
      const measured = game.hours - game.manualHours;
      const parts: string[] = [];
      if (game.sessionCount > 0) {
        parts.push(
          `${hoursText(measured)} in ${game.sessionCount} ${game.sessionCount === 1 ? 'session' : 'sessions'}`,
        );
      }
      if (game.manualHours > 0) parts.push(`${hoursText(game.manualHours)} logged by hand`);
      lines.push(`- ${game.title}: ${parts.join(' plus ')}`);
    }
    if (chapter.games.length > shown.length) {
      lines.push(`- ...and ${chapter.games.length - shown.length} more games with less time`);
    }
  }

  if (chapter.completions.length > 0) {
    // El total y el ordinal van calculados y etiquetados AQUÍ (la IA nunca
    // deriva, §1) — dos fallos reales de esta misma tanda: dedujo mal "el
    // último" sobre una lista de 19 finales (se quedó con uno de noviembre
    // con tres de diciembre detrás), y luego CONTÓ mal esa misma lista
    // ("eighteen" en vez de 19). Ninguno de los dos números se le vuelve a
    // pedir que los saque él — el prompt se los da hechos y prohíbe tocarlos.
    lines.push(
      `Total finishes: ${chapter.completions.length}. Use this exact number if you state a count — do not count the list below yourself.`,
    );
    lines.push('Finished, in chronological order:');
    chapter.completions.forEach((completion, index) => {
      const label = index === chapter.completions.length - 1 ? " — the period's last finish" : '';
      lines.push(`- ${completion.title} (${shortDate(completion.occurredAt)})${label}`);
    });
  }

  if (chapter.moments.length > 0) {
    lines.push('Notable moments:');
    for (const moment of chapter.moments) {
      const title = chapter.games.find((game) => game.gameId === moment.gameId)?.title ?? 'a game';
      const when = shortDate(moment.occurredAt);
      switch (moment.type) {
        case 'first_session':
          lines.push(`- First session with ${title} (${when})`);
          break;
        case 'return':
          lines.push(`- Back to ${title} after ${moment.awayDays} days away (${when})`);
          break;
        case 'longest_session':
          lines.push(
            `- New longest session with ${title}: ${hoursText(moment.durationSec / 3600)} (${when})`,
          );
          break;
        case 'hours_milestone':
          lines.push(`- Crossed ${moment.hours} total hours with ${title} (${when})`);
          break;
        case 'sessions_milestone':
          lines.push(`- Session number ${moment.count} with ${title} (${when})`);
          break;
      }
    }
  }

  return lines.join('\n');
};

// null = respuesta ininterpretable — distinto de un payload legítimo. Quien
// llama lo trata como error y el periodo sigue pendiente para otra pasada
// (mismo contrato que parseCuriosities).
const parsePayload = (raw: string): RecapPayload | null => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = payloadSchema.parse(JSON.parse(raw.slice(start, end + 1)));
    const clean = (text: string, max: number): string => stripTags(text).slice(0, max).trim();
    const payload: RecapPayload = {
      headline: clean(parsed.headline, 120),
      narrative: clean(parsed.narrative, 1200),
      highlights: parsed.highlights
        .map((line) => clean(line, 220))
        .filter((line) => line.length > 0)
        .slice(0, 3),
      closingLine: clean(parsed.closingLine, 300),
    };
    // Sin titular o sin historia no hay recap que guardar: mejor reintentar
    // en otra pasada que enseñar un panel vacío para siempre.
    if (payload.headline.length === 0 || payload.narrative.length === 0) return null;
    return payload;
  } catch {
    return null;
  }
};

// Genera y guarda el recap de UN capítulo. Lanza si algo impidió generar
// (sin clave, red, respuesta rota): el periodo queda pendiente y otra pasada
// lo recoge — solo un payload real marca el periodo como contado.
export const generateMemoryForChapter = async (chapter: Chapter): Promise<void> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key not configured');

  // Sin `temperature`: Sonnet 5 rechaza valores no-default (400). La
  // fidelidad a los hechos se gobierna desde el prompt (reglas de exactitud
  // + ordinales precalculados), que además es la palanca que sí escala.
  const response = await getClient(apiKey).messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    // 'low' se quedó corto dos veces (dedujo mal un ordinal, luego contó mal
    // una lista de 19): la guía del SDK avisa de que a ese nivel Sonnet 5
    // recorta verificación en tareas moderadamente complejas, y contar bien
    // una lista es justo eso. 'medium' cuesta lo mismo por token — el coste
    // real es que piense un poco más, y aquí hablamos de céntimos al año.
    output_config: { effort: 'medium' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(chapter) }],
  });

  if (response.stop_reason === 'max_tokens') {
    throw new Error('respuesta truncada por max_tokens');
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const payload = parsePayload(text);
  if (payload === null) {
    throw new Error('no se pudo interpretar la respuesta del modelo como payload de recap');
  }

  await withDbAccess(() =>
    insertMemory({
      scopeType: chapter.scopeType,
      scopeKey: chapter.scopeKey,
      payload,
      sourceHash: chapterHash(chapter),
      model: MODEL,
      promptVersion: PROMPT_VERSION,
    }),
  );
};
