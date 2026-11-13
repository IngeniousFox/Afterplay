import { and, asc, eq, isNull } from 'drizzle-orm';
import { sessions, type SessionClosedBy, type SessionRow } from '../../schema';
import { alive, isStoreError, type StoreError } from '../../store';
import type { QueryContext } from './context';

// Cerrar sesiones PROPIAS (CONSULTAS.md §2.2 "sessions" y "stateEvents", §3.2;
// decisiones R-10 y R-12).
//
// Lo comparten el paquete de sesiones (Stop, el watcher) y el de estados
// (marcar Completed/Dropped/On hold/Resting cierra la sesión abierta), y vive
// aquí para que ninguno escriba en la carpeta del otro.
//
// Reglas:
// - Solo el dueño cierra su sesión (§10.1, F-01 a F-03). La de otro PC no se
//   toca: se devuelve `not_owner` sin lanzar, y la interfaz la sigue viendo
//   "en vivo" hasta que su dueño la cierre (R-10, se tratará en la fase 4).
// - Idempotente: una sesión ya cerrada no se recalcula. Si no, el cierre real
//   del proceso, horas después de un Stop, inflaría la duración (la cicatriz
//   de closeSession.ts en la 1.x).
// - Un fin anterior al inicio no se guarda: la sesión se queda abierta, que es
//   reversible (el watcher la cerrará bien). Igual que la 1.x.
// - `closedBy` es obligatorio para quien llama (R-12): `'user'` si lo pide una
//   persona (Stop, marcar un estado), `'owner'` si es un cierre automático del
//   watcher. No hay valor por defecto a propósito.
//
// CONTRATO DE ERRORES. Los casos esperados (no existe, borrada, ya cerrada, de
// otro PC, fin antes del inicio) son resultados, no excepciones. Un
// `StoreError` inesperado de la puerta al cerrar UNA sesión:
// - en `closeOwnSession`, se propaga (quien cierra una sola quiere saberlo);
// - en `closeOpenOwnSessions`, se captura por sesión, se deshace solo esa
//   (cada cierre va en su propio SAVEPOINT) y se devuelve en `failed`: un
//   fallo en una no tumba el bucle ni la transacción de quien llama (el
//   evento de estado se registra igual). Cualquier otro error (SQLite, un
//   fallo de programación) se propaga siempre.

/** Duración en segundos, nunca negativa, redondeada (copia de la 1.x: `sessionDuration.ts`). */
export const computeDurationSec = (startedAt: Date, endedAt: Date): number =>
  Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));

export type CloseSessionResult =
  /** Cerrada ahora por esta llamada. `session` es la fila ya cerrada. */
  | { readonly status: 'closed'; readonly session: SessionRow }
  /** Ya estaba cerrada: no se ha tocado. */
  | { readonly status: 'already_closed'; readonly session: SessionRow }
  /** Abierta, pero de otro dispositivo: no se puede cerrar desde aquí. */
  | { readonly status: 'not_owner'; readonly session: SessionRow }
  /** `endedAt` es anterior al inicio: se deja abierta. */
  | { readonly status: 'ends_before_start'; readonly session: SessionRow }
  /** No existe o tiene lápida. */
  | { readonly status: 'not_found' | 'deleted' };

export interface CloseSessionInput {
  readonly endedAt: Date;
  readonly closedBy: SessionClosedBy;
}

function readSession(ctx: QueryContext, sessionId: string): SessionRow | undefined {
  return ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
}

/**
 * Cierra una sesión propia si sigue abierta, con `endedAt`, `durationSec` y
 * `closedBy`, en una transacción (relee la fila dentro). Ver el contrato de
 * errores arriba.
 */
export function closeOwnSession(
  ctx: QueryContext,
  sessionId: string,
  input: CloseSessionInput,
): CloseSessionResult {
  return ctx.store.transaction((): CloseSessionResult => {
    const row = readSession(ctx, sessionId);
    if (!row) return { status: 'not_found' };
    if (row.syncDeleted !== null) return { status: 'deleted' };
    if (row.endedAt !== null) return { status: 'already_closed', session: row };
    if (row.deviceId !== ctx.deviceId) return { status: 'not_owner', session: row };
    if (input.endedAt.getTime() < row.startedAt.getTime()) {
      return { status: 'ends_before_start', session: row };
    }
    ctx.store.patch('sessions', sessionId, {
      endedAt: input.endedAt,
      durationSec: computeDurationSec(row.startedAt, input.endedAt),
      closedBy: input.closedBy,
    });
    const closed = readSession(ctx, sessionId);
    if (!closed) throw new Error(`sessions: la fila ${sessionId} desapareció al cerrarla`);
    return { status: 'closed', session: closed };
  });
}

export interface CloseOpenSessionsResult {
  /** Las que esta llamada ha cerrado. */
  readonly closed: readonly SessionRow[];
  /** Abiertas que empezaron DESPUÉS de `endedAt`: se dejan abiertas. */
  readonly startedLater: readonly SessionRow[];
  /** Las que la puerta rechazó; cada una deshecha por separado. */
  readonly failed: readonly { readonly sessionId: string; readonly error: StoreError }[];
}

/**
 * Cierra en `endedAt` todas las sesiones abiertas PROPIAS y vivas de un
 * playthrough (R-10: las de otros PCs no se tocan ni se cuentan). Es lo que
 * hace registrar un estado que cierra sesión (`closesOpenSessions`). El corte
 * es `>=`: una sesión que empezó exactamente en `endedAt` se cierra con
 * duración 0 (arrancar y marcar Dropped acto seguido no deja una abierta para
 * siempre); una que empezó después se deja (`startedLater`).
 *
 * Pensada para ir dentro de la `store.transaction` de quien llama. Ver el
 * contrato de errores arriba.
 */
export function closeOpenOwnSessions(
  ctx: QueryContext,
  playthroughId: string,
  input: CloseSessionInput,
): CloseOpenSessionsResult {
  const open = ctx.db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.playthroughId, playthroughId),
        eq(sessions.deviceId, ctx.deviceId),
        isNull(sessions.endedAt),
        alive(sessions),
      ),
    )
    .orderBy(asc(sessions.startedAt), asc(sessions.syncCreated), asc(sessions.id))
    .all();

  const closed: SessionRow[] = [];
  const startedLater: SessionRow[] = [];
  const failed: { sessionId: string; error: StoreError }[] = [];
  for (const session of open) {
    try {
      const result = closeOwnSession(ctx, session.id, input);
      if (result.status === 'closed') closed.push(result.session);
      else if (result.status === 'ends_before_start') startedLater.push(result.session);
    } catch (error) {
      if (!isStoreError(error)) throw error;
      failed.push({ sessionId: session.id, error });
    }
  }
  return { closed, startedLater, failed };
}
