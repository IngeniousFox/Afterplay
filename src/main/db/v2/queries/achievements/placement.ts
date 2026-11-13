import { and, asc, eq } from 'drizzle-orm';
import { playthroughs, sessions } from '../../schema';
import { liveSession } from '../common/alive';
import type { QueryContext } from '../common/context';

// Colgar cada desbloqueo del rato en que pasó (LOGROS.md §4). Copia 2.0 de
// `src/main/steam/matchSessions.ts`: la parte de base (`getSessionWindows`)
// lee sesiones vivas con la regla F-11, y la regla pura (`placeUnlock`) es la
// misma salvo dos cosas que el 2.0 obliga a explicitar:
//
// - "ahora" llega por parámetro (`ctx.now()`), no `Date.now()`: una sesión
//   abierta llega hasta ahora mismo y los tests necesitan un reloj fijo.
// - El desempate entre dos sesiones que arrancan en el mismo instante era
//   "gana el sessionId mayor" (`compareByCreation` sobre ids numéricos). Con
//   ids de texto eso es "gana la creada después", y aquí se dice tal cual: la
//   lista viene ordenada por `startedAt, syncCreated, id` y, a igual arranque,
//   gana la posterior en esa lista (README: orden por creación).

export interface SessionWindow {
  readonly sessionId: string;
  readonly playthroughId: string;
  readonly startedAt: Date;
  /** null en una sesión todavía abierta. */
  readonly endedAt: Date | null;
}

export interface UnlockPlacement {
  readonly sessionId: string | null;
  readonly playthroughId: string | null;
}

/** Margen de gracia tras el cierre (ver `matchSessions.ts`: pantallas de cierre y guardado). */
export const PLACEMENT_GRACE_MS = 2 * 60 * 1000;

const NOWHERE: UnlockPlacement = { sessionId: null, playthroughId: null };

/**
 * Las sesiones vivas (F-11: con playthrough y juego vivos) de un juego, de
 * cualquier dispositivo, en orden cronológico y de creación. Las de emulador
 * sin asignar no son de ningún juego todavía y no salen.
 */
export function getSessionWindows(ctx: QueryContext, gameId: string): SessionWindow[] {
  return ctx.db
    .select({
      sessionId: sessions.id,
      playthroughId: playthroughs.id,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
    })
    .from(sessions)
    .innerJoin(playthroughs, eq(sessions.playthroughId, playthroughs.id))
    .where(and(eq(playthroughs.gameId, gameId), liveSession()))
    .orderBy(asc(sessions.startedAt), asc(sessions.syncCreated), asc(sessions.id))
    .all();
}

/**
 * ¿En qué sesión cae este desbloqueo? Sin fecha, o fuera de toda ventana,
 * en ninguna (lo normal: antes de usar Afterplay, en otro sitio…). Si varias
 * ventanas lo contienen gana la de arranque más tardío (la gracia del cierre
 * se solapa con el arranque de la siguiente), y a igual arranque la creada
 * después. `windows` tiene que venir en el orden de `getSessionWindows`.
 */
export function placeUnlock(
  unlockedAt: Date | null,
  windows: readonly SessionWindow[],
  now: Date,
): UnlockPlacement {
  if (!unlockedAt) return NOWHERE;
  const time = unlockedAt.getTime();
  let best: SessionWindow | null = null;
  for (const window of windows) {
    const start = window.startedAt.getTime();
    const end = (window.endedAt ?? now).getTime() + PLACEMENT_GRACE_MS;
    if (time < start || time > end) continue;
    // `>=`: a igual arranque gana la posterior en la lista, que es la creada después.
    if (best === null || start >= best.startedAt.getTime()) best = window;
  }
  return best === null ? NOWHERE : { sessionId: best.sessionId, playthroughId: best.playthroughId };
}
