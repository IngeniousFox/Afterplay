// Los momentos señalados del Loop (AFTERPLAY-LOOP.md §2.1): récords, regresos
// e hitos que se DERIVAN de las sesiones al leer — nunca se persisten. Un
// momento pertenece a la sesión que lo causó, no es una entidad suelta con
// fecha propia: eso es lo que hace trivial pintarlo en el diario (la fila de
// la sesión ya existe) y pasárselo a los recaps como un hecho más.
//
// Lib PURA a propósito: sin DB, sin Electron, sin imports del renderer. La
// alimentan igual el main (hechos para los recaps) y el renderer (distintivos
// del diario), cada uno con sus propias filas — de ahí que los inputs sean
// formas estructurales mínimas y no los tipos de Drizzle.

export type MemorySession = {
  id: number;
  gameId: number;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

export type Moment =
  | { type: 'first_session'; gameId: number; sessionId: number; occurredAt: Date }
  | { type: 'return'; gameId: number; sessionId: number; occurredAt: Date; awayDays: number }
  | {
      type: 'longest_session';
      gameId: number;
      sessionId: number;
      occurredAt: Date;
      durationSec: number;
      previousBestSec: number;
    }
  | { type: 'hours_milestone'; gameId: number; sessionId: number; occurredAt: Date; hours: number }
  | {
      type: 'sessions_milestone';
      gameId: number;
      sessionId: number;
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
const isMeasured = (session: MemorySession): boolean =>
  !session.isManual && session.endedAt !== null && (session.durationSec ?? 0) > 0;

// Deriva TODOS los momentos de un conjunto de sesiones (la historia completa,
// no una ventana: los récords y los hitos dependen de todo lo anterior — quien
// quiera un periodo, filtra el resultado por occurredAt).
//
// `manualHoursByGame`: horas manuales de los playthroughs ("I played this
// before"), que actúan de línea base del contador de horas — si ya le dijiste
// a la app que llevabas 30h, la sesión que te pone en 26h medidas no "cruza
// las 25": las cruzaste antes de que existiera el tracking.
export const deriveMoments = (
  sessions: MemorySession[],
  manualHoursByGame?: ReadonlyMap<number, number>,
): Moment[] => {
  const byGame = new Map<number, MemorySession[]>();
  for (const session of sessions) {
    const list = byGame.get(session.gameId) ?? [];
    list.push(session);
    byGame.set(session.gameId, list);
  }

  const moments: Moment[] = [];

  for (const [gameId, gameSessions] of byGame) {
    const ordered = gameSessions
      .slice()
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id - b.id);

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
            occurredAt: session.startedAt,
          });
        } else if (lastTouch !== null) {
          const gapDays = (session.startedAt.getTime() - lastTouch.getTime()) / DAY_MS;
          if (gapDays >= RETURN_GAP_DAYS) {
            moments.push({
              type: 'return',
              gameId,
              sessionId: session.id,
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
export const momentsBySession = (moments: Moment[]): Map<number, Moment[]> => {
  const map = new Map<number, Moment[]>();
  for (const moment of moments) {
    const list = map.get(moment.sessionId) ?? [];
    list.push(moment);
    map.set(moment.sessionId, list);
  }
  return map;
};
