// Núcleo del hub de un inquilino (`TenantHub`, §9). TypeScript puro: habla con
// el almacenamiento solo a través de `SqlStorage` y con el reloj a través de
// `now()`; no importa nada de Cloudflare ni de Node (§9.6).
//
// Reparto síncrono / asíncrono: todo lo que toca las filas sincronizadas
// (`status`, `push`, `pull`, concesiones, barrido) es SÍNCRONO, porque un
// Durable Object no puede esperar dentro de una transacción. Solo el
// emparejado y la autenticación son asíncronos, porque SHA-256 de Web Crypto lo
// es; calculan la huella antes de abrir la transacción.
//
// Los errores de PETICIÓN ENTERA se lanzan como `HubError` con su
// `SyncErrorCode`; el Worker lo traduce a HTTP. Los rechazos de FILAS sueltas
// van en `PushResponse.rejected` y no abortan el lote.

import {
  isClock,
  maxClock,
  parseClock,
  successor,
  BOTTOM,
  RESERVED_DEVICE_ID,
  MAX_AHEAD_MS,
} from '../../src/shared/sync/clock';
import { TIMER_STALE_MS } from '../../src/shared/timerFreshness';
import {
  canonical,
  decodeStored,
  encodeStored,
  fromWire,
  mergeRows,
  project,
  toWire,
  type RowState,
  type SqlRow,
  type SqlValue,
  type WireRow,
} from '../../src/shared/sync/merge';
import { DELETED_COLUMN } from '../../src/shared/sync/fieldClocks';
import { isDeviceShortId, isReservedDeviceShortId } from '../../src/shared/sync/clock';
import {
  DEFAULT_LIMITS,
  PROTOCOL_VERSION,
  formatDeviceToken,
  parseDeviceToken,
  type ClientVersion,
  type EnrollRequest,
  type EnrollResponse,
  type HubIdentity,
  type JobClaimRequest,
  type JobClaimResponse,
  type JobDoneRequest,
  type JobDoneResponse,
  type JobKind,
  type PullResponse,
  type PushRejectReason,
  type PushRejection,
  type PushRequest,
  type PushResponse,
  type RowRef,
  type StatusResponse,
  type SyncErrorBody,
  type SyncErrorCode,
  type SyncLimits,
} from '../../src/shared/sync/protocol';
import { APP_SCHEMA_VERSION } from '../../src/main/db/v2/schemaVersion';
import { randomId, randomSecret, randomString, sha256Hex } from './crypto';
import { buildHubTables, ensureSchema, type HubTable } from './schema';
import { ID_CHUNK, MAX_SQL_PARAMS, chunk, type SqlStorage } from './storage';

// ---------- Errores ----------

/** Error de una petición entera. `code` es el del protocolo; el Worker lo mapea a HTTP. */
export class HubError extends Error {
  readonly code: SyncErrorCode;
  readonly minSchema?: number;

  constructor(code: SyncErrorCode, message: string, minSchema?: number) {
    super(message);
    this.name = 'HubError';
    this.code = code;
    this.minSchema = minSchema;
  }

  toBody(): SyncErrorBody {
    return {
      error: this.code,
      message: this.message,
      ...(this.minSchema === undefined ? {} : { minSchema: this.minSchema }),
    };
  }
}

// ---------- Constantes y tipos ----------

/** Cada cuánto como mucho se escribe el "último uso" de un token (ahorra escrituras, §9.7). */
export const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

/** Las concesiones cerradas o caducadas se conservan este tiempo (el motivo de un fallo, §14.3). */
export const LEASE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_LEASE_TTL_SEC = 24 * 60 * 60;
export const MAX_ENROLL_TTL_MINUTES = 7 * 24 * 60;

const JOB_KINDS: readonly JobKind[] = ['memory', 'curiosities', 'radar', 'refresh_all', 'enrich'];

// Alfabeto de Crockford: sin I, L, O, U. 10 caracteres = 50 bits.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 10;
const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SHORT_ID_ATTEMPTS = 64;

export interface HubOptions {
  /** El inquilino al que sirve este hub: va en los tokens `ap1.<inquilino>.<secreto>`. */
  tenantId: string;
  /** Solo para tests: el `hubId` se sortea al crear el hub si no se da. */
  hubId?: string;
  /** Máximos que anuncia `/status`. Por defecto `DEFAULT_LIMITS`. */
  limits?: Partial<SyncLimits>;
  /** Cuánto puede adelantarse un reloj a la hora del hub. Por defecto 10 min (§8.2). */
  maxAheadMs?: number;
  /** Mayor `schemaVersion` que acepta. Por defecto la de este build. */
  maxSchema?: number;
  /** Tablas del hub; por defecto las del registro 2.0. Los tests pasan otras. */
  tables?: readonly HubTable[];
}

/** Dispositivo autenticado por su token. */
export interface HubDevice {
  tokenId: string;
  deviceId: string;
  deviceName: string;
  shortDeviceId: string;
}

/** Un token tal como se lista en Ajustes. Nunca incluye el secreto ni su huella. */
export interface DeviceTokenInfo extends HubDevice {
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface EnrollmentCode {
  /** Lo que se enseña al usuario, p. ej. `K7M2P-9XQ4T`. Solo se ve aquí: el hub guarda su huella. */
  code: string;
  expiresAt: number;
}

export interface SweepResult {
  expiredLeases: number;
  deletedLeases: number;
  deletedEnrollmentCodes: number;
  /** Sesiones abandonadas cerradas por el barrido (§10.5). */
  abandonedSessions: number;
}

/**
 * Cuánto puede pasar una sesión abierta sin señal de vida antes de que el hub
 * la dé por abandonada (§10.5, D-21). Es la misma regla que la del cronómetro
 * (`shared/timerFreshness.ts`), que también barre: si fueran distintas, el hub
 * cerraría un cronómetro que la interfaz sigue pintando vivo, o al revés.
 */
export const ABANDONED_SESSION_MS = TIMER_STALE_MS;

/**
 * Columnas de `sessions` que puede escribir cualquier dispositivo (§7.4, igual
 * que `SESSION_FIELDS_ANY_DEVICE` de la puerta del cliente) y la lápida. NO
 * cuentan para el reloj base del barrido: una nota editada en otro PC después
 * del barrido subiría el reloj del cierre del hub por encima del cierre real
 * del dueño, que se perdería (E-09).
 */
const SWEEP_IGNORED_COLUMNS: ReadonlySet<string> = new Set([
  'note',
  'playthroughId',
  DELETED_COLUMN,
]);

const num = (value: SqlValue | undefined): number => Number(value);

/** Lo que se sabe de una fila rechazada o aceptada, a partir de un valor sin validar. */
function refOf(raw: unknown): RowRef {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    table: typeof record.table === 'string' ? record.table : '',
    id: typeof record.id === 'string' ? record.id : '',
  };
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSqlValue = (value: unknown): value is SqlValue =>
  value === null ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value));

/** Normaliza lo que teclea el usuario: mayúsculas, sin guiones ni espacios, O→0, I/L→1. */
export function normalizeEnrollmentCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replaceAll('O', '0')
    .replaceAll('I', '1')
    .replaceAll('L', '1');
}

/**
 * Un reloj firmado con el id reservado (`000000`) que trae una fila. Solo es
 * legítimo si el hub ya lo tiene en ese mismo sitio: es el eco de lo que
 * escribió su propio barrido (§10.5). `slot` es `created`, `deleted` (el valor
 * de la lápida) o el nombre de la columna (`syncDeleted` incluida).
 */
interface ReservedClock {
  slot: string;
  clock: string;
}

type Verdict =
  | { ok: true; table: HubTable; wire: WireRow; reserved: ReservedClock[] }
  | { ok: false; ref: RowRef; reason: PushRejectReason };

// ---------- El hub ----------

export class TenantHub {
  private readonly tables: ReadonlyMap<string, HubTable>;
  private readonly tableList: readonly HubTable[];
  private readonly limits: SyncLimits;
  private readonly maxAheadMs: number;
  private readonly maxSchema: number;

  constructor(
    private readonly storage: SqlStorage,
    private readonly now: () => number,
    private readonly options: HubOptions,
  ) {
    this.tableList = options.tables ?? buildHubTables();
    this.tables = new Map(this.tableList.map((table) => [table.name, table]));
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.maxAheadMs = options.maxAheadMs ?? MAX_AHEAD_MS;
    this.maxSchema = options.maxSchema ?? APP_SCHEMA_VERSION;
    // El `pull` pide `syncSeq` a cada tabla con dos parámetros por tabla.
    if (this.tableList.length * 2 + 1 > MAX_SQL_PARAMS) {
      throw new Error('demasiadas tablas sincronizadas para una sola consulta de pull');
    }
    ensureSchema(storage, this.tableList);
    this.initMeta();
  }

  // ---------- Metadatos e identidad ----------

  private initMeta(): void {
    if (this.storage.exec(`SELECT v FROM tenant_meta WHERE k = 'seq'`).length > 0) return;
    this.storage.transactionSync(() => {
      this.storage.exec(
        `INSERT OR IGNORE INTO tenant_meta (k, v) VALUES ('seq', 0), ('hubId', ?), ('epoch', 1), ('minSchema', 1), ('createdAt', ?)`,
        this.options.hubId ?? randomId(),
        this.now(),
      );
    });
  }

  private readMeta(): { seq: number; hubId: string; epoch: number; minSchema: number } {
    const meta = new Map<string, SqlValue>();
    for (const row of this.storage.exec(
      `SELECT k, v FROM tenant_meta WHERE k IN ('seq', 'hubId', 'epoch', 'minSchema')`,
    )) {
      meta.set(String(row.k), row.v);
    }
    return {
      seq: num(meta.get('seq')),
      hubId: String(meta.get('hubId')),
      epoch: num(meta.get('epoch')),
      minSchema: num(meta.get('minSchema')),
    };
  }

  private identity(): HubIdentity {
    const { hubId, epoch } = this.readMeta();
    return { hubId, epoch };
  }

  /**
   * Sube la época: para quien restaura el hub desde una copia o lo recrea, de
   * modo que los clientes vuelvan a subirlo todo (§8.4). Devuelve la nueva.
   */
  bumpEpoch(): number {
    const epoch = this.readMeta().epoch + 1;
    this.storage.exec(`UPDATE tenant_meta SET v = ? WHERE k = 'epoch'`, epoch);
    return epoch;
  }

  /** Sube el `minSchema` (cambios incompatibles, §8.7). Nunca lo baja. */
  setMinSchema(minSchema: number): void {
    if (!Number.isInteger(minSchema) || minSchema < 1 || minSchema > this.maxSchema) {
      throw new RangeError(`minSchema fuera de rango: ${minSchema}`);
    }
    this.storage.exec(
      `UPDATE tenant_meta SET v = ? WHERE k = 'minSchema' AND v < ?`,
      minSchema,
      minSchema,
    );
  }

  // ---------- Versiones (§8.7) ----------

  private checkVersion(version: ClientVersion): void {
    const { protocolVersion, schemaVersion } = (version ?? {}) as Partial<ClientVersion>;
    if (!Number.isInteger(protocolVersion) || !Number.isInteger(schemaVersion)) {
      throw new HubError('invalid_request', 'faltan protocolVersion o schemaVersion');
    }
    if (protocolVersion !== PROTOCOL_VERSION) {
      throw new HubError(
        'protocol_mismatch',
        `el hub habla el protocolo ${PROTOCOL_VERSION}, no el ${protocolVersion}`,
      );
    }
    const { minSchema } = this.readMeta();
    if ((schemaVersion as number) < minSchema) {
      throw new HubError(
        'schema_too_old',
        `el hub exige el esquema ${minSchema} o superior`,
        minSchema,
      );
    }
    // Un cliente por delante del hub rompe la regla de despliegue (§8.7: el hub
    // va primero). Aceptarlo perdería en silencio las columnas que el hub no
    // conoce, y un cliente "nunca escribe a ciegas" (F-15): se rechaza.
    if ((schemaVersion as number) > this.maxSchema) {
      throw new HubError(
        'protocol_mismatch',
        `el cliente usa el esquema ${schemaVersion} y el hub solo llega al ${this.maxSchema}: hay que desplegar el hub primero`,
      );
    }
  }

  // ---------- status ----------

  status(version: ClientVersion): StatusResponse {
    this.checkVersion(version);
    const meta = this.readMeta();
    return {
      hubId: meta.hubId,
      epoch: meta.epoch,
      protocolVersion: PROTOCOL_VERSION,
      minSchema: meta.minSchema,
      maxSchema: this.maxSchema,
      serverTime: this.now(),
      seq: meta.seq,
      limits: { ...this.limits },
    };
  }

  // ---------- push ----------

  /**
   * Valida una fila sin fiarse de nada: llega de JSON de un cliente. El orden
   * de los motivos es el de gravedad: tabla desconocida, forma inválida, id
   * reservado, reloj adelantado.
   */
  private classify(raw: unknown, now: number): Verdict {
    const ref = refOf(raw);
    const reject = (reason: PushRejectReason): Verdict => ({ ok: false, ref, reason });
    const table = this.tables.get(ref.table);
    if (!table) return reject('unknown_table');
    if (!isPlainRecord(raw)) return reject('invalid_row');
    const { id, created, deleted, fields, clocks } = raw;
    if (typeof id !== 'string' || id === '' || id.length > 256) return reject('invalid_row');
    if (!isClock(created)) return reject('invalid_row');
    if (deleted !== null && !isClock(deleted)) return reject('invalid_row');
    if (!isPlainRecord(fields) || !isPlainRecord(clocks)) return reject('invalid_row');
    // `syncDeleted` viaja en `deleted`, nunca dentro de `fields`.
    if (DELETED_COLUMN in fields) return reject('invalid_row');
    for (const [column, value] of Object.entries(fields)) {
      // Toda columna que viaja lleva su reloj (§8.4): sin reloj no hay fusión.
      if (!isSqlValue(value) || !isClock(clocks[column])) return reject('invalid_row');
    }
    for (const [column, clock] of Object.entries(clocks)) {
      if (!isClock(clock)) return reject('invalid_row');
      if (column !== DELETED_COLUMN && !(column in fields)) return reject('invalid_row');
    }
    // Una lápida sin reloj propio perdería contra todo: se exige.
    if (deleted !== null && !isClock(clocks[DELETED_COLUMN])) return reject('invalid_row');

    const all = [
      created,
      ...(deleted === null ? [] : [deleted]),
      ...Object.values(clocks as Record<string, string>),
    ];
    // `BOTTOM` ("nadie lo ha escrito") lleva el id reservado y es legítimo.
    const real = all.filter((clock) => clock !== BOTTOM);
    const isReserved = (clock: string): boolean =>
      clock !== BOTTOM && parseClock(clock).dev === RESERVED_DEVICE_ID;
    // Se decide en `applyRows`, donde están las filas guardadas.
    const reserved: ReservedClock[] = [];
    if (isReserved(created)) reserved.push({ slot: 'created', clock: created });
    if (deleted !== null && isReserved(deleted)) reserved.push({ slot: 'deleted', clock: deleted });
    for (const [column, clock] of Object.entries(clocks as Record<string, string>)) {
      if (isReserved(clock)) reserved.push({ slot: column, clock });
    }
    const limit = now + this.maxAheadMs;
    if (real.some((clock) => parseClock(clock).ms > limit)) return reject('clock_ahead');

    return {
      ok: true,
      table,
      wire: {
        table: table.name,
        id,
        created,
        deleted: deleted as WireRow['deleted'],
        fields: fields as WireRow['fields'],
        clocks: clocks as WireRow['clocks'],
      },
      reserved,
    };
  }

  /** Lee las filas guardadas de `ids`, en trozos de 99 (límite de parámetros del DO). */
  private loadStored(table: HubTable, ids: readonly string[]): Map<string, RowState> {
    const out = new Map<string, RowState>();
    for (const part of chunk(ids, ID_CHUNK)) {
      const marks = part.map(() => '?').join(', ');
      for (const row of this.storage.exec(
        `SELECT * FROM "${table.name}" WHERE "id" IN (${marks})`,
        ...part,
      )) {
        out.set(String(row.id), decodeStored(row, table.shape));
      }
    }
    return out;
  }

  /**
   * Fusiona el lote y escribe solo lo que cambia, dentro de la transacción
   * del llamador. Cada fila que cambia recibe la secuencia siguiente; `tenant_meta`
   * se escribe UNA vez, y solo si algo cambió (§8.4).
   */
  private applyRows(
    valid: readonly { table: HubTable; wire: WireRow; reserved: ReservedClock[] }[],
  ): {
    seq: number;
    accepted: RowRef[];
    rejected: PushRejection[];
  } {
    const accepted: RowRef[] = [];
    const rejected: PushRejection[] = [];
    const { seq: startSeq } = this.readMeta();
    let seq = startSeq;

    const idsByTable = new Map<string, Set<string>>();
    for (const { table, wire } of valid) {
      const ids = idsByTable.get(table.name) ?? new Set<string>();
      ids.add(wire.id);
      idsByTable.set(table.name, ids);
    }
    const stored = new Map<string, Map<string, RowState>>();
    for (const [name, ids] of idsByTable) {
      stored.set(name, this.loadStored(this.tables.get(name)!, [...ids]));
    }

    for (const { table, wire, reserved } of valid) {
      const rows = stored.get(table.name)!;
      const before = rows.get(wire.id);
      // Un reloj `000000` solo se acepta si el hub ya lo tiene tal cual en esa
      // columna de esa fila: es el eco del barrido. Uno que se inventa un cliente
      // se rechaza; el rechazo es de esta fila y no afecta a las demás del lote.
      const forged = reserved.some(({ slot, clock }) => {
        if (!before) return true;
        if (slot === 'created') return before.created !== clock;
        if (slot === 'deleted') return before.fields[DELETED_COLUMN] !== clock;
        return before.clocks[slot] !== clock;
      });
      if (forged) {
        rejected.push({ table: wire.table, id: wire.id, reason: 'reserved_device' });
        continue;
      }
      accepted.push({ table: wire.table, id: wire.id });
      // Las columnas que el hub no conoce (cliente más nuevo) se descartan: la
      // regla de despliegue (§8.7) dice que no debe pasar, y `checkVersion` lo
      // impide. Las que el hub conoce y el cliente no mandó, se conservan.
      const merged = mergeRows(before, project(fromWire(wire), table.shape));
      if (before && canonical(before, table.shape) === canonical(merged, table.shape)) continue;

      seq += 1;
      // Lo que se guarda es lo que se leería: así dos filas del mismo lote sobre
      // el mismo id se fusionan igual que si hubieran llegado en lotes distintos
      // (una columna que falta vale su defecto con reloj BOTTOM, no "ausente").
      rows.set(wire.id, this.writeRow(table, merged, seq));
    }

    if (seq !== startSeq) {
      this.storage.exec(`UPDATE tenant_meta SET v = ? WHERE k = 'seq'`, seq);
    }
    return { seq, accepted, rejected };
  }

  /** Escribe una fila ya fusionada con su secuencia y devuelve lo que se leería de vuelta. */
  private writeRow(table: HubTable, merged: RowState, seq: number): RowState {
    const encoded = encodeStored(merged, table.shape);
    const values = table.upsertColumns.map((column) =>
      column === 'syncSeq' ? seq : (encoded[column] as SqlValue),
    );
    this.storage.exec(table.upsertSql, merged.id, ...values);
    return decodeStored(encoded as unknown as SqlRow, table.shape);
  }

  push(request: PushRequest): PushResponse {
    this.checkVersion(request);
    const rows: unknown = request?.rows;
    if (!Array.isArray(rows)) throw new HubError('invalid_request', 'rows debe ser una lista');
    if (rows.length > this.limits.pushMaxRows) {
      throw new HubError(
        'invalid_request',
        `un push admite como mucho ${this.limits.pushMaxRows} filas`,
      );
    }

    const now = this.now();
    const valid: { table: HubTable; wire: WireRow; reserved: ReservedClock[] }[] = [];
    const rejected: PushRejection[] = [];
    for (const raw of rows) {
      const verdict = this.classify(raw, now);
      if (verdict.ok) valid.push(verdict);
      else rejected.push({ ...verdict.ref, reason: verdict.reason });
    }

    // Todo el lote en una transacción: o entra entero o no entra nada.
    const applied = this.storage.transactionSync(() => this.applyRows(valid));
    return {
      ...this.identity(),
      accepted: applied.accepted,
      rejected: [...rejected, ...applied.rejected],
      seq: applied.seq,
      serverTime: now,
    };
  }

  // ---------- pull ----------

  pull(since: number, limit: number, version: ClientVersion): PullResponse {
    this.checkVersion(version);
    if (!Number.isInteger(since) || since < 0) {
      throw new HubError('invalid_request', 'since debe ser un entero >= 0');
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new HubError('invalid_request', 'limit debe ser un entero >= 1');
    }
    const pageSize = Math.min(limit, this.limits.pullPageRows);
    const meta = this.readMeta();

    // Primero solo las secuencias (índice parcial, sin leer filas): pedimos una
    // más que la página para saber si `more`. Cada tabla aporta como mucho
    // `pageSize + 1`, así que el coste no crece con el tamaño del inquilino.
    //
    // UNA CONSULTA POR TABLA, no un `UNION ALL` de todas: el SQLite de los
    // Durable Objects tiene un tope de términos en un SELECT compuesto muy
    // por debajo del de Node ("too many terms in compound SELECT", visto en el
    // hub de desarrollo el 2026-11-15), y con dos parámetros por tabla la
    // sentencia única además se acercaba al límite de 100 parámetros.
    const seqs: { syncSeq: number; tbl: string }[] = [];
    for (const table of this.tableList) {
      for (const row of this.storage.exec(
        `SELECT "syncSeq" AS syncSeq FROM "${table.name}" WHERE "syncSeq" > ? ORDER BY "syncSeq" LIMIT ?`,
        since,
        pageSize + 1,
      )) {
        seqs.push({ syncSeq: num(row.syncSeq), tbl: table.name });
      }
    }
    seqs.sort((a, b) => a.syncSeq - b.syncSeq);
    seqs.length = Math.min(seqs.length, pageSize + 1);
    if (seqs.length === 0) {
      return { ...meta, rows: [], next: since, more: false };
    }
    const page = seqs.slice(0, pageSize);
    const next = num(page[page.length - 1].syncSeq);

    // Después las filas, solo de las tablas que aparecen en la página. Las
    // secuencias son únicas en todo el inquilino, así que el orden es total.
    const tablesInPage = new Set(page.map((row) => String(row.tbl)));
    const delivered: { seq: number; wire: WireRow }[] = [];
    for (const name of tablesInPage) {
      const table = this.tables.get(name)!;
      for (const row of this.storage.exec(
        `SELECT * FROM "${name}" WHERE "syncSeq" > ? AND "syncSeq" <= ?`,
        since,
        next,
      )) {
        delivered.push({
          seq: num(row.syncSeq),
          wire: toWire(name, decodeStored(row, table.shape)),
        });
      }
    }
    delivered.sort((a, b) => a.seq - b.seq);
    return {
      hubId: meta.hubId,
      epoch: meta.epoch,
      rows: delivered.map(({ wire }) => wire),
      next,
      more: seqs.length > pageSize,
      seq: meta.seq,
    };
  }

  // ---------- Emparejado (§9.3) ----------

  /**
   * Crea un código de emparejado: lo que enseña la PWA con "Añadir
   * dispositivo". Por defecto de un solo uso; `maxUses` > 1 sirve al secreto de
   * alta de varios usos de la migración (§9.3, §19.6).
   */
  async createEnrollmentCode(options: {
    ttlMinutes: number;
    maxUses?: number;
  }): Promise<EnrollmentCode> {
    const { ttlMinutes, maxUses = 1 } = options;
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > MAX_ENROLL_TTL_MINUTES) {
      throw new RangeError(`ttlMinutes fuera de rango: ${ttlMinutes}`);
    }
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000) {
      throw new RangeError(`maxUses fuera de rango: ${maxUses}`);
    }
    const raw = randomString(CODE_LENGTH, CODE_ALPHABET);
    const codeHash = await sha256Hex(raw);
    const now = this.now();
    const expiresAt = now + ttlMinutes * 60_000;
    this.storage.exec(
      `INSERT INTO enrollment_codes (codeHash, createdAt, expiresAt, usesLeft) VALUES (?, ?, ?, ?)`,
      codeHash,
      now,
      expiresAt,
      maxUses,
    );
    return { code: `${raw.slice(0, 5)}-${raw.slice(5)}`, expiresAt };
  }

  // ---------- Escrituras del móvil (§13.3; las usa `queries.ts`) ----------
  //
  // El móvil escribe con la MISMA puerta de escritura que los PCs
  // (`WriteStore`), directamente sobre las tablas del hub y dentro de una
  // transacción suya. Lo que el hub añade es lo que hace con cualquier fila que
  // cambia: darle secuencia nueva para que los PCs la bajen.

  /** Transacción anidable del almacén del hub. */
  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }

  /** La hora del hub, en ms. */
  hubNow(): number {
    return this.now();
  }

  /** Id corto de reloj de un dispositivo sin token, como el `web` del móvil. */
  shortIdForDevice(deviceId: string): string {
    return this.storage.transactionSync(() => this.shortIdFor(deviceId));
  }

  /** La secuencia actual del inquilino. */
  currentSeq(): number {
    return this.readMeta().seq;
  }

  /**
   * Da secuencia nueva a filas ya escritas en la transacción en curso (por la
   * puerta de escritura, no por `applyRows`). Una por fila, como `applyRows`.
   * Devuelve la secuencia final.
   */
  stampWritten(rows: readonly { table: string; ids: readonly string[] }[]): number {
    let seq = this.readMeta().seq;
    const start = seq;
    for (const { table, ids } of rows) {
      if (!this.tables.has(table)) throw new Error(`stampWritten: tabla desconocida ${table}`);
      for (const id of new Set(ids)) {
        seq += 1;
        this.storage.exec(`UPDATE "${table}" SET "syncSeq" = ? WHERE id = ?`, seq, id);
      }
    }
    if (seq !== start) this.storage.exec(`UPDATE tenant_meta SET v = ? WHERE k = 'seq'`, seq);
    return seq;
  }

  /** Un valor de `tenant_meta` que no es de los de siempre (p. ej. el reloj del móvil). */
  metaValue(key: string): SqlValue | undefined {
    return this.storage.exec(`SELECT v FROM tenant_meta WHERE k = ?`, key)[0]?.v;
  }

  setMetaValue(key: string, value: SqlValue): void {
    this.storage.exec(
      `INSERT INTO tenant_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      key,
      value,
    );
  }

  /**
   * Id corto de reloj de un dispositivo (§8.2), único en el inquilino. Si el
   * dispositivo ya tenía uno (se vuelve a emparejar) se conserva: sus relojes
   * antiguos siguen firmados con él. Va dentro de la transacción del llamador.
   */
  private shortIdFor(deviceId: string): string {
    const existing = this.storage.exec(
      `SELECT shortId FROM device_short_ids WHERE deviceId = ?`,
      deviceId,
    )[0];
    if (existing) return String(existing.shortId);
    for (let attempt = 0; attempt < SHORT_ID_ATTEMPTS; attempt++) {
      const candidate = randomString(6, SHORT_ID_ALPHABET);
      if (!isDeviceShortId(candidate) || isReservedDeviceShortId(candidate)) continue;
      if (
        this.storage.exec(`SELECT 1 AS used FROM device_short_ids WHERE shortId = ?`, candidate)
          .length > 0
      ) {
        continue;
      }
      this.storage.exec(
        `INSERT INTO device_short_ids (deviceId, shortId, createdAt) VALUES (?, ?, ?)`,
        deviceId,
        candidate,
        this.now(),
      );
      return candidate;
    }
    throw new Error('no se pudo asignar un id corto único');
  }

  /**
   * Canjea un código por un token de dispositivo. Un dispositivo que vuelve a
   * emparejarse (mismo `deviceId`) revoca sus tokens anteriores y conserva su
   * id corto: un PC tiene un solo token vivo.
   */
  async enroll(request: EnrollRequest): Promise<EnrollResponse> {
    this.checkVersion(request);
    const { code, deviceId, deviceName } = request ?? ({} as Partial<EnrollRequest>);
    if (
      typeof code !== 'string' ||
      typeof deviceId !== 'string' ||
      typeof deviceName !== 'string'
    ) {
      throw new HubError('invalid_request', 'faltan code, deviceId o deviceName');
    }
    if (deviceId === '' || deviceId.length > 128 || deviceName.length > 200) {
      throw new HubError('invalid_request', 'deviceId o deviceName no válidos');
    }
    // Huellas y secreto ANTES de la transacción: SHA-256 es asíncrona.
    const codeHash = await sha256Hex(normalizeEnrollmentCode(code));
    const secret = randomSecret();
    const tokenHash = await sha256Hex(secret);

    const now = this.now();
    const result = this.storage.transactionSync(() => {
      const row = this.storage.exec(
        `SELECT usesLeft FROM enrollment_codes WHERE codeHash = ? AND expiresAt > ? AND usesLeft > 0`,
        codeHash,
        now,
      )[0];
      if (!row) return null;
      // Gasta un uso; al agotarse, desaparece (usado y desconocido se ven igual).
      if (num(row.usesLeft) <= 1) {
        this.storage.exec(`DELETE FROM enrollment_codes WHERE codeHash = ?`, codeHash);
      } else {
        this.storage.exec(
          `UPDATE enrollment_codes SET usesLeft = usesLeft - 1 WHERE codeHash = ?`,
          codeHash,
        );
      }
      const shortDeviceId = this.shortIdFor(deviceId);
      this.storage.exec(
        `UPDATE device_tokens SET revokedAt = ? WHERE deviceId = ? AND revokedAt IS NULL`,
        now,
        deviceId,
      );
      this.storage.exec(
        `INSERT INTO device_tokens (id, tokenHash, deviceId, deviceName, shortDeviceId, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
        randomId(),
        tokenHash,
        deviceId,
        deviceName,
        shortDeviceId,
        now,
      );
      return shortDeviceId;
    });
    if (result === null) {
      throw new HubError(
        'enroll_code_invalid',
        'código de emparejado desconocido, usado o caducado',
      );
    }
    return {
      ...this.identity(),
      token: formatDeviceToken(this.options.tenantId, secret),
      tenantId: this.options.tenantId,
      shortDeviceId: result,
      serverTime: now,
    };
  }

  // ---------- Tokens (§9.2) ----------

  /**
   * Comprueba un token completo `ap1.<inquilino>.<secreto>`: que sea de este
   * inquilino y que su secreto coincida con una huella viva.
   */
  async authenticateToken(token: string): Promise<HubDevice> {
    const parsed = parseDeviceToken(token);
    if (!parsed || parsed.tenantId !== this.options.tenantId) {
      throw new HubError('unauthorized', 'token no válido');
    }
    return this.authenticate(parsed.secret);
  }

  /** Comprueba el secreto de un token. Falla con `unauthorized` si es desconocido o está revocado. */
  async authenticate(secret: string): Promise<HubDevice> {
    if (typeof secret !== 'string' || secret.length < 16 || secret.length > 128) {
      throw new HubError('unauthorized', 'token no válido');
    }
    const tokenHash = await sha256Hex(secret);
    const row = this.storage.exec(
      `SELECT id, deviceId, deviceName, shortDeviceId, lastUsedAt, revokedAt FROM device_tokens WHERE tokenHash = ?`,
      tokenHash,
    )[0];
    if (!row || row.revokedAt !== null) throw new HubError('unauthorized', 'token no válido');

    const now = this.now();
    const lastUsedAt = row.lastUsedAt === null ? null : num(row.lastUsedAt);
    // El "último uso" es informativo: se escribe como mucho una vez por hora.
    if (lastUsedAt === null || now - lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS) {
      this.storage.exec(
        `UPDATE device_tokens SET lastUsedAt = ? WHERE id = ?`,
        now,
        String(row.id),
      );
    }
    return {
      tokenId: String(row.id),
      deviceId: String(row.deviceId),
      deviceName: String(row.deviceName),
      shortDeviceId: String(row.shortDeviceId),
    };
  }

  /** Todos los tokens (también los revocados), del más antiguo al más nuevo. */
  listTokens(): DeviceTokenInfo[] {
    return this.storage
      .exec(
        `SELECT id, deviceId, deviceName, shortDeviceId, createdAt, lastUsedAt, revokedAt FROM device_tokens ORDER BY createdAt, id`,
      )
      .map((row) => ({
        tokenId: String(row.id),
        deviceId: String(row.deviceId),
        deviceName: String(row.deviceName),
        shortDeviceId: String(row.shortDeviceId),
        createdAt: num(row.createdAt),
        lastUsedAt: row.lastUsedAt === null ? null : num(row.lastUsedAt),
        revokedAt: row.revokedAt === null ? null : num(row.revokedAt),
      }));
  }

  /** Revoca un token. Devuelve false si no existía o ya estaba revocado. */
  revokeToken(tokenId: string): boolean {
    return (
      this.storage.exec(
        `UPDATE device_tokens SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL RETURNING id`,
        this.now(),
        tokenId,
      ).length > 0
    );
  }

  // ---------- Concesiones de trabajo (§14.3) ----------

  /**
   * Concede si no hay una concesión sin caducar para `(kind, key)`, esté abierta
   * o ya cerrada con `done`. Cerrar NO libera el par hasta su `expiresAt`: un PC
   * que aún no ha bajado el resultado no vuelve a pagar un recap o unas
   * curiosidades, y un fallo reciente no se reintenta en bucle (§14.3). Por eso
   * quien pide `ttlSec` está eligiendo también cuánto dura esa protección.
   */
  claimJob(device: HubDevice, request: JobClaimRequest): JobClaimResponse {
    const { kind, key, ttlSec } = request ?? ({} as Partial<JobClaimRequest>);
    if (!JOB_KINDS.includes(kind as JobKind))
      throw new HubError('invalid_request', 'kind desconocido');
    if (typeof key !== 'string' || key === '' || key.length > 200) {
      throw new HubError('invalid_request', 'key no válida');
    }
    if (
      !Number.isInteger(ttlSec) ||
      (ttlSec as number) < 1 ||
      (ttlSec as number) > MAX_LEASE_TTL_SEC
    ) {
      throw new HubError('invalid_request', `ttlSec debe estar entre 1 y ${MAX_LEASE_TTL_SEC}`);
    }
    const now = this.now();
    return this.storage.transactionSync((): JobClaimResponse => {
      const live = this.storage.exec(
        `SELECT deviceId, expiresAt FROM job_leases WHERE kind = ? AND jobKey = ? AND expiresAt > ? ORDER BY expiresAt DESC LIMIT 1`,
        kind as string,
        key,
        now,
      )[0];
      if (live) {
        return {
          granted: false,
          holderDeviceId: String(live.deviceId),
          expiresAt: num(live.expiresAt),
        };
      }
      const leaseId = randomId();
      const expiresAt = now + (ttlSec as number) * 1000;
      this.storage.exec(
        `INSERT INTO job_leases (id, kind, jobKey, deviceId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)`,
        leaseId,
        kind as string,
        key,
        device.deviceId,
        now,
        expiresAt,
      );
      return { granted: true, leaseId, expiresAt };
    });
  }

  /**
   * Cierra una concesión PROPIA y aún sin cerrar. `ok` la cierra; `failed` la
   * cierra y deja el motivo anotado (§14.3). Ninguna libera el par: sigue
   * ocupado hasta su `expiresAt` (ver `claimJob`). Se admite cerrar una caducada que el barrido no ha
   * recogido, para no perder el motivo de un fallo tardío.
   */
  doneJob(device: HubDevice, request: JobDoneRequest): JobDoneResponse {
    const { leaseId, outcome, reason } = request ?? ({} as Partial<JobDoneRequest>);
    if (typeof leaseId !== 'string' || (outcome !== 'ok' && outcome !== 'failed')) {
      throw new HubError('invalid_request', 'faltan leaseId u outcome');
    }
    const closed = this.storage.exec(
      `UPDATE job_leases SET closedAt = ?, outcome = ?, reason = ? WHERE id = ? AND deviceId = ? AND closedAt IS NULL RETURNING id`,
      this.now(),
      outcome,
      outcome === 'failed' && typeof reason === 'string' ? reason.slice(0, 500) : null,
      leaseId,
      device.deviceId,
    );
    return { closed: closed.length > 0 };
  }

  // ---------- Barridos (§9.5) ----------

  /**
   * Lo que hace la alarma periódica del `TenantHub`: caduca concesiones, borra
   * las viejas y los códigos de emparejado caducados o agotados.
   */
  sweep(): SweepResult {
    const now = this.now();
    return this.storage.transactionSync(() => {
      const expired = this.storage.exec(
        `UPDATE job_leases SET closedAt = expiresAt, outcome = 'expired' WHERE closedAt IS NULL AND expiresAt <= ? RETURNING id`,
        now,
      );
      const deletedLeases = this.storage.exec(
        `DELETE FROM job_leases WHERE closedAt IS NOT NULL AND closedAt < ? RETURNING id`,
        now - LEASE_RETENTION_MS,
      );
      const deletedCodes = this.storage.exec(
        `DELETE FROM enrollment_codes WHERE expiresAt <= ? OR usesLeft <= 0 RETURNING codeHash`,
        now,
      );
      return {
        expiredLeases: expired.length,
        deletedLeases: deletedLeases.length,
        deletedEnrollmentCodes: deletedCodes.length,
        abandonedSessions: this.sweepAbandonedSessions(now),
      };
    });
  }

  /**
   * Sesiones abandonadas (§10.5, E-08, E-09). Un PC que murió con una sesión
   * abierta y no vuelve la dejaría abierta para siempre: el hub cierra las que
   * llevan más de `ABANDONED_SESSION_MS` sin señal de vida (`lastSeenAt`, o
   * `startedAt` si nunca la dio), en esa última señal y con
   * `closedBy = 'janitor'`. Cubre también los cronómetros abandonados.
   *
   * EL RELOJ (H-3, D-6 del spike): NO la hora del hub, sino el sucesor
   * inmediato del mayor reloj de las columnas del dueño, firmado con
   * `RESERVED_DEVICE_ID`. Gana a lo que el hub tiene guardado (la sesión
   * abierta), pero pierde ante cualquier escritura posterior del dueño: si
   * estaba offline y no muerto, y cerró la sesión antes de que pasara el
   * barrido, su cierre real gana al subir, y no se pierden horas jugadas. Con
   * la hora del hub ese cierre perdía.
   *
   * Se llama dentro de la transacción de `sweep`. Cada fila cerrada recibe
   * secuencia nueva, así que los clientes la bajan como cualquier cambio. Su eco
   * (un cliente que la reenvía tal cual) se admite: `applyRows` acepta un reloj
   * reservado si el hub ya lo tiene en esa celda.
   */
  protected sweepAbandonedSessions(now: number): number {
    const table = this.tables.get('sessions');
    if (!table) return 0;
    const candidates = this.storage.exec(
      `SELECT * FROM "sessions" WHERE "endedAt" IS NULL AND "syncDeleted" IS NULL AND COALESCE("lastSeenAt", "startedAt") <= ?`,
      now - ABANDONED_SESSION_MS,
    );
    if (candidates.length === 0) return 0;

    const { seq: startSeq } = this.readMeta();
    let seq = startSeq;
    for (const raw of candidates) {
      const row = decodeStored(raw, table.shape);
      const startedAt = num(row.fields.startedAt);
      const lastSeenAt = row.fields.lastSeenAt === null ? startedAt : num(row.fields.lastSeenAt);
      // Una señal de vida anterior al inicio no tiene sentido: se cierra en el
      // inicio, con duración 0, en vez de guardar una duración negativa.
      const endedAt = Math.max(startedAt, lastSeenAt);

      let base = row.created;
      for (const [column, clock] of Object.entries(row.clocks)) {
        if (!SWEEP_IGNORED_COLUMNS.has(column)) base = maxClock(base, clock);
      }
      const clock = successor(base, RESERVED_DEVICE_ID);
      const close: RowState = {
        id: row.id,
        created: row.created,
        fields: {
          endedAt,
          durationSec: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
          closedBy: 'janitor',
        },
        clocks: { endedAt: clock, durationSec: clock, closedBy: clock },
      };
      seq += 1;
      this.writeRow(table, mergeRows(row, close), seq);
    }
    this.storage.exec(`UPDATE tenant_meta SET v = ? WHERE k = 'seq'`, seq);
    return seq - startSeq;
  }
}
