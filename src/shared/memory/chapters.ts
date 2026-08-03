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
};

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
  // con fecha fiable dentro del rango. Entra en el sourceHash como todo lo
  // demás: un desbloqueo nuevo en un mes viejo deja su recap 'stale', que es
  // exactamente lo que significa "los hechos cambiaron".
  achievements: ChapterAchievements | null;
};

const isMeasured = (session: MemorySession): boolean =>
  !session.isManual && session.endedAt !== null && (session.durationSec ?? 0) > 0;

const inRange = (date: Date, start: Date, end: Date): boolean => date >= start && date < end;

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

  const completions: ChapterCompletion[] = events
    .filter((event) => event.type === 'completed' && inRange(event.occurredAt, start, end))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((event) => ({
      gameId: event.gameId,
      title: titleOf(event.gameId),
      occurredAt: event.occurredAt,
    }));

  const stateChanges: ChapterStateChange[] = events
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
            .sort(
              (a, b) =>
                (a.globalPercent ?? Number.POSITIVE_INFINITY) -
                (b.globalPercent ?? Number.POSITIVE_INFINITY),
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
  // CUALQUIER cambio de estado abre mes, no solo los completados: empezar,
  // aparcar o soltar un juego es historia igual (ver ChapterStateChange), y
  // es la misma vara que usa el Journey para abrir página — las dos
  // pantallas tienen que estar de acuerdo en qué meses existen.
  for (const event of events) {
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
//     reordenan por si acaso, que un hash no debe fiarse de nadie).
//
// El parámetro `withStateChanges` existe por COMPATIBILIDAD, no por gusto:
// las decisiones (empezar/aparcar/soltar) se incorporaron a los hechos
// después de que ya hubiera recaps escritos, y meterlas en el hash habría
// marcado obsoletos de golpe todos los recaps anteriores — decenas de
// regeneraciones que cuestan dinero para reescribir prosa que estaba bien.
// Con esto, status.ts acepta también la firma ANTIGUA (ver ahí): lo viejo
// sigue vigente, lo nuevo se sella con la firma completa. La firma sin
// decisiones queda congelada para siempre — no se toca ni se "mejora".
export const canonicalChapterFacts = (chapter: Chapter, withStateChanges = true): string => {
  const round = (value: number): number => Math.round(value * 100) / 100;

  const stateChanges = chapter.stateChanges
    .slice()
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.gameId - b.gameId ||
        a.type.localeCompare(b.type),
    )
    .map((change) => ({
      id: change.gameId,
      type: change.type,
      on: localDate(change.occurredAt),
    }));

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
    // cuando se está reconstruyendo la firma ANTIGUA para comparar con un
    // recap escrito antes de que existieran (ver la cabecera). La clave va
    // aquí en medio a propósito: JSON.stringify respeta el orden de
    // inserción y la firma antigua tiene que salir carácter por carácter
    // como salía entonces.
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
  });
};
