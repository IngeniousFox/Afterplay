import { and, eq } from 'drizzle-orm';
import { playthroughs, stateEvents } from '../../schema';
import { liveStateEvent, type QueryContext } from '../common';

// games:resetEndlessState en 2.0 (CONSULTAS.md §2.2).
//
// Convertir un juego normal en ENDLESS sin perder nada medido: playthroughs,
// sesiones y horas manuales se conservan; lo que se limpia es la noción de
// "partida discreta con desenlace", que un endless no tiene: TODOS sus
// eventos de estado, en todos sus playthroughs. La 1.x exceptuaba
// `plan_to_play` (historial de intención); en 2.0 ese historial vive en
// `plan_entries`, que esto no toca, así que no hay nada que exceptuar.
//
// El estado nuevo del endless lo escribe el modal justo después, como un
// evento nuevo.

/**
 * Pone la lápida a los eventos de estado vivos de los playthroughs vivos del
 * juego, en una transacción. Devuelve siempre true, como la 1.x (un juego sin
 * playthroughs, o que no existe, no tiene nada que limpiar).
 */
export function resetEndlessState(ctx: QueryContext, gameId: string): boolean {
  return ctx.store.transaction(() => {
    const events = ctx.db
      .select({ id: stateEvents.id })
      .from(stateEvents)
      .innerJoin(playthroughs, eq(playthroughs.id, stateEvents.playthroughId))
      .where(and(eq(playthroughs.gameId, gameId), liveStateEvent()))
      .all();
    for (const event of events) ctx.store.remove('state_events', event.id);
    return true;
  });
}
