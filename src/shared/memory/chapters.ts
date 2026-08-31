// Los capítulos del Loop (AFTERPLAY-LOOP.md §2.2): los hechos de un periodo
// — mes o año — agregados en local, gratis y sin IA. Son la materia prima de
// los recaps (el main los convierte en prosa UNA vez por periodo cerrado) y
// de cualquier cifra local que hable de "tu junio".
//
// Mismas reglas de datos que Stats, heredadas y no reinventadas:
//   · Bucketing por startedAt en hora LOCAL — una sesión que cruza la
//     medianoche (o el fin de mes) cuenta entera en su día de inicio.
//   · Sesiones manuales fuera: un capítulo narra tiempo jugado de verdad,
//     y las filas manuales llevan fechas gruesas (año/mes) que caerían todas
//     en un "1 de enero" mentiroso.
//   · Sesiones de emulador sin asignar (iterationId null) ni llegan aquí:
//     no pertenecen a ningún juego, quien alimenta esta lib ya las filtró.
//
// Lib PURA, como moments.ts: sin DB, sin Electron, testable a pelo.

import { isAddedAtArtifact } from '../playthroughState';
import type { MemorySession, Moment } from './moments';

export type ChapterScope =
  | { type: 'month'; year: number; month: number } // month 0-11, como Date
  | { type: 'year'; year: number };

// '2026-06' para meses, '2026' para años — la clave con la que la tabla
// generated_memories identifica el periodo (§3.1).
export const scopeKeyOf = (scope: ChapterScope): string =>
  scope.type === 'month'
    ? `${scope.year}-${String(scope.month + 1).padStart(2, '0')}`
    : String(scope.year);

// El rango [start, end) del periodo en hora local — la misma vara de medir
// que usa Stats para todo (AFTERPLAY-LOOP.md §7.3).
export const scopeRange = (scope: ChapterScope): { start: Date; end: Date } =>
  scope.type === 'month'
    ? {
        start: new Date(scope.year, scope.month, 1),
        end: new Date(scope.year, scope.month + 1, 1),
      }
    : { start: new Date(scope.year, 0, 1), end: new Date(scope.year + 1, 0, 1) };

export type ChapterGameFacts = {
  gameId: number;
  title: string;
  // Total del periodo: medidas + registradas a mano. Las manuales van también
  // desglosadas en manualHours para que el prompt pueda decir "logged by
  // hand" en vez de fingir que hubo sesiones.
  hours: number;
  sessionCount: number;
  manualHours: number;
};

// Un bloque de horas manuales ("I played this before") con su ancla de
// calendario — la fecha que decide en qué capítulo cuentan. El ancla sale de
// manualHoursAnchor (shared/playthroughState): el fin del playthrough si lo
// tiene, si no su inicio — la MISMA regla que ya usan Stats y el Journey, y
// por eso el capítulo tiene que contarlas igual: su panel de historia se
// pinta justo al lado de esas carátulas. null = playthrough sin fechas, esas
// horas no pertenecen a ningún periodo.
export type ManualBlock = {
  gameId: number;
  hours: number;
  anchor: Date | null;
};

export type ChapterCompletion = {
  gameId: number;
  title: string;
  occurredAt: Date;
};

// Los OTROS cambios de estado del periodo: empezaste algo, lo aparcaste, lo
// dejaste, lo pusiste a descansar, lo apuntaste para jugar. Antes solo
// contaban los 'completed' y el resto no existía para el Loop — y había 48
// meses cerrados (los de "ese mes empecé tres cosas y no cronometré nada")
// que no aparecían como generables en ningún sitio, aunque el Journey sí les
// abría página. Un cambio de estado ES historia: decidir empezar o soltar un
// juego dice tanto como las horas.
export type ChapterStateChange = {
  gameId: number;
  title: string;
  type: string;
  occurredAt: Date;
};

// Evento de estado con lo mínimo que un capítulo necesita — estructural, para
// que StateEventSummary (renderer) y las filas del main encajen sin adaptar.
export type ChapterStateEvent = {
  gameId: number;
  type: string;
  occurredAt: Date;
  // Cuándo se dio de alta el juego, lo único que hace falta para reconocer el
  // papeleo del alta (ver isMeaningfulStateEvent). Sigue siendo opcional
  // porque un dato que falta no puede borrar historia, pero YA LO TRAE quien
  // alimenta al Loop: getMemoryFacts (main/db/queries/memories/getMemoryFacts.ts)
  // cuelga games.addedAt de cada evento. Antes no lo traía nadie y la mitad
  // "alta" del filtro no llegaba a aplicarse nunca en la app.
  addedAt?: Date | null;
  // Y el sello del promote — la segunda puerta del papeleo (ver
  // isAddedAtArtifact): promocionar un planeado escribe sus eventos meses
  // despues de addedAt, y sin esta marca abrian capitulo del Loop.
  promotedAt?: Date | null;
};

// "Aquí pasó algo de verdad", el mismo criterio que el Journey
// (meaningfulEvents, renderer/src/lib/journeyEntries.ts): fuera 'plan_to_play',
// que es intención y no juego, y fuera lo que caiga pegado al alta del juego,
// que es un efecto secundario de darlo de alta y no un hito.
//
// El margen del alta NO se escribe aquí: se pregunta a isAddedAtArtifact
// (shared/playthroughState), que es donde está el porqué y el número. Esta
// función llegó a llevar su propia copia del 5_000, igual que el Journey y que
// el worker — cuatro copias que coincidían por costumbre y que nada obligaba a
// seguir coincidiendo.
//
// Vive aquí porque el Loop y el Journey tienen que estar de acuerdo en qué
// meses existen: meter 30 juegos viejos marcados "Beaten" sin teclear fechas
// abría marzo en el Loop y le cobraba un recap ("you finished thirty games in
// March") de un mes en el que el Journey no pinta NI UNA carátula, así que ese
// recap pagado no se podía leer en ninguna parte.
//
// Peaje que se paga UNA vez: un mes que llevara dentro un 'plan_to_play' —o,
// desde que el addedAt llega de verdad, papeleo de altas— cambia sus hechos,
// así que su firma cambia y su recap sale obsoleto la primera vez que se mira.
// Es correcto —esa prosa narraba algo que ya no cuenta como hecho—, pero si
// aparece una tanda de obsoletos sin haber tocado nada, viene de aquí.
export const isMeaningfulStateEvent = (event: ChapterStateEvent): boolean =>
  event.type !== 'plan_to_play' &&
  !isAddedAtArtifact(event.occurredAt, event.addedAt, event.promotedAt);

// Un desbloqueo tal como llega del main (getMemoryFacts): ya FUNDIDO por
// logro entre fuentes. Solo entran aquí los de fecha FIABLE — la regla 1 de
// LOGROS-IDEAS.md: una fecha de rescate no fabrica historia en un mes.
export type ChapterUnlock = {
  gameId: number;
  name: string;
  // La descripción es el hecho NARRATIVO: "Reached the summit" cuenta la
  // escalada. Puede faltar (ocultos sin fuente de descripción).
  description: string | null;
  globalPercent: number | null;
  unlockedAt: Date;
};

// Los logros del periodo, YA CURADOS (LOGROS-IDEAS.md §2.3): totales como
// hechos cerrados y un puñado de destacados citables — jamás la lista entera
// (las lecciones v3/v4 del prompt: sobre listas largas el modelo cuenta y
// deriva mal).
export type ChapterAchievements = {
  total: number;
  rareCount: number;
  // Hasta media docena, los más raros primero — cada uno con lo que el
  // modelo puede citar tal cual. El título del juego viaja resuelto: el
  // logro puede ser de un juego SIN sesiones en el periodo (desbloqueado en
  // otro PC, o jugando sin la app) y entonces no está en chapter.games.
  highlights: {
    gameId: number;
    gameTitle: string;
    name: string;
    description: string | null;
    globalPercent: number | null;
  }[];
};

export type Chapter = {
  scopeType: 'month' | 'year';
  scopeKey: string;
  year: number;
  // null en capítulos de año.
  month: number | null;
  // El periodo aún no ha cerrado: sus cifras sirven en local, pero NUNCA se
  // narra (§3.4) — cambiaría bajo tus pies.
  soFar: boolean;
  hours: number;
  sessionCount: number;
  // Parte de `hours` que llegó registrada a mano (bloques manuales anclados
  // en este periodo) — el prompt la nombra aparte, nunca como sesiones.
  manualHours: number;
  // Ordenados por horas desc — games[0] es el dominante.
  games: ChapterGameFacts[];
  dominant: ChapterGameFacts | null;
  completions: ChapterCompletion[];
  // Los demás cambios de estado del periodo (ver ChapterStateChange), en
  // orden cronológico. Los 'completed' NO se repiten aquí: ya están arriba.
  stateChanges: ChapterStateChange[];
  // Los momentos que cayeron dentro del periodo. Se derivan FUERA (sobre la
  // historia completa, ver moments.ts) y aquí solo se filtran: un récord no
  // se puede calcular mirando un mes suelto.
  moments: Moment[];
  // Los logros del periodo, curados (ver ChapterAchievements). null = ninguno
  // con fecha fiable dentro del rango. Alimenta el prompt (generate.ts) pero
  // NO sella el capítulo todavía: la firma que se sella hoy no los mira, así
  // que un desbloqueo que aparezca meses después en un mes viejo no marca su
  // recap como obsoleto. Está a medio camino a propósito y el porqué está
  // contado en canonicalChapterFacts — leerlo antes de "arreglarlo".
  achievements: ChapterAchievements | null;
};

const isMeasured = (session: MemorySession): boolean =>
  !session.isManual && session.endedAt !== null && (session.durationSec ?? 0) > 0;

const inRange = (date: Date, start: Date, end: Date): boolean => date >= start && date < end;

// Orden por unidades de código UTF-16 y no localeCompare: el colador del
// sistema depende de la locale y de la versión de ICU que traiga cada Electron,
// y a nivel primario declara IGUALES cadenas distintas (una "é" precompuesta y
// su forma combinante, mayúsculas y minúsculas según el idioma). Los nombres de
// logro son Unicode arbitrario, así que es un riesgo real: se usan para decidir
// qué logros se citan y para desempatar dentro de la firma de hechos, y este
// fichero ya se cuida (ver localDate) de que dos máquinas del mismo usuario
// calculen lo MISMO. Un desempate no puede ser lo que rompa esa promesa.
const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Construye el capítulo de un periodo, o null si no hay NADA que contar (ni
// sesiones medidas, ni completados, ni horas manuales ancladas dentro): un
// mes vacío no produce capítulo, igual que no producirá recap (§3.4 — sin
// historia no se inventa nada).
export const buildChapter = (
  scope: ChapterScope,
  sessions: MemorySession[],
  events: ChapterStateEvent[],
  titlesByGame: ReadonlyMap<number, string>,
  moments: Moment[],
  now: Date,
  manualBlocks: ManualBlock[] = [],
  unlocks: ChapterUnlock[] = [],
): Chapter | null => {
  const { start, end } = scopeRange(scope);
  const titleOf = (gameId: number): string => titlesByGame.get(gameId) ?? 'an untitled game';

  const perGame = new Map<number, ChapterGameFacts>();
  let hours = 0;
  let sessionCount = 0;
  let manualHours = 0;

  for (const session of sessions) {
    if (!isMeasured(session) || !inRange(session.startedAt, start, end)) continue;
    const sessionHours = (session.durationSec ?? 0) / 3600;
    hours += sessionHours;
    sessionCount++;

    const entry = perGame.get(session.gameId) ?? {
      gameId: session.gameId,
      title: titleOf(session.gameId),
      hours: 0,
      sessionCount: 0,
      manualHours: 0,
    };
    entry.hours += sessionHours;
    entry.sessionCount++;
    perGame.set(session.gameId, entry);
  }

  // Las horas manuales ancladas en el periodo cuentan como tiempo del
  // periodo — la misma atribución que Stats y el Journey, para que el recap
  // no diga "no playtime" de un mes cuyas carátulas enseñan 30 horas.
  for (const block of manualBlocks) {
    if (block.anchor === null || block.hours <= 0 || !inRange(block.anchor, start, end)) continue;
    hours += block.hours;
    manualHours += block.hours;

    const entry = perGame.get(block.gameId) ?? {
      gameId: block.gameId,
      title: titleOf(block.gameId),
      hours: 0,
      sessionCount: 0,
      manualHours: 0,
    };
    entry.hours += block.hours;
    entry.manualHours += block.hours;
    perGame.set(block.gameId, entry);
  }

  // Ni las intenciones ni el papeleo del alta son hechos del periodo: el
  // capítulo tiene que contar lo mismo que el Journey pinta al lado. Las dos
  // mitades del filtro se aplican de verdad desde que los eventos llegan con
  // su addedAt — el porqué, en isMeaningfulStateEvent.
  const realEvents = events.filter(isMeaningfulStateEvent);

  const completions: ChapterCompletion[] = realEvents
    .filter((event) => event.type === 'completed' && inRange(event.occurredAt, start, end))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((event) => ({
      gameId: event.gameId,
      title: titleOf(event.gameId),
      occurredAt: event.occurredAt,
    }));

  const stateChanges: ChapterStateChange[] = realEvents
    .filter((event) => event.type !== 'completed' && inRange(event.occurredAt, start, end))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((event) => ({
      gameId: event.gameId,
      title: titleOf(event.gameId),
      type: event.type,
      occurredAt: event.occurredAt,
    }));

  // Un mes en el que SOLO decidiste cosas (empezar, aparcar, soltar) también
  // tiene capítulo: sin esto era invisible para el Loop y no había forma de
  // pedirle su historia.
  if (
    sessionCount === 0 &&
    completions.length === 0 &&
    manualHours === 0 &&
    stateChanges.length === 0
  ) {
    return null;
  }

  const games = [...perGame.values()].sort(
    (a, b) => b.hours - a.hours || b.sessionCount - a.sessionCount || a.gameId - b.gameId,
  );

  // Los logros del periodo, curados aquí (el código deriva, la IA redacta):
  // total y cuenta de raros como hechos cerrados, y como citables solo los
  // más raros — un tope corto a propósito, la lista entera es justo lo que
  // el modelo maneja mal. Los logros NO abren capítulo por sí solos (la
  // guarda de "mes vacío" de arriba no los mira): un desbloqueo suelto de un
  // mes sin sesiones ni decisiones no sostiene una historia.
  const periodUnlocks = unlocks.filter((unlock) => inRange(unlock.unlockedAt, start, end));
  const rareUnlocks = periodUnlocks.filter(
    (unlock) => unlock.globalPercent !== null && unlock.globalPercent < 10,
  );
  const achievements: ChapterAchievements | null =
    periodUnlocks.length === 0
      ? null
      : {
          total: periodUnlocks.length,
          rareCount: rareUnlocks.length,
          highlights: [...periodUnlocks]
            // Los empates se rompen por juego y nombre a propósito: con el
            // solo criterio de rareza, QUÉ seis logros sobreviven al slice
            // dependería del orden en que la DB los devolvió, y el mismo mes
            // regenerado dos veces citaría logros distintos sin que nada
            // hubiera cambiado. (Sellar, no sellan: ver canonicalChapterFacts.)
            .sort(
              (a, b) =>
                (a.globalPercent ?? Number.POSITIVE_INFINITY) -
                  (b.globalPercent ?? Number.POSITIVE_INFINITY) ||
                a.gameId - b.gameId ||
                byCodeUnits(a.name, b.name),
            )
            .slice(0, 6)
            .map((unlock) => ({
              gameId: unlock.gameId,
              gameTitle: titleOf(unlock.gameId),
              name: unlock.name,
              description: unlock.description,
              globalPercent: unlock.globalPercent,
            })),
        };

  return {
    scopeType: scope.type,
    scopeKey: scopeKeyOf(scope),
    year: scope.year,
    month: scope.type === 'month' ? scope.month : null,
    soFar: end.getTime() > now.getTime(),
    hours,
    sessionCount,
    manualHours,
    games,
    dominant: games[0] ?? null,
    completions,
    stateChanges,
    moments: moments.filter((moment) => inRange(moment.occurredAt, start, end)),
    achievements,
  };
};

// Todos los periodos CERRADOS con actividad, ascendentes — la lista contra la
// que la detección automática y el backfill comparan lo ya generado (§3.3).
// El periodo en curso queda fuera por definición de "cerrado".
export const listClosedPeriodsWithActivity = (
  sessions: MemorySession[],
  events: ChapterStateEvent[],
  now: Date,
  manualBlocks: ManualBlock[] = [],
): { months: ChapterScope[]; years: ChapterScope[] } => {
  // year*12+month — la clave comparable de meses que ya usa dateMath.ts en el
  // renderer (duplicada aquí porque shared no puede tirar del renderer).
  const activityKeys = new Set<number>();
  for (const session of sessions) {
    if (!isMeasured(session)) continue;
    activityKeys.add(session.startedAt.getFullYear() * 12 + session.startedAt.getMonth());
  }
  // CUALQUIER cambio de estado REAL abre mes, no solo los completados:
  // empezar, aparcar o soltar un juego es historia igual (ver
  // ChapterStateChange). "Real" es lo que dice isMeaningfulStateEvent, la
  // misma vara con la que el Journey abre página — las dos pantallas tienen
  // que estar de acuerdo en qué meses existen. Durante un tiempo NO lo
  // estuvieron: los eventos llegaban sin addedAt, solo caía el 'plan_to_play',
  // y el Loop abría (y cobraba recap de) meses cuyo único contenido era el
  // papeleo de dar juegos de alta.
  for (const event of events) {
    if (!isMeaningfulStateEvent(event)) continue;
    activityKeys.add(event.occurredAt.getFullYear() * 12 + event.occurredAt.getMonth());
  }
  // Un mes cuyo único contenido son horas manuales también tiene historia
  // ("ese mes te pasaste Elden Ring, 90 horas") — misma vara que buildChapter.
  for (const block of manualBlocks) {
    if (block.anchor === null || block.hours <= 0) continue;
    activityKeys.add(block.anchor.getFullYear() * 12 + block.anchor.getMonth());
  }

  const currentKey = now.getFullYear() * 12 + now.getMonth();
  const closedKeys = [...activityKeys].filter((key) => key < currentKey).sort((a, b) => a - b);

  const months: ChapterScope[] = closedKeys.map((key) => ({
    type: 'month',
    year: Math.floor(key / 12),
    month: key % 12,
  }));

  const yearSet = new Set<number>();
  for (const key of closedKeys) {
    const year = Math.floor(key / 12);
    if (year < now.getFullYear()) yearSet.add(year);
  }
  const years: ChapterScope[] = [...yearSet]
    .sort((a, b) => a - b)
    .map((year) => ({
      type: 'year',
      year,
    }));

  return { months, years };
};

// 'YYYY-MM-DD' en hora LOCAL — la fecha tal y como la vivió quien jugó. Nada
// de toISOString(): esa va en UTC y una sesión de las 00:30 cambiaría de día
// (y por tanto de hash) según la zona horaria de la máquina que calcule.
const localDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

// La forma canónica de los hechos de un capítulo: una cadena determinista que
// el main convierte en SHA-256 (sourceHash, §3.1). Es lo que permite saber si
// un recap sigue contando la verdad — corregir el pasado cambia los hechos,
// cambia esta cadena, y el periodo pasa a "stale" sin mirar la prosa.
//
// Reglas para que el hash sea estable de verdad:
//   · Horas redondeadas a 2 decimales — el ruido flotante de sumar en otro
//     orden no puede marcar un periodo como desactualizado.
//   · Fechas en local y solo a nivel de día — la hora exacta de un evento no
//     cambia la historia que se narra.
//   · Arrays con orden fijo (ya vienen ordenados de buildChapter; aquí se
//     reordenan por si acaso, que un hash no debe fiarse de nadie), y los
//     desempates de texto por unidades de código (byCodeUnits) y nunca por el
//     colador del sistema — mismo motivo que localDate: dos máquinas del mismo
//     usuario tienen que sacar el mismo hex.
//
// Las GENERACIONES de la firma existen por COMPATIBILIDAD, no por gusto: cada
// vez que un hecho nuevo entra en la cadena, TODOS los recaps ya escritos dejan
// de casar y aparecen obsoletos de golpe — decenas de regeneraciones que
// cuestan dinero para reescribir prosa que estaba bien. Por eso una firma que
// ya ha sellado recaps no se toca ni se "mejora" jamás: se añade otra al lado y
// status.ts acepta cualquiera de ellas (ver allí el precio de aceptar las
// viejas: un hecho que la firma vieja no lleva nunca marcará obsoleto a un
// recap sellado con ella).
//
//   · 'noDecisions'    — la primera, anterior a que empezar/aparcar/soltar
//                        fueran hechos del capítulo. Congelada. hash.ts la pide
//                        como `false` (legacyChapterHash).
//   · 'noAchievements' — la que se sella y se compara HOY; por eso es el
//                        default, que es como la llama hash.ts (chapterHash).
//   · 'full'           — añade los logros. Todavía no la pide nadie, y
//                        encenderla NO es cambiar este default a solas: ver el
//                        bloque de logros de aquí abajo.
export type ChapterFactsGeneration = 'full' | 'noAchievements' | 'noDecisions';

export const canonicalChapterFacts = (
  chapter: Chapter,
  generation: ChapterFactsGeneration | boolean = 'noAchievements',
): string => {
  // El parámetro nació booleano (`withStateChanges`) y hash.ts sigue llamando
  // con `false`: se sigue aceptando tal cual en vez de arrastrar a un fichero
  // ajeno a un renombre.
  const wanted: ChapterFactsGeneration =
    generation === true ? 'noAchievements' : generation === false ? 'noDecisions' : generation;
  const withStateChanges = wanted !== 'noDecisions';
  const round = (value: number): number => Math.round(value * 100) / 100;

  const stateChanges = chapter.stateChanges
    .slice()
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.gameId - b.gameId ||
        // Por unidades de código como todo lo que entra en la firma (ver
        // byCodeUnits). Aquí no cambia ninguna cadena ya sellada: los tipos son
        // un puñado de identificadores ASCII que salen igual con las dos varas,
        // y este desempate solo entra si dos eventos del MISMO juego caen en el
        // mismo milisegundo.
        byCodeUnits(a.type, b.type),
    )
    .map((change) => ({
      id: change.gameId,
      type: change.type,
      on: localDate(change.occurredAt),
    }));

  // Los logros son lo que MÁS se rellena a posteriori: conectas RA en agosto y
  // entran 40 desbloqueos con fecha de junio. La firma que se sella hoy no los
  // mira, así que el hash de junio sale idéntico, el recap se queda para
  // siempre sin mencionarlos y Ajustes sigue diciendo "0 desactualizados".
  // Sellarlos es la única forma de que ese relleno marque el mes.
  //
  // Se sella SOLO cuántos cayeron. Nada que salga de globalPercent: ni la
  // cuenta de raros (que no es más que un filtro sobre el porcentaje — un
  // recálculo de Steam que cruce el 10% movería el hash sin que tú hayas
  // tocado el mando) ni QUÉ seis destacan (se eligen ordenando por rareza, así
  // que los mueve el mismo ruido). El precio, dicho claro: si Steam re-puntúa,
  // el recap puede seguir diciendo "three of them rare" cuando hoy serían dos y
  // nada lo marcará; a cambio, ningún mes se marca obsoleto por una cifra que
  // mueve un servidor ajeno. Un intercambio exacto (un desbloqueo sale del mes
  // y otro entra) tampoco mueve el total y tampoco marca — es rarísimo al lado
  // de los rellenos masivos, que son el caso que duele.
  //
  // Y HOY NO SELLA NADA: la clave solo sale en la generación 'full', que no
  // pide nadie. Encenderla es un cambio de tres ficheros A LA VEZ — este, y
  // main/memories/hash.ts + status.ts para que status acepte ADEMÁS la firma
  // 'noAchievements'. Si se enciende sin eso, todo recap ya escrito de un mes
  // con logros pasa a obsoleto de un día para otro: justo lo que la escalera
  // de generaciones existe para evitar.
  const achievements =
    wanted === 'full' && chapter.achievements ? { total: chapter.achievements.total } : null;

  return JSON.stringify({
    scope: chapter.scopeKey,
    hours: round(chapter.hours),
    sessions: chapter.sessionCount,
    games: chapter.games
      .slice()
      .sort((a, b) => a.gameId - b.gameId)
      .map((game) => ({
        id: game.gameId,
        title: game.title,
        hours: round(game.hours),
        sessions: game.sessionCount,
        manual: round(game.manualHours),
      })),
    completions: chapter.completions
      .slice()
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.gameId - b.gameId)
      .map((completion) => ({ id: completion.gameId, on: localDate(completion.occurredAt) })),
    // Las decisiones entran en el hash como cualquier otro hecho — salvo
    // cuando se está reconstruyendo 'noDecisions' para comparar con un recap
    // escrito antes de que existieran (ver la cabecera). La clave va aquí en
    // medio a propósito: JSON.stringify respeta el orden de inserción y una
    // generación vieja tiene que salir carácter por carácter como salía
    // entonces.
    ...(withStateChanges ? { stateChanges } : {}),
    moments: chapter.moments
      .slice()
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.sessionId - b.sessionId)
      .map((moment) => ({
        type: moment.type,
        game: moment.gameId,
        on: localDate(moment.occurredAt),
        detail:
          moment.type === 'return'
            ? moment.awayDays
            : moment.type === 'longest_session'
              ? moment.durationSec
              : moment.type === 'hours_milestone'
                ? moment.hours
                : moment.type === 'sessions_milestone'
                  ? moment.count
                  : 0,
      })),
    // Al final y solo en 'full': las generaciones anteriores tienen que salir
    // carácter por carácter como salían cuando se escribieron aquellos recaps.
    ...(achievements ? { achievements } : {}),
  });
};
