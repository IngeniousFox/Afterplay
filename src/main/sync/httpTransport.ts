import {
  SYNC_ROUTES,
  SyncRequestError,
  type ClientVersion,
  type EnrollRequest,
  type EnrollResponse,
  type JobClaimRequest,
  type JobClaimResponse,
  type JobDoneRequest,
  type JobDoneResponse,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type StatusResponse,
  type SyncErrorBody,
  type SyncErrorCode,
  type SyncTransport,
} from '../../shared/sync/protocol';

// El transporte HTTP del motor de sync (§8.4): `SyncTransport` sobre `fetch`
// contra la dirección base del hub. Es lo único del motor que toca la red.
//
// El protocolo (`protocol.ts`) no dice dónde viajan `protocolVersion` y
// `schemaVersion` en las rutas GET (`status`, `pull`): aquí van como parámetros
// de la URL con esos mismos nombres. El hub debe leerlos de ahí.

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpTransportOptions {
  /** `https://hub.ejemplo.workers.dev`, con o sin barra final. */
  readonly baseUrl: string;
  /** `ap1.<inquilino>.<secreto>`. */
  readonly token: string;
  /** Tiempo máximo de una petición. Por defecto 30 s. */
  readonly timeoutMs?: number;
  /** Para los tests; por defecto el `fetch` global. */
  readonly fetch?: typeof fetch;
}

const KNOWN_CODES: ReadonlySet<string> = new Set<SyncErrorCode>([
  'unauthorized',
  'protocol_mismatch',
  'schema_too_old',
  'quota_exceeded',
  'invalid_request',
  'enroll_code_invalid',
  'not_found',
  'rate_limited',
  'forbidden',
  'conflict',
  'internal',
]);

function joinUrl(baseUrl: string, path: string, query?: Record<string, string | number>): string {
  // `new URL('/sync/v1/x', base)` descartaría una ruta base del hub
  // (`https://host/api`): se compone a mano para conservarla.
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  return url.toString();
}

interface RequestOptions {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly token?: string;
  readonly body?: unknown;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
}

/**
 * Una petición JSON. Todo lo que no sea una respuesta 2xx con cuerpo JSON se
 * convierte en `SyncRequestError`: los fallos de red, el tiempo agotado y las
 * respuestas que no son del hub llevan el código `network`; un cuerpo
 * `SyncErrorBody` conserva su código.
 */
async function request<T>(options: RequestOptions): Promise<T> {
  const { method, url, token, body, timeoutMs, fetchImpl } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    // El cuerpo se lee dentro del mismo plazo: un hub que responde la cabecera
    // y se queda mudo no puede colgar el ciclo.
    text = await response.text();
  } catch (error) {
    const timedOut = controller.signal.aborted;
    throw new SyncRequestError(
      'network',
      timedOut
        ? `el hub no respondió en ${Math.round(timeoutMs / 1000)} s`
        : `no se pudo contactar con el hub: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    const errorBody = asErrorBody(json);
    if (errorBody) {
      throw new SyncRequestError(errorBody.error, errorBody.message, response.status, errorBody);
    }
    // 5xx de Cloudflare (HTML), 502 de un proxy… Sin cuerpo del protocolo: se
    // trata como fallo de red, que se reintenta con espera creciente.
    throw new SyncRequestError('network', `el hub respondió ${response.status}`, response.status);
  }
  if (json === null || typeof json !== 'object') {
    throw new SyncRequestError('network', 'la respuesta del hub no es JSON', response.status);
  }
  return json as T;
}

function asErrorBody(value: unknown): SyncErrorBody | null {
  if (!value || typeof value !== 'object') return null;
  const { error, message, minSchema } = value as Record<string, unknown>;
  if (typeof error !== 'string' || !KNOWN_CODES.has(error)) return null;
  return {
    error: error as SyncErrorCode,
    message: typeof message === 'string' ? message : error,
    ...(typeof minSchema === 'number' ? { minSchema } : {}),
  };
}

export function createHttpTransport(options: HttpTransportOptions): SyncTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? fetch;
  const call = <T>(
    method: 'GET' | 'POST',
    path: string,
    extra: { query?: Record<string, string | number>; body?: unknown } = {},
  ): Promise<T> =>
    request<T>({
      method,
      url: joinUrl(options.baseUrl, path, extra.query),
      token: options.token,
      body: extra.body,
      timeoutMs,
      fetchImpl,
    });
  const versionQuery = (version: ClientVersion): Record<string, number> => ({
    protocolVersion: version.protocolVersion,
    schemaVersion: version.schemaVersion,
  });

  return {
    status: (version) =>
      call<StatusResponse>('GET', SYNC_ROUTES.status, { query: versionQuery(version) }),
    push: (req: PushRequest) => call<PushResponse>('POST', SYNC_ROUTES.push, { body: req }),
    pull: (since, limit, version) =>
      call<PullResponse>('GET', SYNC_ROUTES.pull, {
        query: { since, limit, ...versionQuery(version) },
      }),
    claimJob: (req: JobClaimRequest) =>
      call<JobClaimResponse>('POST', SYNC_ROUTES.jobsClaim, { body: req }),
    doneJob: (req: JobDoneRequest) =>
      call<JobDoneResponse>('POST', SYNC_ROUTES.jobsDone, { body: req }),
  };
}

/**
 * Canjea un código de emparejado por un token de dispositivo (§9.3). No lleva
 * token: es justo la ruta que lo consigue. Después, `applyEnrollment`
 * (state.ts) guarda el id corto que asigna el hub, y quien llama guarda el
 * token cifrado con las credenciales del PC.
 */
export function enroll(
  baseUrl: string,
  req: EnrollRequest,
  options: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<EnrollResponse> {
  return request<EnrollResponse>({
    method: 'POST',
    url: joinUrl(baseUrl, SYNC_ROUTES.enroll),
    body: req,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetchImpl: options.fetch ?? fetch,
  });
}
