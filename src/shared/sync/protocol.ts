// Contrato del protocolo de sync entre los dispositivos y el hub (§8.4, §9.2,
// §9.3, §14.3). Lo comparten el motor del cliente (src/main/sync/), el núcleo
// del hub (hub/core/) y el Worker (hub/worker/). Solo tipos y constantes: ni
// red ni almacenamiento.
//
// Todas las rutas van bajo `/sync/v1` y llevan el token del dispositivo en
// `Authorization: Bearer ap1.<inquilino>.<secreto>`, salvo `enroll`, que es
// justo la que lo consigue.

import type { CredentialsBundle } from './credentialsBundle';
import type { WireRow } from './merge';

/** Cambia solo si cambia la forma de hablar (§8.7). */
export const PROTOCOL_VERSION = 1;
export const SYNC_BASE_PATH = '/sync/v1';

export const SYNC_ROUTES = {
  enroll: `${SYNC_BASE_PATH}/enroll`,
  status: `${SYNC_BASE_PATH}/status`,
  push: `${SYNC_BASE_PATH}/push`,
  pull: `${SYNC_BASE_PATH}/pull`,
  jobsClaim: `${SYNC_BASE_PATH}/jobs/claim`,
  jobsDone: `${SYNC_BASE_PATH}/jobs/done`,
  igdbCredentials: `${SYNC_BASE_PATH}/igdb-credentials`,
  credentials: `${SYNC_BASE_PATH}/credentials`,
  enrollSecret: `${SYNC_BASE_PATH}/enroll-secret`,
} as const;

/** Máximos por defecto (§8.4). El hub anuncia los suyos en `/status`. */
export const DEFAULT_LIMITS: SyncLimits = {
  pushMaxRows: 200,
  pushMaxBytes: 256 * 1024,
  pushMaxRowBytes: 1536 * 1024,
  pullPageRows: 1000,
};

export interface SyncLimits {
  pushMaxRows: number;
  /** Tamaño máximo del cuerpo JSON de un `push`, en bytes UTF-8. */
  pushMaxBytes: number;
  /**
   * Tamaño máximo del cuerpo de un `push` de UNA sola fila que no cabe en
   * `pushMaxBytes` (un catálogo de logros enorme). Va sola en su lote. Queda
   * por debajo de los 2 MB por fila del SQLite de los Durable Objects. Un hub
   * que no lo anuncia no admite más que `pushMaxBytes`.
   */
  pushMaxRowBytes?: number;
  pullPageRows: number;
}

// ---------- Token del dispositivo (§9.2) ----------

export const TOKEN_PREFIX = 'ap1';

export interface ParsedDeviceToken {
  tenantId: string;
  secret: string;
}

/** `ap1.<inquilino>.<secreto>`. Null si no tiene esa forma. */
export function parseDeviceToken(token: string): ParsedDeviceToken | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const [, tenantId, secret] = parts;
  if (!/^[0-9a-zA-Z_-]{1,64}$/.test(tenantId) || !/^[0-9a-zA-Z_-]{16,128}$/.test(secret)) {
    return null;
  }
  return { tenantId, secret };
}

// ---------- Secreto de alta (§9.3, §19.3.1) ----------

export const ENROLL_SECRET_PREFIX = 'aes1';

/** El secreto de alta caduca a los 7 días (§19.3.1). */
export const ENROLL_SECRET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Forma de lo que viaja: `aes1.<inquilino>.<secreto>`. Como el token, lleva el
 * inquilino delante para que el Worker sepa a qué Durable Object enrutar el
 * canje; lo secreto son los 43 caracteres base64url finales (258 bits).
 */
export function isEnrollSecretShape(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128) return false;
  const parts = value.split('.');
  return (
    parts.length === 3 &&
    parts[0] === ENROLL_SECRET_PREFIX &&
    /^[0-9a-zA-Z_-]{1,64}$/.test(parts[1]) &&
    /^[0-9a-zA-Z_-]{43}$/.test(parts[2])
  );
}

export function formatDeviceToken(tenantId: string, secret: string): string {
  return `${TOKEN_PREFIX}.${tenantId}.${secret}`;
}

// ---------- Errores ----------

/**
 * Códigos de error de una petición entera (respuesta no 2xx con cuerpo
 * `SyncErrorBody`). Los rechazos de filas sueltas van en `PushResponse`.
 *
 * - `unauthorized`: token ausente, mal formado, desconocido o revocado (401).
 * - `protocol_mismatch`: el hub no habla esta `protocolVersion` (426).
 * - `schema_too_old`: el cliente está por debajo de `minSchema` (426). El
 *   cliente deja de sincronizar y sigue en local (§8.7, E-15).
 * - `quota_exceeded`: Cloudflare agotó un cupo diario (§9.7) (503). Se
 *   reintenta más tarde sin perder nada.
 * - `invalid_request`: cuerpo mal formado o por encima de los límites (400).
 * - `enroll_code_invalid`: código de emparejado o secreto de alta desconocido, usado,
 *   sustituido o caducado (400). Son indistinguibles desde fuera.
 * - `not_found`: ruta desconocida (404).
 * - `rate_limited`: demasiados intentos fallidos de emparejado; el hub
 *   bloquea un rato y lo dice en `Retry-After` (429).
 * - `forbidden`: sesión válida sin permiso para esa acción (403). Solo en las
 *   rutas de la PWA.
 * - `conflict`: la acción choca con lo que ya existe, p. ej. invitar a quien
 *   ya tiene espacio (409). Solo en las rutas de la PWA.
 * - `igdb_not_configured`: la PWA pide algo de IGDB y ningún PC ha subido
 *   todavía las claves de Twitch (F-29): hay que abrir Afterplay en el PC una
 *   vez (409). Solo en las rutas de la PWA.
 * - `igdb_unavailable`: Twitch o IGDB no contestaron a tiempo o rechazaron la
 *   petición (502). Se reintenta más tarde. Solo en las rutas de la PWA.
 * - `internal`: fallo inesperado del hub, sin detalle (500). Se reintenta.
 */
export type SyncErrorCode =
  | 'unauthorized'
  | 'protocol_mismatch'
  | 'schema_too_old'
  | 'quota_exceeded'
  | 'invalid_request'
  | 'enroll_code_invalid'
  | 'not_found'
  | 'rate_limited'
  | 'forbidden'
  | 'conflict'
  | 'igdb_not_configured'
  | 'igdb_unavailable'
  | 'internal';

export interface SyncErrorBody {
  error: SyncErrorCode;
  message: string;
  /** Con `schema_too_old`: el mínimo que admite el hub. */
  minSchema?: number;
}

// ---------- Cabeceras comunes ----------

/**
 * Lo que todo cliente declara en `status`, `push` y `pull` para que el hub
 * compruebe versiones (§8.7). En las rutas GET (`status`, `pull`) va en la
 * query: `?protocolVersion=1&schemaVersion=N`; en las POST, dentro del cuerpo.
 * Si falta o no es un entero, el hub responde `invalid_request`.
 */
export interface ClientVersion {
  protocolVersion: number;
  schemaVersion: number;
}

/**
 * Identidad del hub. Si cambia `hubId` o `epoch` (hub nuevo o restaurado), o
 * si el cursor del cliente es mayor que `seq`, el cliente pone el cursor a
 * cero y vuelve a subirlo todo (§8.4).
 */
export interface HubIdentity {
  hubId: string;
  epoch: number;
}

// ---------- GET /status ----------

export interface StatusResponse extends HubIdentity {
  protocolVersion: number;
  /** Rango de `schemaVersion` que acepta el hub. */
  minSchema: number;
  maxSchema: number;
  /** Hora del hub en ms: con ella el cliente detecta y corrige un reloj adelantado (§8.2). */
  serverTime: number;
  /** Secuencia actual del inquilino. */
  seq: number;
  limits: SyncLimits;
}

// ---------- POST /push ----------

export interface PushRequest extends ClientVersion {
  rows: WireRow[];
}

/**
 * Motivo por el que el hub rechaza UNA fila (las demás del lote siguen).
 *
 * - `clock_ahead`: algún reloj de la fila supera la hora del hub en más de
 *   `MAX_AHEAD_MS` (§8.2, E-23). El cliente corrige su reloj y la reenvía.
 * - `unknown_table`: tabla que el hub no tiene (no debería pasar: el hub va
 *   siempre por delante, §8.7).
 * - `invalid_row`: forma inválida (relojes mal formados o que faltan, id
 *   vacío, valores que no son de SQL).
 * - `reserved_device`: firmada con el id corto reservado `000000`, que solo
 *   usa el propio hub (§8.2).
 */
export type PushRejectReason = 'clock_ahead' | 'unknown_table' | 'invalid_row' | 'reserved_device';

export interface RowRef {
  table: string;
  id: string;
}

export interface PushRejection extends RowRef {
  reason: PushRejectReason;
}

export interface PushResponse extends HubIdentity {
  /** Filas fusionadas (hayan cambiado algo o no). */
  accepted: RowRef[];
  rejected: PushRejection[];
  /** Secuencia del inquilino tras el lote. */
  seq: number;
  serverTime: number;
}

// ---------- GET /pull?since=N&limit=M ----------

export interface PullResponse extends HubIdentity {
  /** Filas con `syncSeq > since`, en orden de `syncSeq`. */
  rows: WireRow[];
  /** Cursor para la siguiente página (la `syncSeq` de la última fila entregada, o `since`). */
  next: number;
  /** Quedan más filas después de `next`. */
  more: boolean;
  seq: number;
}

// ---------- POST /enroll (§9.3) ----------

/**
 * Se canjea una de dos cosas, exactamente una: `code`, el código de un solo uso
 * que muestra la PWA ("Añadir dispositivo"), o `enrollSecret`, el secreto de
 * alta de varios usos que deja el primer PC en la migración (`POST
 * /enroll-secret`). Si vienen los dos o ninguno, el canje falla. Cada canje
 * correcto crea un token NUEVO para el dispositivo, en ambos casos.
 */
export interface EnrollRequest extends ClientVersion {
  code?: string;
  enrollSecret?: string;
  /** El `machineId` del PC (id de su fila en `devices`). */
  deviceId: string;
  deviceName: string;
}

export interface EnrollResponse extends HubIdentity {
  /** `ap1.<inquilino>.<secreto>`: el PC lo guarda cifrado con sus credenciales. */
  token: string;
  tenantId: string;
  /**
   * Id corto de reloj que el hub asigna a este dispositivo, único dentro del
   * inquilino (§8.2). Sustituye al sorteado en local.
   */
  shortDeviceId: string;
  serverTime: number;
}

// ---------- POST /enroll-secret (§9.3, §19.3.1) ----------

/** Va con el token del dispositivo y sin cuerpo. Sustituye al secreto anterior. */
export interface EnrollSecretResponse {
  /** `aes1.<inquilino>.<secreto>`. Solo se ve aquí: el hub guarda su huella. */
  enrollSecret: string;
  /** ms desde la época: 7 días tras la emisión. */
  expiresAt: number;
}

// ---------- POST /jobs/claim y /jobs/done (§14.3) ----------

export type JobKind = 'memory' | 'curiosities' | 'radar' | 'refresh_all' | 'enrich';

export interface JobClaimRequest {
  kind: JobKind;
  key: string;
  /** Duración de la concesión en segundos. */
  ttlSec: number;
}

export type JobClaimResponse =
  | { granted: true; leaseId: string; expiresAt: number }
  | {
      granted: false;
      /** Dispositivo que la tiene, y hasta cuándo. */
      holderDeviceId: string;
      expiresAt: number;
    };

export interface JobDoneRequest {
  leaseId: string;
  outcome: 'ok' | 'failed';
  reason?: string;
}

export interface JobDoneResponse {
  closed: boolean;
}

// ---------- POST /igdb-credentials (F-29) ----------

/**
 * Las claves de Twitch/IGDB de la persona, que el PC sube para que la PWA
 * pueda buscar juegos. El hub las guarda CIFRADAS con `HUB_SECRETS_KEY` y no
 * las devuelve jamás: la respuesta solo confirma que están guardadas.
 */
export interface IgdbCredentialsRequest {
  clientId: string;
  clientSecret: string;
}

export interface IgdbCredentialsResponse {
  stored: true;
}

/** Tope de cada clave: las de Twitch miden 30 caracteres; esto solo corta basura. */
export const IGDB_KEY_MAX_LENGTH = 200;

// ---------- POST /credentials ----------

/**
 * Las credenciales de servicios de este PC. El hub las fusiona con las que ya
 * tiene (clave a clave, gana la más nueva) y devuelve el resultado: una sola
 * vuelta sube y baja. Se guardan CIFRADAS; ver `credentialsBundle.ts`.
 */
export interface CredentialsExchangeRequest {
  entries: CredentialsBundle;
}

export interface CredentialsExchangeResponse {
  entries: CredentialsBundle;
}

// ---------- Transporte ----------

/**
 * Cómo habla el motor del cliente con un hub. Hay dos implementaciones: la
 * HTTP (src/main/sync/) y la de proceso para el arnés de convergencia (§17.2),
 * que llama a `hub-core` directamente. Los errores de petición entera se
 * lanzan como `SyncRequestError`.
 */
export interface SyncTransport {
  status(version: ClientVersion): Promise<StatusResponse>;
  push(request: PushRequest): Promise<PushResponse>;
  pull(since: number, limit: number, version: ClientVersion): Promise<PullResponse>;
  claimJob(request: JobClaimRequest): Promise<JobClaimResponse>;
  doneJob(request: JobDoneRequest): Promise<JobDoneResponse>;
}

/** Error de una petición entera, con su código del protocolo. */
export class SyncRequestError extends Error {
  readonly code: SyncErrorCode | 'network';
  readonly status: number | null;
  readonly body: SyncErrorBody | null;

  constructor(
    code: SyncErrorCode | 'network',
    message: string,
    status: number | null = null,
    body: SyncErrorBody | null = null,
  ) {
    super(message);
    this.name = 'SyncRequestError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}
