// Los momentos señalados del Loop (AFTERPLAY-LOOP.md §2.1): récords, regresos
// e hitos que se DERIVAN de las sesiones al leer — nunca se persisten. Un
// momento pertenece a la sesión que lo causó, no es una entidad suelta con
// fecha propia: eso es lo que hace trivial pintarlo en el diario (la fila de
// la sesión ya existe) y pasárselo a los recaps como un hecho más.
//
// Lib PURA a propósito: sin DB, sin Electron, sin imports del renderer. La
// alimentan igual el main (hechos para los recaps) y el renderer (distintivos
// del diario), cada uno con sus propias filas — de ahí que los inputs sean
// formas estructurales mínimas y no los tipos de Drizzle. Genéricas también en la
// representación del id (ver entityIds.ts): los ids solo agrupan y desempatan.

import { compareRowsByCreation } from '../domain/creationOrder';
import type { EntityId, EntityIdLike, GameId, SessionId } from '../entityIds';

export type MemorySession<Id extends EntityIdLike = EntityId> = {
  id: SessionId<Id>;
  gameId: GameId<Id>;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
  // El reloj de creación de la sesión (2.0, F-09): desempata sesiones con el
  // mismo arranque mejor que el id (ver domain/creationOrder.ts). Opcional: la
  // 1.x y el Worker no lo tienen y desempatan por id.
  syncCreated?: string | null;
};

// `sessionSyncCreated` es el `syncCreated` de la sesión del momento, y solo
// está si la sesión lo traía: quien ordena momentos con el mismo instante
// (chapters.ts) desempata con el mismo orden de creación que ya usa aquí.
export type Moment<Id extends EntityIdLike = EntityId> = MomentShape<Id> & {
  sessionSyncCreated?: string | null;
};

type MomentShape<Id extends EntityIdLike> =
  | { type: 'first_session'; gameId: GameId<Id>; sessionId: SessionId<Id>; occurredAt: Date }
  | {
      type: 'return';
      gameId: GameId<Id>;
      sessionId: SessionId<Id>;
      occurredAt: Date;
      awayDays: number;
    }
  | {
      type: 'longest_session';
      gameId: GameId<Id>;
      sessionId: SessionId<Id>;
      occurredAt: Date;
      durationSec: number;
      previousBestSec: number;
    }
  | {
      type: 'hours_milestone';
      gameId: GameId<Id>;
      sessionId: SessionId<Id>;
      occurredAt: Date;
      hours: number;
    }
  | {
      type: 'sessions_milestone';
      gameId: GameId<Id>;
      sessionId: SessionId<Id>;
      occurredAt: Date;
      count: number;
    };

export type MomentType = Moment['type'];

// Umbrales iniciales (AFTERPLAY-LOOP.md §2.1) — ajustables al probarlos con
// datos reales. El catálogo extendido de v1 queda como cantera para después.
export const HOURS_MILESTONES = [25, 50, 100, 200, 500, 1000, 2000] as const;
export const SESSIONS_MILESTONES = [25, 50, 100, 250, 500, 1000] as const;
// "Volver a un juego tras ≥ 3 meses sin tocarlo" — en días y no en meses de
// calendario: un regreso no es una fecha de contabilidad, y 90 días se lee
// igual de bien el 1 que el 28.
export const RETURN_GAP_DAYS = 90;
// Sin un mínimo de sesiones previas, las primeras partidas de cualquier juego
// baten "récord" en días alternos y el distintivo pierde todo el valor. Cinco
// sesiones bastan para que un récord signifique algo.
export const LONGEST_MIN_PRIOR_SESSIONS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

// Solo el tiempo MEDIDO de verdad puede protagonizar un momento: las filas
// manuales históricas (isManual) son horas tecleadas con fechas gruesas, no
// partidas — cuentan para acumular horas, pero no pueden "ser" tu primera
// sesión ni batir un récord. Una sesión abierta (endedAt null) todavía no es
// nada: se evaluará cuando cierre.
const isMeasured = (session: MemorySession<EntityIdLike>): boolean =>
  !session.isManual && session.endedAt !== null && (session.durationSec ?? 0) > 0;

// Deriva TODOS los momentos de un conjunto de sesiones (la historia completa,
// no una ventana: los récords y los hitos dependen de todo lo anterior — quien
// quiera un periodo, filtra el resultado por occurredAt).
//
// `manualHoursByGame`: horas manuales de los playthroughs ("I played this
// before"), que actúan de línea base del contador de horas — si ya le dijiste
// a la app que llevabas 30h, la sesión que te pone en 26h medidas no "cruza
// las 25": las cruzaste antes de que existiera el tracking.
const syncCreatedOf = (session: MemorySession<EntityIdLike>): { sessionSyncCreated?: string } =>
  session.syncCreated ? { sessionSyncCreated: session.syncCreated } : {};

export const deriveMoments = <Id extends EntityIdLike>(
  sessions: MemorySession<Id>[],
  manualHoursByGame?: ReadonlyMap<GameId<Id>, number>,
): Moment<Id>[] => {
  const byGame = new Map<GameId<Id>, MemorySession<Id>[]>();
  for (const session of sessions) {
    const list = byGame.get(session.gameId) ?? [];
    list.push(session);
    byGame.set(session.gameId, list);
  }

  const moments: Moment<Id>[] = [];

  for (const [gameId, gameSessions] of byGame) {
    const ordered = gameSessions
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || compareRowsByCreation(a, b));

    let totalHours = manualHoursByGame?.get(gameId) ?? 0;
    let measuredCount = 0;
    let bestSec = 0;
    // El "último toque" para medir regresos: el fin de la última sesión
    // medida (o su inicio si por lo que sea no tiene fin).
    let lastTouch: Date | null = null;

    for (const session of ordered) {
      const eligible = isMeasured(session);
      const durationSec = session.durationSec ?? 0;

      if (eligible) {
        measuredCount++;

        if (measuredCount === 1) {
          moments.push({
            type: 'first_session',
            gameId,
            sessionId: session.id,
            ...syncCreatedOf(session),
            occurredAt: session.startedAt,
          });
        } else if (lastTouch !== null) {
          const gapDays = (session.startedAt.getTime() - lastTouch.getTime()) / DAY_MS;
          if (gapDays >= RETURN_GAP_DAYS) {
            moments.push({
              type: 'return',
              gameId,
              sessionId: session.id,
              ...syncCreatedOf(session),
              occurredAt: session.startedAt,
              awayDays: Math.round(gapDays),
            });
          }
        }

        if (durationSec > bestSec && measuredCount - 1 >= LONGEST_MIN_PRIOR_SESSIONS) {
          moments.push({
            type: 'longest_session',
            gameId,
            sessionId: session.id,
            ...syncCreatedOf(session),
            occurredAt: session.startedAt,
            durationSec,
            previousBestSec: bestSec,
          });
        }
        bestSec = Math.max(bestSec, durationSec);

        if ((SESSIONS_MILESTONES as readonly number[]).includes(measuredCount)) {
          moments.push({
            type: 'sessions_milestone',
            gameId,
            sessionId: session.id,
            ...syncCreatedOf(session),
            occurredAt: session.startedAt,
            count: measuredCount,
          });
        }
      }

      // Las horas las acumula TODA sesión con duración (las manuales
      // también: son tiempo real, solo que tecleado) — pero el hito solo lo
      // protagoniza una sesión medida. Si una maratón cruza dos umbrales de
      // golpe, se anuncia solo el más alto: "crossed 50h" ya contiene al 25.
      const before = totalHours;
      totalHours += durationSec / 3600;
      if (eligible) {
        let crossed: number | null = null;
        for (const milestone of HOURS_MILESTONES) {
          if (before < milestone && totalHours >= milestone) crossed = milestone;
        }
        if (crossed !== null) {
          moments.push({
            type: 'hours_milestone',
            gameId,
            sessionId: session.id,
            ...syncCreatedOf(session),
            occurredAt: session.startedAt,
            hours: crossed,
          });
        }
      }

      if (eligible) lastTouch = session.endedAt ?? session.startedAt;
    }
  }

  return moments.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
};

// Índice por sesión, para pintar los distintivos del diario sin recorrer la
// lista entera fila a fila.
export const momentsBySession = <Id extends EntityIdLike>(
  moments: Moment<Id>[],
): Map<SessionId<Id>, Moment<Id>[]> => {
  const map = new Map<SessionId<Id>, Moment<Id>[]>();
  for (const moment of moments) {
    const list = map.get(moment.sessionId) ?? [];
    list.push(moment);
    map.set(moment.sessionId, list);
  }
  return map;
};
