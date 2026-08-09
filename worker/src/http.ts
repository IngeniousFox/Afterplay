// Todas las respuestas de datos salen por aquí, y por eso la cabecera de
// caché se pone en UN sitio.
//
// §5.2 regla 3: si la CDN (o cualquier proxy intermedio) cachea una respuesta
// con los juegos de uno y se la sirve al otro, has construido exactamente la
// fuga que el multiinquilino intentaba evitar. `private` prohíbe cachés
// compartidas; `no-store` prohíbe guardarla en disco siquiera. Los estáticos
// de la PWA sí se cachean —los sirve Pages, no esto—; los datos jamás.
const NO_STORE = 'private, no-store, max-age=0, must-revalidate';

const baseHeaders = (): Headers =>
  new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': NO_STORE,
    // La respuesta nunca es HTML, así que nada debería interpretarla como tal.
    'x-content-type-options': 'nosniff',
    // Y por si acaso alguien la abre directa en el navegador.
    'referrer-policy': 'no-referrer',
  });

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: baseHeaders() });

// Los errores llevan un `code` estable además del mensaje: la PWA distingue
// "actualiza Afterplay en tu PC" (§5.4) de "no tienes acceso" sin parsear
// texto en castellano.
export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'schema_outdated'
  | 'upstream_unavailable'
  | 'internal';

export const fail = (code: ApiErrorCode, message: string, status: number): Response =>
  json({ error: { code, message } }, status);

// El desajuste de esquema tiene su propio camino porque su cura no es
// reintentar: la base de ese inquilino todavía no ha visto la migración,
// y solo se la aplica su ESCRITORIO al arrancar (§5.4). La web no puede
// hacer nada salvo decirlo con claridad — reventar con un error de SQL en
// bruto sería lo peor de los dos mundos.
const SCHEMA_HINTS = ['no such table', 'no such column', 'has no column named'];

export const isSchemaOutdated = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return SCHEMA_HINTS.some((hint) => message.includes(hint));
};
