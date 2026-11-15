// Enrutado y decisiones de autenticación del Worker. No importa nada de
// Cloudflare: todo lo que toca el runtime (Durable Objects, Access, reloj) llega
// por `Backend`, así que los tests lo prueban con dobles. `index.ts` es el
// pegamento que construye el `Backend` real.
//
// Dos puertas (§9.2):
//  · `/sync/v1/*`: token del dispositivo. El Worker lo parsea solo para saber a
//    qué inquilino enrutar; quien comprueba el secreto es su `TenantHub`.
//  · `/api/v2/*`: Cloudflare Access + correo -> inquilino en `Directory`.
//    Fallo cerrado: correo desconocido, 403.

import {
  DEFAULT_LIMITS,
  SYNC_BASE_PATH,
  SYNC_ROUTES,
  parseDeviceToken,
  type ClientVersion,
  type EnrollRequest,
  type EnrollResponse,
  type IgdbCredentialsResponse,
  type JobClaimRequest,
  type JobClaimResponse,
  type JobDoneRequest,
  type JobDoneResponse,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type StatusResponse,
  type SyncErrorBody,
} from '../../../src/shared/sync/protocol';
import type { DeviceTokenInfo } from '../../core/hub';
import { AccessError } from './access';
import type { InviteResult } from './directoryStore';
import { normalizeEmail } from './emailIdentity';
import { formatEnrollCode, splitEnrollCode } from './enrollCode';
import { apiError, classifyUnexpected, errorResponse, jsonResponse } from './errors';
import type { Outcome } from './outcome';
import type { WebRequest } from './web/types';

// ---------- Lo que el router necesita del exterior ----------

/** Lo que expone un `TenantHub` (RPC del Durable Object). */
export interface TenantApi {
  status(token: string, version: ClientVersion): Promise<Outcome<StatusResponse>>;
  push(token: string, request: PushRequest): Promise<Outcome<PushResponse>>;
  pull(
    token: string,
    since: number,
    limit: number,
    version: ClientVersion,
  ): Promise<Outcome<PullResponse>>;
  claimJob(token: string, request: JobClaimRequest): Promise<Outcome<JobClaimResponse>>;
  doneJob(token: string, request: JobDoneRequest): Promise<Outcome<JobDoneResponse>>;
  /** Las claves de IGDB del PC; el hub las guarda cifradas (F-29). */
  storeIgdbCredentials(token: string, request: unknown): Promise<Outcome<IgdbCredentialsResponse>>;
  enroll(request: EnrollRequest): Promise<Outcome<EnrollResponse>>;
  createEnrollmentCode(ttlMinutes?: number): Promise<Outcome<{ code: string; expiresAt: number }>>;
  listTokens(): Promise<Outcome<DeviceTokenInfo[]>>;
  revokeToken(tokenId: string): Promise<Outcome<{ revoked: boolean }>>;
  /** La API de la PWA (§13), ya autenticada: se reparte dentro del DO (web/routes.ts). */
  web(request: WebRequest): Promise<Outcome<unknown>>;
}

export interface DirectoryApi {
  resolve(
    email: string,
    adminEmail: string | undefined,
  ): Promise<{ tenantId: string; created: boolean } | null>;
  invite(email: string, invitedBy: string): Promise<InviteResult>;
}

export interface Backend {
  tenant(tenantId: string): TenantApi;
  directory: DirectoryApi;
  /** ¿Existe este inquilino? Evita crear Durable Objects para ids inventados. */
  tenantExists(tenantId: string): Promise<boolean>;
  /** Valida el JWT de Access. Lanza `AccessError`. */
  authenticateAccess(request: Request): Promise<{ email: string }>;
  adminEmail: string | undefined;
}

// ---------- Utilidades ----------

/** Tamaño máximo de los cuerpos que no son `push`. */
export const SMALL_BODY_MAX_BYTES = 16 * 1024;

class RequestError extends Error {
  constructor(readonly body: SyncErrorBody) {
    super(body.message);
  }
}

const invalid = (message: string): RequestError =>
  new RequestError({ error: 'invalid_request', message });

/**
 * Lee el cuerpo como texto sin pasar de `maxBytes`. Se comprueba la cabecera
 * `Content-Length` (rechazo barato) Y se cuentan los bytes mientras se lee,
 * porque la cabecera la puede mentir o faltar (transfer chunked). Se corta
 * ANTES de decodificar y de parsear JSON.
 */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    throw invalid(`el cuerpo supera el máximo de ${maxBytes} bytes`);
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw invalid(`el cuerpo supera el máximo de ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const text = await readLimitedText(request, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid('el cuerpo no es JSON válido');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid('el cuerpo debe ser un objeto JSON');
  }
  return parsed as Record<string, unknown>;
}

function outcomeResponse<T>(outcome: Outcome<T>, successStatus = 200): Response {
  if (outcome.ok) return jsonResponse(outcome.value, successStatus);
  if (outcome.retryAfterSec !== undefined) {
    // El bloqueo por demasiados intentos es un 429 con el mismo código del
    // protocolo (`enroll_code_invalid`): el cliente lo muestra como un fallo de código.
    return errorResponse(outcome.error, {
      status: 429,
      headers: { 'Retry-After': String(outcome.retryAfterSec) },
    });
  }
  return errorResponse(outcome.error);
}

const methodNotAllowed = (allow: string): Response =>
  errorResponse(apiError('not_found', 'método no permitido'), {
    status: 405,
    headers: { Allow: allow },
  });

function intParam(url: URL, name: string): number {
  const raw = url.searchParams.get(name);
  if (raw === null || !/^\d{1,15}$/.test(raw)) throw invalid(`${name} debe ser un entero >= 0`);
  return Number(raw);
}

function versionFromQuery(url: URL): ClientVersion {
  return {
    protocolVersion: intParam(url, 'protocolVersion'),
    schemaVersion: intParam(url, 'schemaVersion'),
  };
}

/** `Authorization: Bearer ap1.<inquilino>.<secreto>` -> token entero y su inquilino. */
export function bearerToken(request: Request): { token: string; tenantId: string } | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const parsed = parseDeviceToken(match[1]);
  return parsed ? { token: match[1], tenantId: parsed.tenantId } : null;
}

// ---------- /sync/v1/* ----------

const SYNC_PATHS = new Set<string>(Object.values(SYNC_ROUTES));
const SYNC_METHODS: Record<string, string> = {
  [SYNC_ROUTES.enroll]: 'POST',
  [SYNC_ROUTES.status]: 'GET',
  [SYNC_ROUTES.push]: 'POST',
  [SYNC_ROUTES.pull]: 'GET',
  [SYNC_ROUTES.jobsClaim]: 'POST',
  [SYNC_ROUTES.jobsDone]: 'POST',
  [SYNC_ROUTES.igdbCredentials]: 'POST',
};

async function handleSync(request: Request, url: URL, backend: Backend): Promise<Response> {
  const path = url.pathname;
  if (!SYNC_PATHS.has(path)) {
    return errorResponse(apiError('not_found', 'ruta desconocida'));
  }
  if (request.method !== SYNC_METHODS[path]) return methodNotAllowed(SYNC_METHODS[path]);

  if (path === SYNC_ROUTES.enroll) return handleEnroll(request, backend);

  // Todo lo demás exige token. Se rechaza ANTES de leer el cuerpo y de tocar
  // ningún Durable Object: sin token, un push de 256 KB no cuesta nada.
  const bearer = bearerToken(request);
  if (!bearer || !(await backend.tenantExists(bearer.tenantId))) {
    return errorResponse(apiError('unauthorized', 'token no válido'));
  }
  const tenant = backend.tenant(bearer.tenantId);
  const { token } = bearer;

  switch (path) {
    case SYNC_ROUTES.status:
      return outcomeResponse(await tenant.status(token, versionFromQuery(url)));
    case SYNC_ROUTES.pull: {
      const since = intParam(url, 'since');
      const limit = url.searchParams.has('limit')
        ? intParam(url, 'limit')
        : DEFAULT_LIMITS.pullPageRows;
      return outcomeResponse(await tenant.pull(token, since, limit, versionFromQuery(url)));
    }
    case SYNC_ROUTES.push: {
      const body = await readJsonObject(request, DEFAULT_LIMITS.pushMaxBytes);
      return outcomeResponse(await tenant.push(token, body as unknown as PushRequest));
    }
    case SYNC_ROUTES.jobsClaim: {
      const body = await readJsonObject(request, SMALL_BODY_MAX_BYTES);
      return outcomeResponse(await tenant.claimJob(token, body as unknown as JobClaimRequest));
    }
    case SYNC_ROUTES.igdbCredentials: {
      const body = await readJsonObject(request, SMALL_BODY_MAX_BYTES);
      return outcomeResponse(await tenant.storeIgdbCredentials(token, body));
    }
    default: {
      const body = await readJsonObject(request, SMALL_BODY_MAX_BYTES);
      return outcomeResponse(await tenant.doneJob(token, body as unknown as JobDoneRequest));
    }
  }
}

/**
 * `enroll` no lleva token: el código que teclea la persona trae el inquilino
 * delante (enrollCode.ts). Un código con mala forma, de un inquilino que no
 * existe o de otro inquilino se ven IGUAL desde fuera (`enroll_code_invalid`),
 * para que no sirva de oráculo de qué ids existen. El bloqueo por intentos
 * está dentro del inquilino (tenantService.ts).
 */
async function handleEnroll(request: Request, backend: Backend): Promise<Response> {
  const body = await readJsonObject(request, SMALL_BODY_MAX_BYTES);
  const invalidCode = errorResponse({
    error: 'enroll_code_invalid',
    message: 'código de emparejado desconocido, usado o caducado',
  });
  const split = splitEnrollCode(body.code);
  if (!split || !(await backend.tenantExists(split.tenantId))) return invalidCode;
  const outcome = await backend
    .tenant(split.tenantId)
    .enroll({ ...(body as unknown as EnrollRequest), code: split.code });
  return outcomeResponse(outcome);
}

// ---------- /api/v2/* (PWA, tras Access) ----------

const API_PREFIX = '/api/v2';
const TOKEN_ID_PATTERN = /^[0-9a-zA-Z-]{1,64}$/;

/**
 * Las peticiones que cambian algo y llegan con `Origin` de otro sitio se
 * rechazan: la cookie de Access viaja sola, y esto es lo que impide que una
 * página ajena genere códigos de emparejado con la sesión de la persona.
 */
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  return origin === null || origin === url.origin;
}

async function handleApi(request: Request, url: URL, backend: Backend): Promise<Response> {
  if (request.method !== 'GET' && !sameOrigin(request, url)) {
    return errorResponse(apiError('forbidden', 'origen no permitido'));
  }

  let identity: { email: string };
  try {
    identity = await backend.authenticateAccess(request);
  } catch (error) {
    if (error instanceof AccessError) {
      return errorResponse(apiError('unauthorized', 'sesión de Access no válida'));
    }
    throw error;
  }
  const email = normalizeEmail(identity.email);

  const resolved = await backend.directory.resolve(email, backend.adminEmail);
  if (!resolved) return errorResponse(apiError('forbidden', 'esta cuenta no tiene acceso'));
  const tenant = backend.tenant(resolved.tenantId);

  const route = url.pathname.slice(API_PREFIX.length);

  if (route === '/devices/enroll-code') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const outcome = await tenant.createEnrollmentCode();
    if (!outcome.ok) return outcomeResponse(outcome);
    return jsonResponse({
      code: formatEnrollCode(resolved.tenantId, outcome.value.code),
      expiresAt: outcome.value.expiresAt,
    });
  }

  if (route === '/devices') {
    if (request.method !== 'GET') return methodNotAllowed('GET');
    return outcomeResponse(await tenant.listTokens());
  }

  const revoke = route.match(/^\/devices\/([^/]+)\/revoke$/);
  if (revoke) {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    if (!TOKEN_ID_PATTERN.test(revoke[1]))
      return errorResponse(apiError('not_found', 'token desconocido'));
    const outcome = await tenant.revokeToken(revoke[1]);
    if (outcome.ok && !outcome.value.revoked) {
      return errorResponse(apiError('not_found', 'token desconocido o ya revocado'));
    }
    return outcomeResponse(outcome);
  }

  if (route === '/invitations') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    // Solo el anfitrión. Sin ADMIN_EMAIL configurado nadie lo es.
    if (!backend.adminEmail || normalizeEmail(backend.adminEmail) !== email) {
      return errorResponse(apiError('forbidden', 'solo el anfitrión puede invitar'));
    }
    const body = await readJsonObject(request, SMALL_BODY_MAX_BYTES);
    if (typeof body.email !== 'string') throw invalid('falta email');
    const result = await backend.directory.invite(body.email, email);
    if (result.ok) return jsonResponse(result.invitation, 201);
    return result.reason === 'invalid_email'
      ? errorResponse(apiError('invalid_request', 'correo no válido'))
      : errorResponse(apiError('conflict', 'esa persona ya tiene su propio espacio'));
  }

  // El resto es la API de la PWA, que vive en el Durable Object (web/routes.ts).
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST');
  let body: unknown = null;
  if (request.method === 'POST') {
    const text = await readLimitedText(request, SMALL_BODY_MAX_BYTES);
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        throw invalid('el cuerpo no es JSON válido');
      }
    }
  }
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) if (!(key in query)) query[key] = value;
  return outcomeResponse(await tenant.web({ method: request.method, path: route, query, body }));
}

// ---------- Entrada ----------

export async function handleRequest(request: Request, backend: Backend): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.pathname.startsWith(`${SYNC_BASE_PATH}/`))
      return await handleSync(request, url, backend);
    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      return await handleApi(request, url, backend);
    }
    // La PWA (fase 5) y el resto no existen todavía.
    return errorResponse(apiError('not_found', 'ruta desconocida'));
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.body);
    // Nunca se devuelve el mensaje ni el stack: solo texto fijo. El detalle va al log.
    console.error('hub: error inesperado', error);
    return errorResponse(classifyUnexpected(error));
  }
}
