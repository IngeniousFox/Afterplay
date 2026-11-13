import { compareByCreation } from '../entityIds';
import type { GameId, IterationId, StateEventId } from '../entityIds';
import { lastPlayedAtFor } from '../lastPlayedAt';
import { isAddedAtArtifact, latestRealStateEvent, manualHoursAnchor } from '../playthroughState';
import type { StateEvent } from '../types';
import { yearOf } from '../yearOf';
import { resolveIterationHours } from './hours';

// LA BIBLIOTECA: lo que cada juego enseña en la lista (horas, sesiones, estado,
// "Last played", en vivo) y las horas manuales con su año para las vistas por
// año. Escrita UNA vez (AFTERPLAY-2.0.md §15.2, F-26).
//
// Estaba en getGames.ts y replicada en worker/src/queries/library.ts, con sus
// divergencias documentadas allí (el `sesión ?? evento` de "Last played", el
// margen del artefacto del alta copiado a mano, el año en UTC). Ahora los dos
// traen sus filas y llaman aquí.
//
// LO QUE SÍ SE QUEDA EN SQL, y por qué: los agregados de sesiones POR
// ITERACIÓN (cuántas, segundos medidos, primera, última, abierta). Traer las
// sesiones crudas para sumarlas aquí es el patrón que multiplicaba por dos el
// coste de getGames (ver su cabecera): lo que cuesta son las filas que cruzan
// el driver, y así crecen con los playthroughs y no con las sesiones. La
// definición de esos agregados —QUÉ cuenta— está escrita una sola vez en
// src/main/db/queries/games/iterationHours.ts (iterationSessionTotals), y la
// usan las dos consultas. Esta función documenta qué espera de cada columna.

type StateType = StateEvent['type'];

// Los enteros de una agregación (`count`, `sum`, `max` sobre timestamps) no
// pasan por el mapeo de columna de drizzle: llegan crudos del driver, y no
// todos los drivers devuelven lo mismo (@tursodatabase/sync en producción,
// @libsql/client en los tests, el de Turso en el Worker). Un `sum()` que
// volviera como bigint convertiría una suma en un TypeError, y una fecha en un
// Date inválido, así que se normalizan aquí una vez.
type SqlInteger = number | bigint;
const toNumber = (value: SqlInteger | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export type LibraryGameRow = { id: GameId; addedAt: Date; promotedAt: Date | null };

// Una fila por playthrough, con sus sesiones YA AGREGADAS (iterationSessionTotals):
//  · sessionCount — TODAS sus sesiones, la abierta incluida.
//  · trackedSeconds — suma de duraciones (la abierta aún no aporta).
//  · lastSessionAt — cuándo se DEJÓ la última sesión (endedAt, o el arranque
//    si sigue abierta); null si no tiene sesiones.
//  · firstSessionAt — el arranque más temprano: último recurso para fechar
//    sus horas manuales.
export type LibraryIterationRow = {
  id: IterationId;
  gameId: GameId;
  manualTotalPlayed: number | null;
  sessionCount: SqlInteger;
  trackedSeconds: SqlInteger | null;
  lastSessionAt: SqlInteger | null;
  firstSessionAt: SqlInteger | null;
};

export type LibraryStateEventRow = {
  gameId: GameId;
  iterationId: IterationId;
  type: StateType;
  occurredAt: Date;
  id: StateEventId;
};

// Una sesión ABIERTA que sigue en marcha, ya juzgada por quien llama: en el
// escritorio toda abierta lo está (el watcher barre las rancias), en el Worker
// pasa por la regla de frescura del cronómetro (isSessionLive).
export type LibraryLiveSession = { gameId: GameId; startedAt: Date | SqlInteger };

export type ManualIterationHours = { iterationId: IterationId; hours: number; year: number | null };

export type LibraryGameSummary = {
  totalHours: number;
  sessionCount: number;
  currentState: StateType | null;
  lastPlayedAt: Date | null;
  isLive: boolean;
  liveSince: Date | null;
  manualIterations: ManualIterationHours[];
};

const EMPTY_SUMMARY = (): LibraryGameSummary => ({
  totalHours: 0,
  sessionCount: 0,
  currentState: null,
  lastPlayedAt: null,
  isLive: false,
  liveSince: null,
  manualIterations: [],
});

const later = (known: Date | null, candidate: Date): Date =>
  known === null || candidate.getTime() > known.getTime() ? candidate : known;

const pushTo = <K, T>(map: Map<K, T[]>, key: K, value: T): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

// `timeZone` es la zona del que mira y SOLO decide a qué año pertenece el ancla
// de unas horas manuales (yearOf). Sin ella, el reloj del proceso: lo correcto
// en el escritorio, y lo que hacía el Worker antes de recibirla.
//
// Devuelve un resumen para CADA juego de `games` (los que no tienen
// playthroughs salen a cero). Las filas de juegos que no estén en `games` se
// ignoran: la población la decide quien llama (la biblioteca excluye los
// planeados).
export const deriveLibrary = (input: {
  games: readonly LibraryGameRow[];
  iterations: readonly LibraryIterationRow[];
  stateEvents: readonly LibraryStateEventRow[];
  liveSessions: readonly LibraryLiveSession[];
  timeZone?: string | null;
}): Map<GameId, LibraryGameSummary> => {
  const summaries = new Map<GameId, LibraryGameSummary>();
  const gameById = new Map<GameId, LibraryGameRow>();
  for (const game of input.games) {
    summaries.set(game.id, EMPTY_SUMMARY());
    gameById.set(game.id, game);
  }

  const eventsByIteration = new Map<IterationId, LibraryStateEventRow[]>();
  const eventsByGame = new Map<GameId, LibraryStateEventRow[]>();
  for (const event of input.stateEvents) {
    pushTo(eventsByIteration, event.iterationId, event);
    pushTo(eventsByGame, event.gameId, event);
  }

  // Las horas de un juego se suman iteración a iteración EN ORDEN DE ID: en
  // coma flotante el orden de la suma puede cambiar el último bit, y los dos
  // lados tienen que dar el mismo número exacto. Se ordena aquí solo si hace
  // falta (las dos consultas ya lo piden) para no pagar un sort por nada.
  let iterations = input.iterations;
  for (let index = 1; index < iterations.length; index++) {
    if (compareByCreation(iterations[index - 1].id, iterations[index].id) > 0) {
      iterations = [...iterations].sort((a, b) => compareByCreation(a.id, b.id));
      break;
    }
  }

  const lastSessionByGame = new Map<GameId, Date>();
  for (const row of iterations) {
    const summary = summaries.get(row.gameId);
    if (!summary) continue;
    const game = gameById.get(row.gameId);

    summary.totalHours += resolveIterationHours(
      row.manualTotalPlayed,
      toNumber(row.trackedSeconds) ?? 0,
    );
    // TODAS, la abierta incluida: ya costó un fallo real (el overlay sumaba
    // +1 "por la de ahora" creyendo que aquí solo entraban las cerradas).
    summary.sessionCount += toNumber(row.sessionCount) ?? 0;

    const playedAt = toNumber(row.lastSessionAt);
    if (playedAt !== null) {
      lastSessionByGame.set(
        row.gameId,
        later(lastSessionByGame.get(row.gameId) ?? null, new Date(playedAt)),
      );
    }

    // Horas manuales con el año al que atribuirlas para las vistas por año.
    // La regla de a qué fecha se cuelgan es manualHoursAnchor (el fin del
    // playthrough, si no su principio, si no su primera sesión), con el
    // artefacto del alta y el del promote descartados. Va UNA sola fecha de
    // sesión y no todas: manualHoursAnchor se queda con la más antigua, y el
    // min() de SQL ya es esa respuesta.
    if (row.manualTotalPlayed !== null) {
      const firstSessionAt = toNumber(row.firstSessionAt);
      const anchor = manualHoursAnchor(
        eventsByIteration.get(row.id) ?? [],
        game?.addedAt,
        firstSessionAt === null ? [] : [new Date(firstSessionAt)],
        game?.promotedAt,
      );
      summary.manualIterations.push({
        iterationId: row.id,
        hours: row.manualTotalPlayed,
        // yearOf y no getFullYear(): un Worker no tiene zona y su getFullYear()
        // es UTC. Una fecha con precisión de año se guarda a medianoche LOCAL
        // del 1 de enero (las 23:00Z del 31 de diciembre desde España), y esas
        // horas caían un año antes en el móvil que en Stats.
        year: anchor === null ? null : yearOf(anchor, input.timeZone),
      });
    }
  }

  // En vivo: entre las sesiones en marcha de un juego gana el arranque MÁS
  // RECIENTE. SPEC 4.5 dice que hay como mucho una por juego, pero la base no
  // lo impone (una que nadie cerró más otra abierta después son dos filas), y
  // la que de verdad está en marcha es la última. El Worker se quedaba con la
  // última por id y el escritorio con la más reciente: ahora las dos, ésta.
  for (const live of input.liveSessions) {
    const summary = summaries.get(live.gameId);
    const startedAt = toNumber(
      live.startedAt instanceof Date ? live.startedAt.getTime() : live.startedAt,
    );
    if (!summary || startedAt === null) continue;
    summary.liveSince = later(summary.liveSince, new Date(startedAt));
    summary.isLive = true;
  }

  for (const [gameId, events] of eventsByGame) {
    const summary = summaries.get(gameId);
    if (!summary) continue;
    const game = gameById.get(gameId);

    // Estado actual: el último evento REAL (ignora 'plan_to_play' y desempata
    // por id). Un juego pasado del Plan como "jugado en el pasado" tiene su
    // completed con fecha ANTERIOR al plan, y sin el filtro ganaría el plan.
    summary.currentState = latestRealStateEvent(events)?.type ?? null;

    // El respaldo de "Last played" desde el log. Un evento vale como "cuándo
    // lo jugué" SOLO si su fecha la pusiste tú: el que escribe el alta (o el
    // promote) hereda su hora y convertiría "los últimos que jugué" en "los
    // últimos que añadí" (isAddedAtArtifact). Se mira TODO el log y no solo el
    // último: si el más reciente es papeleo pero un 'started' anterior tiene
    // fecha propia, esa fecha sigue siendo buena.
    let lastEventAt: Date | null = null;
    for (const event of events) {
      if (event.type === 'plan_to_play') continue;
      if (isAddedAtArtifact(event.occurredAt, game?.addedAt, game?.promotedAt)) continue;
      lastEventAt = later(lastEventAt, event.occurredAt);
    }

    // La más reciente de las dos fuentes, SIEMPRE las dos (lastPlayedAtFor):
    // el `sesión ?? evento` de antes ordenaba por enero un juego trackeado en
    // enero y completado en la consola en junio.
    summary.lastPlayedAt = lastPlayedAtFor(lastSessionByGame.get(gameId) ?? null, lastEventAt);
  }

  // Los juegos con sesiones y SIN log también necesitan su "Last played".
  for (const [gameId, lastSessionAt] of lastSessionByGame) {
    if (eventsByGame.has(gameId)) continue;
    const summary = summaries.get(gameId);
    if (summary) summary.lastPlayedAt = lastPlayedAtFor(lastSessionAt, null);
  }

  return summaries;
};
