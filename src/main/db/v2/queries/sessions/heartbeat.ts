import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { localSessionBeats, sessions } from '../../schema';
import { alive, isStoreError, type StoreError } from '../../store';
import type { QueryContext } from '../common';
import { readSessionRow } from './dto';

// Latido en dos niveles (AFTERPLAY-2.0.md §10.3, CONSULTAS.md §3.2 y R-17).
// Sustituye a `heartbeatSessions.ts` de la 1.x, que hacía un UPDATE de
// `lastHeartbeatAt` por sesión cada 5 s: en la 2.0 eso serían relojes nuevos y
// una subida al hub cada 5 s por sesión.
//
// - Local, cada ciclo (~5 s): `local_session_beats`, una fila por sesión con
//   el último latido. Es una tabla local (clase L): se escribe directamente,
//   sin puerta, y no sale del PC. Sirve para que el dueño, tras un corte de
//   luz, cierre su sesión en el último instante conocido.
// - Señal de vida, como mucho cada 60 s: `sessions.lastSeenAt`, por la
//   puerta. Sirve para que los demás dispositivos sepan si sigue viva (y para
//   el barrido del hub, §10.5).
//
// Solo se late lo PROPIO, abierto y sin lápida (§10.1): latir una sesión de
// otro PC sería adoptarla, y una cerrada o borrada no tiene nada que afirmar.

/** Cada cuánto, como mucho, se escribe `sessions.lastSeenAt` (§10.3). */
export const SESSION_LAST_SEEN_INTERVAL_MS = 60_000;

export interface HeartbeatResult {
  /** Sesiones con latido local escrito. */
  readonly beaten: readonly string[];
  /** De ellas, las que además han recibido `lastSeenAt` nuevo. */
  readonly signalled: readonly string[];
  /** No existen, tienen lápida, están cerradas o son de otro PC: no se tocan. */
  readonly skipped: readonly string[];
  /** La puerta rechazó su `lastSeenAt`; esa sesión se deshizo entera (latido incluido). */
  readonly failed: readonly { readonly sessionId: string; readonly error: StoreError }[];
}

type BeatOutcome = 'skipped' | 'beaten' | 'signalled';

/**
 * Late las sesiones que el watcher sigue, con `at` (la hora del ciclo).
 *
 * CONTRATO DE ERRORES: un `StoreError` al escribir la señal de vida de UNA
 * sesión se captura, se deshace solo esa (cada una va en su SAVEPOINT) y se
 * devuelve en `failed`: no tumba el latido de las demás ni la transacción de
 * quien llama. Cualquier otro error se propaga.
 */
export function heartbeatSessions(
  ctx: QueryContext,
  sessionIds: readonly string[],
  at: Date,
): HeartbeatResult {
  const beaten: string[] = [];
  const signalled: string[] = [];
  const skipped: string[] = [];
  const failed: { sessionId: string; error: StoreError }[] = [];

  for (const sessionId of new Set(sessionIds)) {
    let outcome: BeatOutcome;
    try {
      outcome = ctx.store.transaction((): BeatOutcome => {
        const row = readSessionRow(ctx, sessionId);
        if (
          !row ||
          row.syncDeleted !== null ||
          row.endedAt !== null ||
          row.deviceId !== ctx.deviceId
        ) {
          return 'skipped';
        }
        ctx.db
          .insert(localSessionBeats)
          .values({ sessionId, beatAt: at })
          .onConflictDoUpdate({ target: localSessionBeats.sessionId, set: { beatAt: at } })
          .run();
        const lastSignal = (row.lastSeenAt ?? row.startedAt).getTime();
        if (at.getTime() - lastSignal < SESSION_LAST_SEEN_INTERVAL_MS) return 'beaten';
        ctx.store.patch('sessions', sessionId, { lastSeenAt: at });
        return 'signalled';
      });
    } catch (error) {
      if (!isStoreError(error)) throw error;
      failed.push({ sessionId, error });
      continue;
    }
    if (outcome === 'skipped') {
      skipped.push(sessionId);
    } else {
      beaten.push(sessionId);
      if (outcome === 'signalled') signalled.push(sessionId);
    }
  }
  return { beaten, signalled, skipped, failed };
}

/** El último latido local de una sesión, o null si nunca latió en este PC. */
export function readSessionBeat(ctx: QueryContext, sessionId: string): Date | null {
  const row = ctx.db
    .select({ beatAt: localSessionBeats.beatAt })
    .from(localSessionBeats)
    .where(eq(localSessionBeats.sessionId, sessionId))
    .get();
  return row?.beatAt ?? null;
}

/**
 * Borra los latidos locales que ya no sirven: los de sesiones que no son
 * propias, abiertas y sin lápida. La tabla guarda una fila por sesión y
 * nadie más la limpia (los cierres de `common/sessionsClose.ts` no la tocan),
 * así que sin esto crecería una fila por sesión jugada. Pensado para el
 * arranque, DESPUÉS de reconciliar (la reconciliación necesita el latido).
 * Devuelve cuántas filas ha borrado.
 */
export function pruneSessionBeats(ctx: QueryContext): number {
  const stillOpen = ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.deviceId, ctx.deviceId), isNull(sessions.endedAt), alive(sessions)));
  const result = ctx.db
    .delete(localSessionBeats)
    .where(notInArray(localSessionBeats.sessionId, stillOpen))
    .run();
  return Number(result.changes);
}
