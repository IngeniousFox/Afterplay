import type { SQLInputValue } from 'node:sqlite';
import {
  HybridClock,
  MAX_AHEAD_MS,
  MAX_COUNTER,
  formatClock,
  isClock,
  maxClockOf,
  type Clock,
} from '../../shared/sync/clock';
import { restampFutureClocks } from '../../shared/sync/fieldClocks';
import {
  canonical,
  decodeStored,
  encodeStored,
  fromWire,
  mergeRows,
  project,
  toWire,
  type SqlRow,
  type SqlValue,
  type WireRow,
} from '../../shared/sync/merge';
import {
  DEFAULT_LIMITS,
  PROTOCOL_VERSION,
  SyncRequestError,
  type ClientVersion,
  type HubIdentity,
  type PushRejection,
  type StatusResponse,
  type SyncLimits,
  type SyncTransport,
} from '../../shared/sync/protocol';
import { APP_SCHEMA_VERSION } from '../db/v2/schemaVersion';
import type { LocalDb } from '../db/v2/store';
import { patchSyncState, readSyncState, type SyncState } from './state';
import { syncTableByName, syncTables, type SyncTable } from './tables';

// Motor de sync del cliente (AFTERPLAY-2.0.md §8.5).
//
// Un ciclo = subir lo pendiente, bajar lo nuevo, avisar de lo que cambió. Lo
// único que toca de la base son tablas sincronizadas (junto a la puerta
// única de escritura, §8.6) y `local_sync_state`. Trabaja con filas CRUDAS:
// ni Drizzle ni la puerta intervienen, porque lo que llega ya trae sus
// relojes y la puerta pondría los de ahora.
//
// Es el ÚNICO código que quita `syncDirty` y el único que escribe una fila con
// relojes ajenos.

export type SyncLogger = {
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
};

const silentLogger: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Mismo aspecto que `StoreChange` (§15.4), con nombres de tabla como texto. */
export interface SyncChange {
  readonly tables: readonly string[];
  readonly ids: Readonly<Record<string, readonly string[]>>;
}

export interface SyncEngineOptions {
  /** La base abierta (`openLocalDatabase`): solo hace falta la conexión y el reloj. */
  readonly local: { readonly db: LocalDb; readonly clock: HybridClock };
  readonly transport: SyncTransport;
  /** Hora de pared en ms. */
  readonly now: () => number;
  /** Se llama una vez por ciclo con lo que cambió al BAJAR (no se llama si no cambió nada). */
  readonly onChange?: (change: SyncChange) => void;
  readonly logger?: SyncLogger;
  /** La versión de esquema que escribe esta app (§8.7). Por defecto `APP_SCHEMA_VERSION`. */
  readonly schemaVersion?: number;
}

/**
 * - `ok`: ciclo completo.
 * - `blocked`: el hub exige una app más nueva (§8.7). No se sincroniza; la app
 *   sigue en local. No reintentar hasta actualizar.
 * - `unauthorized`: token ausente o revocado. No reintentar hasta re-emparejar.
 * - `clock_ahead`: el reloj de este PC está adelantado (§8.2, E-23). Se
 *   reintentará cuando se corrija la hora.
 * - `restart_required`: defensa; `local_sync_state.shortDeviceId` y el reloj en
 *   marcha no coinciden por una vía distinta de `applyEnrollment`. Reiniciar.
 * - `error`: red, cupo, 5xx, fallo local… Reintentar con espera creciente.
 */
export type CycleStatus =
  'ok' | 'blocked' | 'unauthorized' | 'clock_ahead' | 'restart_required' | 'error';

export interface CycleError {
  /** Un código del protocolo (`network`, `quota_exceeded`…) o del motor (`clock_ahead`, `internal`…). */
  code: string;
  message: string;
}

export interface CycleResult {
  status: CycleStatus;
  /** ¿Tiene sentido reintentar solo, con espera? (false: hace falta que cambie algo fuera) */
  retry: boolean;
  error: CycleError | null;
  /** Filas aceptadas por el hub. */
  pushed: number;
  /** Filas que el hub rechazó una a una (siguen pendientes). */
  rejected: readonly PushRejection[];
  /** Filas que no caben en un lote por sí solas: no se suben. */
  oversized: number;
  /** Filas recibidas, aplicadas (cambiaron algo) y descartadas por inválidas. */
  pulled: number;
  applied: number;
  skipped: number;
  pages: number;
  /** Por qué se volvió a empezar de cero en este ciclo, si pasó. */
  reset: 'new_hub' | 'hub_rewound' | 'schema_changed' | null;
  /** Hubo que re-fechar celdas con reloj futuro (§8.2). */
  clockRecovered: boolean;
  minSchema: number | null;
}

const emptyResult = (): CycleResult => ({
  status: 'ok',
  retry: false,
  error: null,
  pushed: 0,
  rejected: [],
  oversized: 0,
  pulled: 0,
  applied: 0,
  skipped: 0,
  pages: 0,
  reset: null,
  clockRecovered: false,
  minSchema: null,
});

export const CLOCK_AHEAD_MESSAGE = 'el reloj de este PC está adelantado';

/** Fin anticipado de un ciclo con un estado concreto. */
class CycleAbort extends Error {
  constructor(
    readonly status: CycleStatus,
    readonly code: string,
    message: string,
    readonly retry: boolean,
    readonly minSchema: number | null = null,
  ) {
    super(message);
    this.name = 'CycleAbort';
  }
}

type DirtyCursor = { table: number; id: string };

interface Snapshot {
  readonly table: string;
  readonly id: string;
  readonly updated: Clock;
}

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

/** Sin límites válidos del hub, nada de filas grandes: puede ser un hub anterior. */
const FALLBACK_LIMITS: SyncLimits = {
  pushMaxRows: DEFAULT_LIMITS.pushMaxRows,
  pushMaxBytes: DEFAULT_LIMITS.pushMaxBytes,
  pullPageRows: DEFAULT_LIMITS.pullPageRows,
};

export interface SyncEngine {
  /**
   * Un ciclo (§8.5). SOLO UNO A LA VEZ: si ya hay uno en marcha, esta llamada
   * se UNE a él y devuelve su mismo resultado (no encadena otro). Lo que el
   * usuario cambie mientras corre el ciclo puede no haber entrado en él: lo
   * detecta quien llama (el planificador vuelve a disparar tras el aviso de
   * cambio local). Nunca lanza: los fallos van en el resultado.
   */
  runCycle(): Promise<CycleResult>;
  readonly running: boolean;
  /** Lo que el motor tiene guardado (para la interfaz). */
  getState(): SyncState;
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  return new Engine(options);
}

class Engine implements SyncEngine {
  private readonly db: LocalDb;
  private readonly clock: HybridClock;
  private readonly transport: SyncTransport;
  private readonly wall: () => number;
  private readonly onChange: ((change: SyncChange) => void) | undefined;
  private readonly log: SyncLogger;
  private readonly schemaVersion: number;
  private readonly version: ClientVersion;
  /** Los límites del último `/status` (§8.4); antes del primero, los de por defecto. */
  private limits: SyncLimits = FALLBACK_LIMITS;
  private inFlight: Promise<CycleResult> | null = null;

  constructor(options: SyncEngineOptions) {
    this.db = options.local.db;
    this.clock = options.local.clock;
    this.transport = options.transport;
    this.wall = options.now;
    this.onChange = options.onChange;
    this.log = options.logger ?? silentLogger;
    this.schemaVersion = options.schemaVersion ?? APP_SCHEMA_VERSION;
    this.version = { protocolVersion: PROTOCOL_VERSION, schemaVersion: this.schemaVersion };
  }

  get running(): boolean {
    return this.inFlight !== null;
  }

  getState(): SyncState {
    return readSyncState(this.db);
  }

  runCycle(): Promise<CycleResult> {
    if (this.inFlight) return this.inFlight;
    const cycle = this.cycle().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = cycle;
    return cycle;
  }

  // ── Ciclo ─────────────────────────────────────────────────────────────────

  private async cycle(): Promise<CycleResult> {
    const result = emptyResult();
    const changes = new Map<string, Set<string>>();
    try {
      await this.cycleBody(result, changes);
    } catch (error) {
      this.fail(result, error);
    } finally {
      this.emitChanges(changes);
    }
    this.recordOutcome(result);
    return result;
  }

  private async cycleBody(result: CycleResult, changes: Map<string, Set<string>>): Promise<void> {
    const state = readSyncState(this.db);

    // Bloqueo guardado (§8.7): se levanta solo cuando la app ya cumple el mínimo.
    if (state.blockedMinSchema !== null) {
      if (this.schemaVersion >= state.blockedMinSchema) {
        patchSyncState(this.db, { blockedMinSchema: null });
      } else {
        throw new CycleAbort(
          'blocked',
          'schema_too_old',
          'actualiza Afterplay para volver a sincronizar',
          false,
          state.blockedMinSchema,
        );
      }
    }

    // Defensa: el id guardado y el del reloj deben coincidir (`applyEnrollment` los
    // cambia a la vez). Si no (base copiada a mano, otra ruta que escribió el id
    // sin pasar por el reloj), subir firmaría con un id y bajaría con otro.
    if (state.shortDeviceId !== null && state.shortDeviceId !== this.clock.dev) {
      throw new CycleAbort(
        'restart_required',
        'restart_required',
        'el id de este PC no coincide con el de su reloj: reinicia Afterplay',
        false,
      );
    }

    const status = await this.transport.status(this.version);
    this.adoptStatus(status);
    result.reset = this.checkIdentity(readSyncState(this.db), status);

    const knownSeq = await this.pushPhase(status, result, status.seq);
    await this.pullPhase(status, result, changes, knownSeq);
  }

  /** Versión, límites y, si el hub exige más que esta app, el bloqueo (§8.7). */
  private adoptStatus(status: StatusResponse): void {
    if (status.minSchema > this.schemaVersion) {
      patchSyncState(this.db, { blockedMinSchema: status.minSchema });
      throw new CycleAbort(
        'blocked',
        'schema_too_old',
        'actualiza Afterplay para volver a sincronizar',
        false,
        status.minSchema,
      );
    }
    if (status.maxSchema < this.schemaVersion) {
      // El hub va siempre por delante de los clientes (§8.7): si no, es un
      // despliegue en curso. No se escribe a ciegas en un hub que no entiende
      // este esquema; se reintenta más tarde.
      throw new CycleAbort(
        'error',
        'hub_behind',
        'el hub todavía no admite esta versión de Afterplay',
        true,
      );
    }
    const { limits } = status;
    const valid =
      limits &&
      Number.isInteger(limits.pushMaxRows) &&
      limits.pushMaxRows > 0 &&
      Number.isInteger(limits.pushMaxBytes) &&
      limits.pushMaxBytes > 0 &&
      Number.isInteger(limits.pullPageRows) &&
      limits.pullPageRows > 0;
    if (!valid) {
      this.limits = FALLBACK_LIMITS;
      return;
    }
    // Un hub anterior no anuncia `pushMaxRowBytes`: entonces una fila sola
    // tampoco puede pasar de `pushMaxBytes`.
    const rowMax = limits.pushMaxRowBytes;
    const validRowMax = Number.isInteger(rowMax) && (rowMax as number) > limits.pushMaxBytes;
    this.limits = {
      pushMaxRows: limits.pushMaxRows,
      pushMaxBytes: limits.pushMaxBytes,
      pullPageRows: limits.pullPageRows,
      ...(validRowMax ? { pushMaxRowBytes: rowMax } : {}),
    };
  }

  /**
   * §8.4 y §8.7. Hub nuevo o retrocedido, o app actualizada con esquema
   * nuevo: el cursor vuelve a cero. En los dos primeros además se marca todo
   * como pendiente (el hub no tiene lo nuestro); en el tercero no hace falta:
   * solo hay que volver a bajar lo que ahora sí se entiende.
   */
  private checkIdentity(state: SyncState, status: StatusResponse): CycleResult['reset'] {
    const sameHub = state.hubId === status.hubId && state.hubEpoch === status.epoch;
    const rewound = sameHub && state.pullCursor > status.seq;
    if (!sameHub || rewound) {
      this.log.warn(
        sameHub
          ? `el hub retrocedió (cursor ${state.pullCursor} > seq ${status.seq}): se resube todo`
          : 'hub nuevo o restaurado: se resube todo y se baja desde cero',
      );
      this.transaction(() => {
        for (const table of syncTables) this.db.$client.exec(table.markAllDirtySql);
        patchSyncState(this.db, {
          pullCursor: 0,
          hubId: status.hubId,
          hubEpoch: status.epoch,
          lastSyncedSchemaVersion: this.schemaVersion,
        });
      });
      return sameHub ? 'hub_rewound' : 'new_hub';
    }
    if (state.lastSyncedSchemaVersion !== this.schemaVersion) {
      // Se guarda el cursor a cero Y la versión en la misma escritura: si la
      // bajada se interrumpe, el siguiente ciclo la continúa en vez de volver
      // a empezar.
      const reset = state.lastSyncedSchemaVersion !== null;
      patchSyncState(this.db, { pullCursor: 0, lastSyncedSchemaVersion: this.schemaVersion });
      return reset ? 'schema_changed' : null;
    }
    return null;
  }

  // ── Subida ────────────────────────────────────────────────────────────────

  private async pushPhase(
    status: StatusResponse,
    result: CycleResult,
    knownSeq: number,
  ): Promise<number> {
    let seq = knownSeq;
    let recovered = false;
    for (;;) {
      const pass = await this.pushPass(status, result, seq);
      seq = pass.seq;
      if (!pass.clockAheadAt) return seq;
      const hubNow = pass.clockAheadAt;
      if (recovered || this.wall() > hubNow + MAX_AHEAD_MS) {
        // El reloj de pared sigue adelantado (o ya se intentó): no se re-fecha
        // nada, o las ediciones de este PC ganarían siempre a las de los demás.
        // No se corta el ciclo: bajar lo de los demás no depende de nuestro reloj.
        result.status = 'clock_ahead';
        result.retry = true;
        result.error = { code: 'clock_ahead', message: CLOCK_AHEAD_MESSAGE };
        return seq;
      }
      recovered = true;
      result.clockRecovered = true;
      const restamped = this.recoverFromClockAhead(hubNow);
      this.log.warn(`reloj adelantado corregido: ${restamped} fila(s) re-fechadas`);
    }
  }

  /**
   * Una pasada de subida: todas las filas pendientes, en lotes. Devuelve la
   * hora del hub si rechazó alguna por `clock_ahead` (esas filas siguen
   * pendientes), o 0.
   */
  private async pushPass(
    status: StatusResponse,
    result: CycleResult,
    seq: number,
  ): Promise<{ seq: number; clockAheadAt: number }> {
    const cursor: DirtyCursor = { table: 0, id: '' };
    let clockAheadAt = 0;
    let currentSeq = seq;
    // Rechazos de ESTA pasada: la lista del resultado se reemplaza al repetirla.
    const rejectedThisPass: PushRejection[] = [];
    for (;;) {
      const batch = this.collectBatch(cursor, result);
      if (batch.rows.length === 0) break;
      const response = await this.transport.push({ ...this.version, rows: batch.rows });
      this.assertSameHub(status, response);
      const accepted = new Set(response.accepted.map((ref) => `${ref.table}\u0000${ref.id}`));
      this.transaction(() => {
        for (const snap of batch.snapshots) {
          if (!accepted.has(`${snap.table}\u0000${snap.id}`)) continue;
          // Solo si la fila no volvió a cambiar desde que se leyó (§8.5): si el
          // usuario la editó durante la subida, `syncUpdated` es otro y sigue
          // pendiente.
          const table = syncTableByName(snap.table);
          if (table) this.db.$client.prepare(table.ackSql).run(snap.id, snap.updated);
        }
      });
      result.pushed += response.accepted.length;
      currentSeq = response.seq;
      for (const rejection of response.rejected) {
        rejectedThisPass.push(rejection);
        if (rejection.reason === 'clock_ahead') clockAheadAt = response.serverTime;
      }
      patchSyncState(this.db, { lastPushAt: this.wall() });
    }
    // Quedarse solo con los rechazos de la última pasada (las filas
    // re-fechadas de la primera ya no están rechazadas).
    result.rejected = rejectedThisPass;
    return { seq: currentSeq, clockAheadAt };
  }

  /**
   * Lee del cursor en adelante las filas pendientes que caben en un lote
   * (`pushMaxRows` filas y `pushMaxBytes` bytes de cuerpo, §8.4). Tablas en el
   * orden del registro y filas por `id`: así la pasada avanza aunque el hub
   * rechace algunas, que siguen pendientes. Una fila que no cabe en
   * `pushMaxBytes` pero sí en `pushMaxRowBytes` sube sola en su lote.
   */
  private collectBatch(
    cursor: DirtyCursor,
    result: CycleResult,
  ): { rows: WireRow[]; snapshots: Snapshot[] } {
    const { pushMaxRows, pushMaxBytes } = this.limits;
    const rowMaxBytes = Math.max(pushMaxBytes, this.limits.pushMaxRowBytes ?? pushMaxBytes);
    const rows: WireRow[] = [];
    const snapshots: Snapshot[] = [];
    let used = bytes(JSON.stringify({ ...this.version, rows: [] }));
    while (cursor.table < syncTables.length && rows.length < pushMaxRows) {
      const table = syncTables[cursor.table];
      const want = pushMaxRows - rows.length;
      const raw = this.db.$client.prepare(table.selectDirtySql).all(cursor.id, want) as SqlRow[];
      for (const row of raw) {
        const wire = toWire(table.name, decodeStored(row, table.shape));
        const size = bytes(JSON.stringify(wire)) + 1; // la coma
        if (used + size > pushMaxBytes) {
          if (rows.length > 0) return { rows, snapshots };
          if (used + size <= rowMaxBytes) {
            // Grande, pero admisible sola: un lote para ella.
            rows.push(wire);
            snapshots.push({
              table: table.name,
              id: row.id as string,
              updated: row.syncUpdated as Clock,
            });
            cursor.id = row.id as string;
            return { rows, snapshots };
          }
          // Una sola fila que no cabe en ningún lote: subirla sería un error
          // de petición que atascaría el sync entero.
          this.log.error(`${table.name}/${String(row.id)} no cabe en un lote (${size} bytes)`);
          result.oversized += 1;
          cursor.id = row.id as string;
          continue;
        }
        used += size;
        rows.push(wire);
        snapshots.push({
          table: table.name,
          id: row.id as string,
          updated: row.syncUpdated as Clock,
        });
        cursor.id = row.id as string;
      }
      if (raw.length < want) {
        cursor.table += 1;
        cursor.id = '';
      }
    }
    return { rows, snapshots };
  }

  /**
   * Recuperación de un reloj adelantado (§8.2). El reloj lógico recuerda sus
   * propias escrituras futuras: aunque la hora de pared ya sea buena, el hub
   * seguiría rechazando todo. Se reinicia el reloj al mayor reloj ADMISIBLE
   * (el que no pasa de `hora del hub + MAX_AHEAD_MS`) y se vuelven a fechar las
   * celdas pendientes con reloj futuro. Es seguro porque esas celdas nunca
   * salieron de este PC: el hub las rechazó.
   */
  private recoverFromClockAhead(hubNow: number): number {
    const limitMs = hubNow + MAX_AHEAD_MS;
    // Cota de texto: cualquier reloj con ms <= limitMs es <= esta cadena.
    const bound = formatClock(limitMs, MAX_COUNTER, 'zzzzzz');
    let restamped = 0;
    this.transaction(() => {
      const known: Clock[] = [];
      const dirty: { table: SyncTable; row: SqlRow }[] = [];
      for (const table of syncTables) {
        const quoted = `"${table.name}"`;
        // Filas ya aceptadas por el hub: su `syncUpdated` es admisible.
        const max = this.db.$client
          .prepare(`SELECT max("syncUpdated") AS m FROM ${quoted} WHERE "syncUpdated" <= ?`)
          .get(bound) as { m: Clock | null } | undefined;
        if (max?.m) known.push(max.m);
        const pending = this.db.$client
          .prepare(`SELECT * FROM ${quoted} WHERE "syncDirty" = 1`)
          .all() as SqlRow[];
        for (const row of pending) dirty.push({ table, row });
      }
      // Las celdas admisibles de filas pendientes con celdas futuras mezcladas
      // no entran en el `max(syncUpdated)` de arriba (su fila entera es futura).
      for (const { table, row } of dirty) {
        const state = decodeStored(row, table.shape);
        known.push(state.created, ...Object.values(state.clocks));
      }
      this.clock.resetTo(maxClockOf(known, limitMs));
      for (const { table, row } of dirty) {
        const state = decodeStored(row, table.shape);
        const fixed = restampFutureClocks(
          {
            syncCreated: state.created,
            syncUpdated: row.syncUpdated as Clock,
            clocks: state.clocks,
            syncDeleted: row.syncDeleted as Clock | null,
          },
          limitMs,
          () => this.clock.now(),
        );
        if (fixed.restamped.length === 0 && !fixed.createdRestamped) continue;
        const next = {
          id: state.id,
          created: fixed.syncCreated,
          fields: { ...state.fields, syncDeleted: fixed.syncDeleted },
          clocks: fixed.clocks,
        };
        this.writeRow(table, next);
        restamped += 1;
      }
    });
    return restamped;
  }

  // ── Bajada ────────────────────────────────────────────────────────────────

  private async pullPhase(
    status: StatusResponse,
    result: CycleResult,
    changes: Map<string, Set<string>>,
    knownSeq: number,
  ): Promise<void> {
    let cursor = readSyncState(this.db).pullCursor;
    // El hub no tiene nada más allá de `seq`: preguntar sería una petición
    // (y una lectura en el hub) para recibir una página vacía.
    if (cursor >= knownSeq) {
      patchSyncState(this.db, { lastPullAt: this.wall() });
      return;
    }
    for (;;) {
      const page = await this.transport.pull(cursor, this.limits.pullPageRows, this.version);
      this.assertSameHub(status, page);
      if (page.next < cursor || (page.more && page.next === cursor)) {
        // Sin avance no hay fin: se saldría una y otra vez con la misma página.
        throw new CycleAbort(
          'error',
          'bad_cursor',
          `el hub devolvió un cursor sin avance (${cursor} -> ${page.next})`,
          true,
        );
      }
      this.applyPage(page.rows, page.next, result, changes);
      result.pages += 1;
      cursor = page.next;
      if (!page.more) break;
    }
    patchSyncState(this.db, { lastPullAt: this.wall() });
  }

  /**
   * Una página en UNA transacción junto con el cursor: o entra entera y el
   * cursor avanza, o no entra nada (§8.5). Las claves foráneas se apagan solo
   * aquí (§7.7): una fila puede llegar antes que su padre y una restricción
   * atascaría el sync para siempre.
   */
  private applyPage(
    rows: readonly WireRow[],
    next: number,
    result: CycleResult,
    changes: Map<string, Set<string>>,
  ): void {
    const client = this.db.$client;
    const touched: [string, string][] = [];
    let applied = 0;
    let skipped = 0;
    client.exec('PRAGMA foreign_keys = OFF');
    try {
      this.transaction(() => {
        for (const wire of rows) {
          const outcome = this.applyRow(wire);
          if (outcome === 'skipped') skipped += 1;
          else if (outcome === 'applied') {
            applied += 1;
            touched.push([wire.table, wire.id]);
          }
        }
        patchSyncState(this.db, { pullCursor: next });
      });
    } finally {
      client.exec('PRAGMA foreign_keys = ON');
    }
    result.pulled += rows.length;
    result.applied += applied;
    result.skipped += skipped;
    for (const [table, id] of touched) {
      let ids = changes.get(table);
      if (!ids) changes.set(table, (ids = new Set()));
      ids.add(id);
    }
  }

  /** Fusiona una fila entrante con la local. `unknown` = tabla que este cliente no tiene (§8.7). */
  private applyRow(wire: WireRow): 'applied' | 'echo' | 'skipped' | 'unknown' {
    const table = typeof wire?.table === 'string' ? syncTableByName(wire.table) : undefined;
    if (!table) return 'unknown';
    const problem = wireProblem(wire);
    if (problem) {
      this.log.warn(`fila descartada ${wire.table}/${String(wire.id)}: ${problem}`);
      return 'skipped';
    }
    const incoming = project(fromWire(wire), table.shape);
    // §8.2: los relojes que se ven adelantan el propio, para que lo que se
    // escriba después en este PC ordene por encima.
    this.clock.observe(incoming.created);
    for (const clock of Object.values(incoming.clocks)) this.clock.observe(clock);

    const raw = this.db.$client.prepare(table.selectOneSql).get(wire.id) as SqlRow | undefined;
    const local = raw ? decodeStored(raw, table.shape) : undefined;
    const merged = mergeRows(local, incoming);
    if (local && canonical(local, table.shape) === canonical(merged, table.shape)) return 'echo';

    const encoded = encodeStored(merged, table.shape);
    const missing = table.required.find((column) => encoded[column] === null);
    if (missing) {
      // Una columna NOT NULL sin valor (§7.4): aplicarla abortaría la página
      // entera y el cursor no avanzaría nunca. Se aparta esta fila.
      this.log.warn(`fila descartada ${wire.table}/${wire.id}: falta ${missing} (NOT NULL)`);
      return 'skipped';
    }
    this.writeRow(table, merged);
    return 'applied';
  }

  /** UPSERT de una fila ya fusionada. No toca `syncDirty` de una fila que existe. */
  private writeRow(table: SyncTable, row: Parameters<typeof encodeStored>[0]): void {
    const encoded = encodeStored(row, table.shape) as unknown as Record<string, SqlValue>;
    const values = table.writeColumns.map((column) => encoded[column] ?? null) as SQLInputValue[];
    this.db.$client.prepare(table.upsertSql).run(...values);
  }

  // ── Piezas comunes ────────────────────────────────────────────────────────

  /** Una transacción síncrona sobre la conexión. IMMEDIATE, como la puerta de escritura. */
  private transaction(fn: () => void): void {
    const client = this.db.$client;
    if (client.isTransaction) {
      throw new Error('el motor de sync no puede trabajar dentro de una transacción ajena');
    }
    client.exec('BEGIN IMMEDIATE');
    try {
      fn();
      client.exec('COMMIT');
    } catch (error) {
      if (client.isTransaction) client.exec('ROLLBACK');
      throw error;
    }
  }

  /** Si el hub de la respuesta no es el del `status` del ciclo, no se fía de nada de ella. */
  private assertSameHub(status: HubIdentity, response: HubIdentity): void {
    if (response.hubId !== status.hubId || response.epoch !== status.epoch) {
      throw new CycleAbort(
        'error',
        'hub_changed',
        'el hub cambió de identidad durante el ciclo',
        true,
      );
    }
  }

  private emitChanges(changes: Map<string, Set<string>>): void {
    if (changes.size === 0 || !this.onChange) return;
    const ids: Record<string, string[]> = {};
    for (const [table, set] of changes) ids[table] = [...set];
    try {
      this.onChange({ tables: Object.keys(ids), ids });
    } catch (error) {
      this.log.error('un oyente de cambios del sync ha fallado', error);
    }
  }

  private fail(result: CycleResult, error: unknown): void {
    if (error instanceof CycleAbort) {
      result.status = error.status;
      result.retry = error.retry;
      result.minSchema = error.minSchema;
      result.error = { code: error.code, message: error.message };
      return;
    }
    if (error instanceof SyncRequestError) {
      const message = error.message;
      switch (error.code) {
        case 'schema_too_old': {
          // §8.7: el cliente deja de sincronizar y sigue en local. Sin
          // `minSchema` en el cuerpo se asume "la siguiente a la mía".
          const min = error.body?.minSchema ?? this.schemaVersion + 1;
          patchSyncState(this.db, { blockedMinSchema: min });
          result.status = 'blocked';
          result.minSchema = min;
          result.error = {
            code: 'schema_too_old',
            message: 'actualiza Afterplay para volver a sincronizar',
          };
          return;
        }
        case 'unauthorized':
          result.status = 'unauthorized';
          result.error = { code: 'unauthorized', message };
          return;
        case 'protocol_mismatch':
          // Ni este PC ni el hub pueden arreglarlo solos: hace falta actualizar.
          result.status = 'blocked';
          result.error = {
            code: 'protocol_mismatch',
            message: 'actualiza Afterplay para volver a sincronizar',
          };
          return;
        default:
          result.status = 'error';
          result.retry = true;
          result.error = { code: error.code, message };
          return;
      }
    }
    this.log.error('el ciclo de sync falló', error);
    result.status = 'error';
    result.retry = true;
    result.error = {
      code: 'internal',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  /** Guarda en `local_sync_state` cómo terminó el ciclo. */
  private recordOutcome(result: CycleResult): void {
    try {
      if (result.status === 'ok') {
        patchSyncState(this.db, {
          lastError: null,
          lastErrorAt: null,
          lastErrorCode: null,
          protocolVersion: PROTOCOL_VERSION,
        });
      } else if (result.error) {
        patchSyncState(this.db, {
          lastError: result.error.message,
          lastErrorAt: this.wall(),
          lastErrorCode: result.error.code,
        });
      }
    } catch (error) {
      this.log.error('no se pudo guardar el estado del sync', error);
    }
  }
}

/** Defensa ante un hub que envía algo que no es una fila válida. Null = válida. */
function wireProblem(wire: WireRow): string | null {
  if (typeof wire.id !== 'string' || wire.id.length === 0) return 'id inválido';
  if (!isClock(wire.created)) return 'reloj de creación inválido';
  if (wire.deleted !== null && !isClock(wire.deleted)) return 'lápida inválida';
  if (!wire.fields || typeof wire.fields !== 'object') return 'sin campos';
  if (!wire.clocks || typeof wire.clocks !== 'object') return 'sin relojes';
  for (const [column, value] of Object.entries(wire.fields)) {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
      return `valor no SQL en ${column}`;
    }
    if (!isClock(wire.clocks[column])) return `reloj inválido o ausente en ${column}`;
  }
  for (const clock of Object.values(wire.clocks)) {
    if (!isClock(clock)) return 'reloj mal formado';
  }
  if (wire.deleted !== null && wire.clocks.syncDeleted === undefined) return 'lápida sin reloj';
  return null;
}
