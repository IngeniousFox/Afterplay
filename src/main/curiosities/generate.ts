import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { withDbAccess } from '../db';
import type { PendingCuriositiesGame } from '../db/queries/curiosities/getPendingCuriositiesGames';
import { storeCuriosities } from '../db/queries/curiosities/storeCuriosities';
import { getWikipediaArticle } from './wikipedia';

// La llamada al modelo. Una por juego EN LA VIDA: el resultado se guarda en
// la DB (sincroniza por Turso) y el modo ambiente lo lee de ahí para siempre.
//
// Haiku para TODO, y sin búsqueda web. Se probó con Sonnet + búsqueda para
// los juegos sin artículo de Wikipedia y salió carísimo y lentísimo: la
// variante de búsqueda con filtrado dinámico ejecuta código por debajo, el
// contenido de las páginas leídas entra en el contexto y se paga como
// entrada, y encima Sonnet 5 piensa por defecto (tokens de razonamiento a
// precio de salida). Un solo juego llegó a más de un euro. Sin búsqueda, el
// prompt es pequeño y cada juego cuesta una fracción de céntimo.
const MODEL = 'claude-haiku-4-5';

// Haiku 4.5 NO piensa salvo que se le pida explícitamente (thinking:
// {enabled, budget_tokens}) — omitir el parámetro, como aquí, significa "sin
// pensar", así que no hace falta margen para razonamiento. Sobra de sitio
// para un array de hasta 6 frases cortas.
const MAX_TOKENS = 2_048;

// Prompt caching: mirado y descartado para esta tarea. El mínimo cacheable en
// Haiku 4.5 es 4096 tokens — el más alto de toda la familia — y el system
// prompt de aquí abajo son ~300 tokens, muy por debajo. Lo único que sí pesa
// (el artículo de Wikipedia) es DISTINTO en cada juego, así que no hay ningún
// prefijo compartido que reutilizar entre llamadas. Poner cache_control no
// rompería nada, pero tampoco ahorraría un céntimo: el bloque nunca llegaría
// al mínimo y Anthropic lo ignora en silencio.

// Un cliente por clave, reutilizado entre llamadas: el backfill hace cientos
// de peticiones seguidas y construir uno nuevo cada vez tira la conexión y
// obliga a renegociar TLS en cada juego. Se rehace solo si la clave cambia
// (se puede editar en caliente desde Ajustes).
let cachedClient: { apiKey: string; client: Anthropic } | null = null;

const getClient = (apiKey: string): Anthropic => {
  if (cachedClient?.apiKey !== apiKey) {
    cachedClient = { apiKey, client: new Anthropic({ apiKey }) };
  }
  return cachedClient.client;
};

const SYSTEM_PROMPT = `You write trivia for Afterplay, a personal game-tracking app. Each fact appears alone on a big ambient screen, under the game's title, while the app idles — like a museum placard: quiet, true, interesting.

Write 3 to 6 curiosities about the game. Good curiosities are the kind a fan tells a friend: development stories, origins of the name or the idea, records and firsts, cut content, unexpected influences, cameos, cultural aftermath. Not marketing copy, not genre or release-date summaries, not review scores.

Accuracy rules — these outrank everything else:
- Only state facts that are widely documented. Prefer facts supported by the provided Wikipedia article when there is one.
- If you are not certain a fact is true for THIS exact game (not a sequel, remake or same-named game), leave it out. Returning fewer curiosities — or an empty list — is always better than including a dubious one.
- Never invent numbers, dates, names or quotes.

Style rules:
- English. One sentence each, under 180 characters.
- Start lowercase unless the first word is a proper noun (a name, studio, or title) — then keep its normal capital letter. No trailing period.
- Plain, warm, specific. No "did you know", no exclamation marks.
- Plain prose only. Never wrap any part of a sentence in <cite>, footnote markers, brackets or any other tag or citation apparatus — this is a single sentence on a screen, not a cited document.

Respond with ONLY a JSON array of strings. No other text before or after it.`;

const curiositiesSchema = z.array(z.string());

// Red de seguridad además de la regla del prompt: el modelo puede arrastrar la
// costumbre de citar sus fuentes con marcado tipo <cite index="21-1">...</cite>
// aunque nunca se le pidió — comprobado en curiosidades reales ya generadas.
// Se quita cualquier etiqueta, dejando el texto de dentro intacto, en vez de
// confiar solo en que el modelo obedezca la instrucción.
const stripTags = (text: string): string => text.replace(/<\/?[a-z][^>]*>/gi, '').trim();

// El modelo responde "solo el JSON", pero por si acaso envuelve el array en
// texto o en un fence, se recorta al primer '[' y al último ']'.
//
// null = NO SE PUDO interpretar la respuesta, que es distinto de un array
// vacío legítimo ("no conozco este juego, no digo nada"). La diferencia
// importa porque solo se llama una vez por juego en la vida: tratar un fallo
// de formato como "sin curiosidades" dejaría ese juego mudo para siempre sin
// que nadie se entere. Devolviendo null, quien llama lo trata como error y el
// juego se queda pendiente para otra pasada.
const parseCuriosities = (raw: string): string[] | null => {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = curiositiesSchema.parse(JSON.parse(raw.slice(start, end + 1)));
    return parsed
      .map((text) => stripTags(text))
      .filter((text) => text.length >= 20 && text.length <= 220)
      .slice(0, 6);
  } catch {
    return null;
  }
};

const buildUserPrompt = (
  game: PendingCuriositiesGame,
  article: { url: string; extract: string } | null,
): string => {
  const year = game.releaseYear ? ` (${game.releaseYear})` : '';
  const developer = game.developer ? ` by ${game.developer}` : '';
  const header = `Game: ${game.title}${year}${developer}`;

  if (article) {
    return `${header}\n\nWikipedia article (${article.url}):\n<article>\n${article.extract}\n</article>`;
  }
  return `${header}\n\nNo reference text is available for this game, so rely only on what you already know for certain about it. Most games in this situation are small or obscure — if you do not genuinely know this specific game, return an empty array. That is the expected answer here, not a failure.`;
};

const callClaude = async (
  apiKey: string,
  game: PendingCuriositiesGame,
  article: { url: string; extract: string } | null,
): Promise<string[]> => {
  // Una sola llamada, sin herramientas: no hay búsqueda que pueda pausar el
  // turno (`pause_turn` solo lo provocan las herramientas de servidor), así
  // que tampoco hace falta bucle de continuación.
  const response = await getClient(apiKey).messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(game, article) }],
  });

  // Un rechazo SÍ es una respuesta: el juego se marca como hecho y se queda
  // callado, en vez de reintentarse en cada pasada.
  if (response.stop_reason === 'refusal') return [];

  // Truncada a mitad de JSON. No se intenta rescatar el trozo: se trata como
  // error para que el juego siga pendiente. Con 6 frases cortas de tope no
  // debería pasar nunca, pero si pasara, guardar media lista sería peor.
  if (response.stop_reason === 'max_tokens') {
    throw new Error('respuesta truncada por max_tokens');
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const parsed = parseCuriosities(text);
  if (parsed === null) {
    throw new Error('no se pudo interpretar la respuesta del modelo como JSON');
  }
  return parsed;
};

// Genera y guarda. Devuelve cuántas frases salieron. Lanza si algo IMPIDIÓ
// generar (sin clave, red caída, credenciales de IGDB rotas): en ese caso el
// juego queda pendiente y se reintenta en otra pasada — solo un resultado
// real (aunque sea vacío) marca el juego como hecho.
export const generateCuriositiesForGame = async (game: PendingCuriositiesGame): Promise<number> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Anthropic API key not configured');

  const article = await getWikipediaArticle(game.igdbId);
  const texts = await callClaude(apiKey, game, article);

  await withDbAccess(() => storeCuriosities(game.id, texts));
  return texts.length;
};
