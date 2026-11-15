// Resultado de una llamada a un Durable Object. Un error lanzado dentro de un
// DO cruza la RPC sin su clase ni sus campos (se pierde `HubError.code`), así
// que los errores del protocolo viajan como VALOR, no como excepción.

import type { SyncErrorBody } from '../../../src/shared/sync/protocol';

export type Outcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: SyncErrorBody;
      /** Con un bloqueo por demasiados intentos: segundos hasta poder reintentar. */
      retryAfterSec?: number;
    };

export const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
