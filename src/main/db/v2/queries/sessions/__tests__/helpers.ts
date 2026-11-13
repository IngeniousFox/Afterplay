import { and, asc, eq } from 'drizzle-orm';
import {
  playthroughs,
  sessions,
  stateEvents,
  type PlaythroughRow,
  type SessionRow,
  type StateEventRow,
} from '../../../schema';
import type { QueryContext } from '../../common';

// Lecturas de comprobación de los tests de sesiones. Leen la base tal cual
// (lápidas incluidas cuando se dice), sin pasar por las consultas bajo prueba.

export const sessionRow = (ctx: QueryContext, id: string): SessionRow | undefined =>
  ctx.db.select().from(sessions).where(eq(sessions.id, id)).get();

/** Playthroughs vivos del juego, por creación. */
export const playthroughsOf = (ctx: QueryContext, gameId: string): PlaythroughRow[] =>
  ctx.db
    .select()
    .from(playthroughs)
    .where(and(eq(playthroughs.gameId, gameId)))
    .orderBy(asc(playthroughs.syncCreated), asc(playthroughs.id))
    .all()
    .filter((row) => row.syncDeleted === null);

/** Eventos vivos de un playthrough en orden de calendario y, a igualdad, de creación. */
export const eventsOf = (ctx: QueryContext, playthroughId: string): StateEventRow[] =>
  ctx.db
    .select()
    .from(stateEvents)
    .where(eq(stateEvents.playthroughId, playthroughId))
    .orderBy(asc(stateEvents.occurredAt), asc(stateEvents.syncCreated), asc(stateEvents.id))
    .all()
    .filter((row) => row.syncDeleted === null);

export const typesOf = (ctx: QueryContext, playthroughId: string): string[] =>
  eventsOf(ctx, playthroughId).map((event) => event.type);

/** Todos los eventos vivos del juego. */
export const eventsOfGame = (ctx: QueryContext, gameId: string): StateEventRow[] =>
  playthroughsOf(ctx, gameId).flatMap((playthrough) => eventsOf(ctx, playthrough.id));

/** Sesiones vivas de los playthroughs del juego. */
export const sessionsOfGame = (ctx: QueryContext, gameId: string): SessionRow[] =>
  ctx.db
    .select({ session: sessions })
    .from(sessions)
    .innerJoin(playthroughs, eq(playthroughs.id, sessions.playthroughId))
    .where(eq(playthroughs.gameId, gameId))
    .orderBy(asc(sessions.syncCreated))
    .all()
    .map((row) => row.session)
    .filter((row) => row.syncDeleted === null);

/**
 * El invariante de SPEC 4.5 medido A MANO (último evento de cada playthrough
 * vivo), sin `latestRealStateEvent`, que es el helper del código bajo prueba.
 */
export const activePlaythroughs = (ctx: QueryContext, gameId: string): string[] =>
  playthroughsOf(ctx, gameId)
    .filter((playthrough) => {
      const events = eventsOf(ctx, playthrough.id);
      return events[events.length - 1]?.type === 'started';
    })
    .map((playthrough) => playthrough.id);

/** El mismo contexto con otro "ahora" (cuándo se toma la decisión). */
export const withNow = (ctx: QueryContext, now: Date): QueryContext => ({ ...ctx, now: () => now });
