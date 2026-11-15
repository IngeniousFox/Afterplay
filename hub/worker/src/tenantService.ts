// Todo lo que hace un `TenantHub` por encima del núcleo: autenticar cada
// llamada, proteger el emparejado contra fuerza bruta y traducir `HubError` a
// valores (`Outcome`). Es TypeScript puro sobre `SqlStorage`: el Durable Object
// (`do/tenantHub.ts`) es una envoltura fina y esto se prueba con SQLite de Node.

import {
  TenantHub,
  HubError,
  type DeviceTokenInfo,
  type HubDevice,
  type HubOptions,
  type SweepResult,
} from '../../core/hub';
import type { SqlStorage } from '../../core/storage';
import type {
  ClientVersion,
  EnrollRequest,
  EnrollResponse,
  JobClaimRequest,
  JobClaimResponse,
  JobDoneRequest,
  JobDoneResponse,
  PullResponse,
  PushRequest,
  PushResponse,
  StatusResponse,
} from '../../../src/shared/sync/protocol';
import type { EnrollmentCode } from '../../core/hub';
import { ok, type Outcome } from './outcome';

// ---------- Fuerza bruta sobre el emparejado ----------

/** Fallos tolerados dentro de una ventana antes de bloquear. */
export const ENROLL_MAX_FAILURES = 5;
export const ENROLL_WINDOW_MS = 10 * 60_000;
export const ENROLL_LOCK_MS = 15 * 60_000;

/**
 * Contador de intentos fallidos de `enroll` de UN inquilino (vive en su DO).
 *
 * Un código tiene 50 bits y caduca en minutos; con 5 intentos cada ~25 minutos
 * adivinarlo es inviable. El contador es por inquilino y no por IP porque la
 * IP la puede cambiar el atacante y porque el id del inquilino ya filtra a
 * quién se ataca: el peor caso de "denegación de servicio" es que alguien que
 * conoce el id de un inquilino bloquee 15 min el emparejado de ESA persona, que
 * puede esperar o generar otro código tras el bloqueo. Mientras dura el
 * bloqueo se rechaza TAMBIÉN el código correcto (comprobar antes de mirar el
 * código es lo que impide que el atacante use el bloqueo como oráculo).
 */
export class EnrollThrottle {
  constructor(
    private readonly storage: SqlStorage,
    private readonly now: () => number,
  ) {
    storage.execScript(`CREATE TABLE IF NOT EXISTS worker_enroll_throttle (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  failures INTEGER NOT NULL,
  windowStart INTEGER NOT NULL,
  lockedUntil INTEGER NOT NULL
);`);
  }

  /** Segundos que faltan para poder reintentar, o 0 si no está bloqueado. */
  lockedForSec(): number {
    const row = this.storage.exec(`SELECT lockedUntil FROM worker_enroll_throttle WHERE id = 1`)[0];
    if (!row) return 0;
    const left = Number(row.lockedUntil) - this.now();
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  recordFailure(): void {
    const now = this.now();
    this.storage.transactionSync(() => {
      const row = this.storage.exec(
        `SELECT failures, windowStart FROM worker_enroll_throttle WHERE id = 1`,
      )[0];
      let failures = 1;
      let windowStart = now;
      if (row && now - Number(row.windowStart) <= ENROLL_WINDOW_MS) {
        failures = Number(row.failures) + 1;
        windowStart = Number(row.windowStart);
      }
      let lockedUntil = 0;
      if (failures >= ENROLL_MAX_FAILURES) {
        lockedUntil = now + ENROLL_LOCK_MS;
        failures = 0;
      }
      this.storage.exec(
        `INSERT INTO worker_enroll_throttle (id, failures, windowStart, lockedUntil) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET failures = excluded.failures, windowStart = excluded.windowStart, lockedUntil = excluded.lockedUntil`,
        failures,
        windowStart,
        lockedUntil,
      );
    });
  }

  reset(): void {
    this.storage.exec(`DELETE FROM worker_enroll_throttle`);
  }

  /** La alarma lo limpia cuando ya no hay nada que recordar. */
  sweep(): void {
    const now = this.now();
    this.storage.exec(
      `DELETE FROM worker_enroll_throttle WHERE lockedUntil <= ? AND windowStart + ? <= ?`,
      now,
      ENROLL_WINDOW_MS,
      now,
    );
  }
}

// ---------- Identidad del inquilino ----------

/**
 * Fija (la primera vez) o comprueba (las siguientes) a qué inquilino pertenece
 * este almacenamiento. El Worker pasa el id en cada llamada: no se confía en
 * `ctx.id.name`. Si un objeto recibiera alguna vez el id de otro inquilino
 * (bug de enrutado), fallaría aquí en vez de emitir tokens con un id ajeno.
 */
export function claimTenantIdentity(storage: SqlStorage, tenantId: string): void {
  storage.execScript(
    `CREATE TABLE IF NOT EXISTS worker_identity (id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1), tenantId TEXT NOT NULL);`,
  );
  storage.transactionSync(() => {
    storage.exec(`INSERT OR IGNORE INTO worker_identity (id, tenantId) VALUES (1, ?)`, tenantId);
    const stored = String(
      storage.exec(`SELECT tenantId FROM worker_identity WHERE id = 1`)[0].tenantId,
    );
    if (stored !== tenantId) {
      throw new Error(`este almacenamiento es del inquilino ${stored}, no de ${tenantId}`);
    }
  });
}

/** El inquilino ya fijado en este almacenamiento, o null si aún no se ha usado. */
export function readTenantIdentity(storage: SqlStorage): string | null {
  const exists = storage.exec(
    `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'worker_identity'`,
  );
  if (exists.length === 0) return null;
  const row = storage.exec(`SELECT tenantId FROM worker_identity WHERE id = 1`)[0];
  return row ? String(row.tenantId) : null;
}

// ---------- El servicio ----------

export const ENROLL_CODE_TTL_MINUTES = 10;

export class TenantService {
  readonly hub: TenantHub;
  private readonly throttle: EnrollThrottle;

  constructor(
    storage: SqlStorage,
    private readonly now: () => number,
    options: HubOptions,
  ) {
    this.hub = new TenantHub(storage, now, options);
    this.throttle = new EnrollThrottle(storage, now);
  }

  /** Ejecuta `fn` y convierte los errores del protocolo en valor. El resto se relanza. */
  private async run<T>(fn: () => T | Promise<T>): Promise<Outcome<T>> {
    try {
      return ok(await fn());
    } catch (error) {
      if (error instanceof HubError) return { ok: false, error: error.toBody() };
      // `ttlMinutes` y similares: entrada inválida del llamador, no un fallo interno.
      if (error instanceof RangeError) {
        return { ok: false, error: { error: 'invalid_request', message: error.message } };
      }
      throw error;
    }
  }

  /** Autentica con el token completo y ejecuta `fn` con el dispositivo. */
  private authed<T>(token: string, fn: (device: HubDevice) => T): Promise<Outcome<T>> {
    return this.run(async () => fn(await this.hub.authenticateToken(token)));
  }

  status(token: string, version: ClientVersion): Promise<Outcome<StatusResponse>> {
    return this.authed(token, () => this.hub.status(version));
  }

  push(token: string, request: PushRequest): Promise<Outcome<PushResponse>> {
    return this.authed(token, () => this.hub.push(request));
  }

  pull(
    token: string,
    since: number,
    limit: number,
    version: ClientVersion,
  ): Promise<Outcome<PullResponse>> {
    return this.authed(token, () => this.hub.pull(since, limit, version));
  }

  claimJob(token: string, request: JobClaimRequest): Promise<Outcome<JobClaimResponse>> {
    return this.authed(token, (device) => this.hub.claimJob(device, request));
  }

  doneJob(token: string, request: JobDoneRequest): Promise<Outcome<JobDoneResponse>> {
    return this.authed(token, (device) => this.hub.doneJob(device, request));
  }

  /** Canje de un código (sin token). Con bloqueo por intentos fallidos. */
  async enroll(request: EnrollRequest): Promise<Outcome<EnrollResponse>> {
    const lockedFor = this.throttle.lockedForSec();
    if (lockedFor > 0) {
      return {
        ok: false,
        error: {
          error: 'rate_limited',
          message: `demasiados intentos fallidos: espera ${Math.ceil(lockedFor / 60)} min`,
        },
        retryAfterSec: lockedFor,
      };
    }
    const outcome = await this.run(() => this.hub.enroll(request));
    if (outcome.ok) this.throttle.reset();
    else if (outcome.error.error === 'enroll_code_invalid') this.throttle.recordFailure();
    return outcome;
  }

  // ---- Administración (las llama la PWA, ya autenticada por Access) ----

  createEnrollmentCode(
    ttlMinutes: number = ENROLL_CODE_TTL_MINUTES,
  ): Promise<Outcome<EnrollmentCode>> {
    return this.run(() => this.hub.createEnrollmentCode({ ttlMinutes }));
  }

  listTokens(): Outcome<DeviceTokenInfo[]> {
    return ok(this.hub.listTokens());
  }

  revokeToken(tokenId: string): Outcome<{ revoked: boolean }> {
    return ok({ revoked: this.hub.revokeToken(tokenId) });
  }

  /** Lo que hace la alarma. */
  sweep(): SweepResult {
    this.throttle.sweep();
    return this.hub.sweep();
  }
}
