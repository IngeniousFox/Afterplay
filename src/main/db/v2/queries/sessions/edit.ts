import { and, eq } from 'drizzle-orm';
import { games } from '../../schema';
import { liveGame, type QueryContext } from '../common';
import { readSessionRow, rereadSession, type SessionDto } from './dto';
import { resolvePlaythroughForSession } from './resolvePlaythrough';

// Editar y borrar sesiones (sustituyen a `assignSession.ts`,
// `updateSessionNote.ts`, `deleteSession.ts` y `deletePendingSession.ts` de la
// 1.x; CONSULTAS.md §1.4 y §2.2).
//
// Quién puede qué (§7.4, `store/owner.ts`): la nota y el playthrough (asignar
// una sesión de emulador) los puede escribir cualquier dispositivo; borrar,
// cualquiera si está cerrada. Las comprobaciones de aquí van ANTES de la
// puerta para que los casos esperados sean resultados y no `not_owner`.

/**
 * Asigna una sesión pendiente de emulador a un juego emulado, con la misma
 * regla de "¿en qué playthrough cae?" que el watcher y el Play, a la fecha
 * REAL de la sesión (`startedAt`): si el juego no estaba activo, el `started`
 * que lo activa nace cuando se jugó. Conserva `emulatorId` (qué emulador la
 * generó). Todo en una transacción: un rechazo no deja un playthrough
 * fantasma. Se puede asignar una sesión de otro PC y una todavía abierta.
 *
 * - `null` si la sesión no existe o tiene lápida ("eso ya no está").
 * - Lanza `Error` si ya está asignada, si el juego no existe o está borrado, o
 *   si no está marcado como emulado ("eso no se puede"), como la 1.x.
 * - Un `StoreError` se propaga: p. ej. `open_session` si la sesión es propia
 *   y sigue abierta y el juego ya tiene otra sesión propia abierta (serían
 *   dos relojes sobre la misma partida).
 */
export function assignSession(
  ctx: QueryContext,
  sessionId: string,
  gameId: string,
): SessionDto | null {
  const assigned = ctx.store.transaction((): boolean => {
    const session = readSessionRow(ctx, sessionId);
    if (!session || session.syncDeleted !== null) return false;
    if (session.playthroughId !== null) {
      throw new Error(`La sesión ${sessionId} ya está asignada`);
    }
    const game = ctx.db
      .select({ isEmulated: games.isEmulated })
      .from(games)
      .where(and(eq(games.id, gameId), liveGame()))
      .get();
    if (!game) throw new Error(`No existe el juego ${gameId}`);
    // Regla 3 de EMULADORES.md §6: una sesión de emulador solo cae en un juego
    // emulado. Antes de resolver, para que el rechazo no escriba nada.
    if (!game.isEmulated) throw new Error(`El juego ${gameId} no está marcado como emulado`);

    const { playthroughId } = resolvePlaythroughForSession(ctx, gameId, session.startedAt);
    ctx.store.patch('sessions', sessionId, { playthroughId });
    return true;
  });
  return assigned ? rereadSession(ctx, sessionId) : null;
}

/**
 * La nota de la sesión ("dónde lo dejé"). Vacía o solo espacios se guarda
 * como null: "sin nota" es un estado, no un texto vacío. Se puede escribir en
 * la sesión de otro PC. `null` si no existe o tiene lápida.
 */
export function updateSessionNote(
  ctx: QueryContext,
  sessionId: string,
  note: string,
): SessionDto | null {
  const updated = ctx.store.transaction((): boolean => {
    const session = readSessionRow(ctx, sessionId);
    if (!session || session.syncDeleted !== null) return false;
    // Sin cambios no escribe (F-33): no hace falta comparar.
    ctx.store.patch('sessions', sessionId, { note: note.trim() || null });
    return true;
  });
  return updated ? rereadSession(ctx, sessionId) : null;
}

/**
 * Borra (lápida) una sesión CERRADA, de cualquier dispositivo. La puerta anula
 * `achievement_unlocks.sessionId` en la misma operación (el SET NULL de la
 * 1.x). El historial de estados no se toca.
 *
 * - `true` si la ha borrado; `false` si no existía o ya tenía lápida.
 * - Lanza `Error` si sigue abierta (propia o de otro PC): primero se para y
 *   luego se borra. Con el watcher siguiéndola, borrarla le dejaría latiendo y
 *   cerrando una fila que ya no existe, y se perdería el resto de la partida.
 */
export function deleteSession(ctx: QueryContext, sessionId: string): boolean {
  return ctx.store.transaction((): boolean => {
    const session = readSessionRow(ctx, sessionId);
    if (!session || session.syncDeleted !== null) return false;
    if (session.endedAt === null) {
      throw new Error('La sesión sigue abierta — párala antes de borrarla');
    }
    ctx.store.remove('sessions', sessionId);
    return true;
  });
}

/**
 * Descarta una sesión de emulador sin asignar y ya cerrada (abriste el
 * emulador para configurarlo). `false`, sin lanzar, si no existe, ya tenía
 * lápida, está asignada (eso es tiempo jugado: otra decisión) o sigue en
 * marcha (mismo motivo que `deleteSession`).
 */
export function deletePendingSession(ctx: QueryContext, sessionId: string): boolean {
  return ctx.store.transaction((): boolean => {
    const session = readSessionRow(ctx, sessionId);
    if (
      !session ||
      session.syncDeleted !== null ||
      session.playthroughId !== null ||
      session.endedAt === null
    ) {
      return false;
    }
    ctx.store.remove('sessions', sessionId);
    return true;
  });
}
