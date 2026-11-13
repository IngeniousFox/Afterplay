import { closeOwnSession, type CloseSessionInput, type QueryContext } from '../common';
import { toSessionDto, type SessionDto } from './dto';

// Cerrar una sesión (sustituye a `closeSession.ts` de la 1.x; CONSULTAS.md
// §2.2 y §3.2). La única forma de cerrar es `closeOwnSession` de
// `common/sessionsClose.ts`: aquí solo se adapta su resultado a los dos
// contratos que el watcher y el IPC ya usan.
//
// `closedBy` es obligatorio y lo decide quien llama (R-12):
// - `'owner'`: los cierres automáticos del watcher (el proceso murió, pausa o
//   bloqueo del PC, reconciliación al arrancar, no visto en 120 s);
// - `'user'`: los que pide una persona (Stop, `sessions:close`).
//
// Solo el dueño cierra (§10.1). Una sesión abierta de otro PC no se toca: las
// dos funciones lo tratan como "no la he cerrado yo" sin lanzar.
//
// CONTRATO DE ERRORES: los casos esperados son resultados (ver cada función).
// Un `StoreError` inesperado de la puerta se propaga (la transacción de
// `closeOwnSession` ya lo ha deshecho); el watcher lo captura por sesión con
// `captureStoreError`.

/**
 * "Ciérrala SOLO si estaba abierta y dime si has sido tú." Devuelve la sesión
 * ya cerrada si ESTA llamada la ha cerrado, y `null` en cualquier otro caso:
 * no existe, tiene lápida, ya estaba cerrada (no se recalcula: la cicatriz del
 * Stop seguido del cierre real del proceso), es de otro dispositivo, o
 * `endedAt` es anterior a su inicio (se deja abierta, que es reversible).
 *
 * De este valor cuelgan el aviso de sesión cerrada y el backup de la partida
 * en el watcher: "devuelve fila" significa "la he cerrado yo".
 */
export function closeSessionIfOpen(
  ctx: QueryContext,
  sessionId: string,
  input: CloseSessionInput,
): SessionDto | null {
  const result = closeOwnSession(ctx, sessionId, input);
  return result.status === 'closed' ? toSessionDto(result.session) : null;
}

/**
 * Cierra si sigue abierta y devuelve SIEMPRE la sesión tal como queda: la
 * recién cerrada, o la que ya estaba cerrada sin recalcular nada. Si es de
 * otro dispositivo o `endedAt` es anterior a su inicio, la devuelve sin
 * tocar (sigue abierta). `null` solo si no existe o tiene lápida.
 */
export function closeSession(
  ctx: QueryContext,
  sessionId: string,
  input: CloseSessionInput,
): SessionDto | null {
  const result = closeOwnSession(ctx, sessionId, input);
  // No existe o tiene lápida: los únicos resultados sin fila.
  if (!('session' in result)) return null;
  return toSessionDto(result.session);
}
