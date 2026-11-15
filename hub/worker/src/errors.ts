// Traducción de errores del hub a HTTP. El protocolo (src/shared/sync/
// protocol.ts) documenta el estado de cada `SyncErrorCode`; aquí se aplica.
// Nunca sale un stack ni el mensaje de un error inesperado: solo texto fijo.

import type { SyncErrorBody, SyncErrorCode } from '../../../src/shared/sync/protocol';

const STATUS: Record<SyncErrorCode, number> = {
  unauthorized: 401,
  protocol_mismatch: 426,
  schema_too_old: 426,
  quota_exceeded: 503,
  invalid_request: 400,
  enroll_code_invalid: 400,
  not_found: 404,
  rate_limited: 429,
  forbidden: 403,
  conflict: 409,
  internal: 500,
};

export const statusFor = (code: SyncErrorCode): number => STATUS[code];

export function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(
  body: SyncErrorBody,
  options: { status?: number; headers?: HeadersInit } = {},
): Response {
  return jsonResponse(body, options.status ?? statusFor(body.error), options.headers);
}

export const apiError = (error: SyncErrorCode, message: string): SyncErrorBody => ({
  error,
  message,
});

// Mensajes con los que el runtime avisa de un cupo diario agotado (§9.7).
const QUOTA_PATTERN = /exceeded allowed|free tier|daily .*limit|quota/i;

/**
 * Un error que no es del protocolo (excepción de Cloudflare, bug). Los cupos
 * agotados se reconocen por su mensaje y salen como `quota_exceeded` (el
 * cliente reintenta más tarde sin perder nada); el resto, como `internal` con
 * un texto fijo. El detalle se queda en el log del Worker.
 */
export function classifyUnexpected(error: unknown): SyncErrorBody {
  const message = error instanceof Error ? error.message : String(error);
  if (QUOTA_PATTERN.test(message)) {
    return apiError(
      'quota_exceeded',
      'cupo diario de Cloudflare agotado; se reintentará más tarde',
    );
  }
  return apiError('internal', 'error interno del hub');
}
