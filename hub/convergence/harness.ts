// Arnés de convergencia (§17.2): UN proceso con un hub real (`hub/core` sobre
// SQLite en memoria) y N clientes de escritorio reales, cada uno con su base
// 2.0, su reloj de pared controlable y su motor de sync, unidos por un
// transporte de proceso que pasa por las mismas validaciones que el HTTP.
//
// Lo único falso es la red y la hora. Las escrituras de los tests deben ir por
// las consultas reales de `src/main/db/v2/queries` (la puerta de escritura
// pone relojes y `syncDirty`); aquí solo hay andamio.

import { HybridClock, type Clock } from '../../src/shared/sync/clock';
import {
  canonical,
  decodeStored,
  type RowState,
  type SqlRow,
  type WireRow,
} from '../../src/shared/sync/merge';
import {
  PROTOCOL_VERSION,
  type ClientVersion,
  type PushResponse,
  type PullResponse,
} from '../../src/shared/sync/protocol';
import { APP_SCHEMA_VERSION } from '../../src/main/db/v2/schemaVersion';
import { T0, type FakeWall } from '../../src/main/db/v2/__tests__/helpers';
import {
  openQueryDb,
  type QueryFixture,
} from '../../src/main/db/v2/queries/common/__tests__/fixtures';
import { ensureThisDevice } from '../../src/main/db/v2/queries/common/device';
import type { QueryContext } from '../../src/main/db/v2/queries/common/context';
import { createSyncEngine, type CycleResult, type SyncEngine } from '../../src/main/sync/engine';
import { applyEnrollment, readSyncState } from '../../src/main/sync/state';
import { syncTables } from '../../src/main/sync/tables';
import { TenantHub, type HubOptions } from '../core/hub';
import { NodeSqlStorage } from '../core/node/nodeStorage';
import { HubQueries } from '../core/queries';
import { drizzle } from 'drizzle-orm/node-sqlite';
import type { LocalDb } from '../../src/main/db/v2/store';
import {
  createInProcessTransport,
  enrollInProcess,
  type InProcessTransport,
} from './inProcessTransport';

export { T0 };

const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export { DAY_MS };

// ---------- Mundo: el hub y sus clientes ----------

export interface WorldOptions {
  /** Opciones del hub (tablas, límites, maxSchema…). `tenantId` ya va puesto. */
  hub?: Partial<HubOptions>;
}

export interface ClientOptions {
  /** La `schemaVersion` que declara el motor de este PC (§8.7). Por defecto la de este build. */
  schemaVersion?: number;
  /** Cuánto adelanta (o atrasa) su reloj de pared respecto al del hub. */
  skewMs?: number;
  /** Si es false, queda sin emparejar (para probar el primer arranque). */
  enroll?: boolean;
}

export class World {
  /** La hora del hub; los relojes de los clientes se mueven con ella más su desfase. */
  readonly hubTime = { now: T0 };
  /** Fallos internos del hub (excepciones que no son `HubError`): deben quedar vacíos. */
  readonly faults: unknown[] = [];
  readonly clients: Client[] = [];
  storage: NodeSqlStorage;
  hub: TenantHub;
  private readonly hubOptions: Partial<HubOptions>;

  constructor(options: WorldOptions = {}) {
    this.hubOptions = options.hub ?? {};
    this.storage = new NodeSqlStorage();
    this.hub = this.newHub(this.storage);
  }

  private newHub(storage: NodeSqlStorage): TenantHub {
    return new TenantHub(storage, () => this.hubTime.now, {
      tenantId: 'tenant1',
      ...this.hubOptions,
    });
  }

  /**
   * Un hub NUEVO y vacío (otro `hubId`): lo que pasa si se pierde o se recrea el
   * Durable Object. Los tokens y los dispositivos del anterior desaparecen;
   * los clientes tienen que volver a emparejarse (`reenroll`).
   */
  replaceHub(): void {
    this.storage = new NodeSqlStorage();
    this.hub = this.newHub(this.storage);
  }

  /** Avanza el tiempo real: la hora del hub y la de todos los clientes, a la vez. */
  advance(ms: number): void {
    this.hubTime.now += ms;
    for (const client of this.clients) client.wall.advance(ms);
  }

  /**
   * El móvil (§13): las consultas del escritorio ejecutadas en el hub, como lo
   * hace el Durable Object pero con Drizzle sobre node:sqlite. Uno nuevo por
   * llamada, siempre sobre el hub actual.
   */
  web(): HubQueries {
    const db = drizzle({ client: this.storage.db }) as unknown as LocalDb;
    return new HubQueries(this.hub, db);
  }

  async addClient(name: string, options: ClientOptions = {}): Promise<Client> {
    const client = new Client(this, name, this.clients.length, options);
    this.clients.push(client);
    if (options.enroll ?? true) await client.enroll();
    return client;
  }

  /**
   * Sincroniza a todos los que tienen red, en rondas, hasta que una ronda
   * entera no sube ni aplica nada. Devuelve cuántas rondas hicieron falta.
   * Lanza si no se aquieta (un ciclo infinito de eco o de pérdida).
   */
  async quiesce(maxRounds = 12): Promise<number> {
    for (let round = 1; round <= maxRounds; round++) {
      let active = false;
      for (const client of this.clients) {
        if (!client.online || client.enrolled === false) continue;
        const result = await client.sync();
        if (result.status !== 'ok' || result.pushed > 0 || result.applied > 0) active = true;
      }
      if (!active) return round;
    }
    throw new Error(`el sync no se aquieta tras ${maxRounds} rondas`);
  }

  /** Cierra todas las bases. */
  close(): void {
    for (const client of this.clients) client.close();
  }

  // ---------- Lectura de las bases ----------

  /** Filas de una tabla en el hub, con la forma explícita de la fusión. */
  hubRows(table: string): Map<string, RowState> {
    const syncTable = tableByName(table);
    const out = new Map<string, RowState>();
    for (const row of this.storage.exec(`SELECT * FROM "${table}"`)) {
      out.set(String(row.id), decodeStored(row as SqlRow, syncTable.shape));
    }
    return out;
  }

  /** La fila cruda del hub (con columnas que el cliente no conoce, `syncSeq`…). */
  hubRaw(table: string, id: string): SqlRow | undefined {
    return this.storage.exec(`SELECT * FROM "${table}" WHERE id = ?`, id)[0] as SqlRow | undefined;
  }

  hubSeq(): number {
    return this.hub.status(version(APP_SCHEMA_VERSION)).seq;
  }
}

function tableByName(table: string): (typeof syncTables)[number] {
  const found = syncTables.find((t) => t.name === table);
  if (!found) throw new Error(`tabla sincronizada desconocida: ${table}`);
  return found;
}

export const version = (schemaVersion: number): ClientVersion => ({
  protocolVersion: PROTOCOL_VERSION,
  schemaVersion,
});

// ---------- Cliente de escritorio ----------

export class Client {
  readonly name: string;
  readonly deviceId: string;
  readonly wall: FakeWall;
  readonly fx: QueryFixture;
  schemaVersion: number;
  engine: SyncEngine;
  readonly transport: InProcessTransport;
  /** Resultado de cada ciclo, en orden. */
  readonly results: CycleResult[] = [];
  /** Lo que el motor avisó al bajar. */
  readonly changes: {
    tables: readonly string[];
    ids: Readonly<Record<string, readonly string[]>>;
  }[] = [];
  online = true;
  enrolled = false;
  private token: string | null = null;

  constructor(
    private readonly world: World,
    name: string,
    index: number,
    options: ClientOptions,
  ) {
    this.name = name;
    this.deviceId = `0194c2f0-${String(index).padStart(4, '0')}-7000-8000-${name
      .padEnd(12, '0')
      .slice(0, 12)}`;
    this.schemaVersion = options.schemaVersion ?? APP_SCHEMA_VERSION;
    this.fx = openQueryDb({
      deviceId: this.deviceId,
      start: world.hubTime.now + (options.skewMs ?? 0),
      withThisDevice: false,
    });
    this.wall = this.fx.wall;
    ensureThisDevice(this.fx.ctx, {
      name: `PC-${name}`,
      home: `C:\\Users\\${name}`,
      appVersion: '2.0.0-test',
      schemaVersion: this.schemaVersion,
      now: this.fx.ctx.now(),
    });
    this.transport = createInProcessTransport({
      hub: () => world.hub,
      token: () => this.token,
      online: () => this.online,
      faults: world.faults,
    });
    this.engine = this.makeEngine(this.schemaVersion);
  }

  /** La app se actualiza: mismo PC y misma base, otro motor con otra `schemaVersion` (§8.7). */
  upgrade(schemaVersion: number): void {
    this.schemaVersion = schemaVersion;
    this.engine = this.makeEngine(schemaVersion);
  }

  /** Un motor sobre esta misma base, p. ej. el de la app tras actualizarse. */
  makeEngine(schemaVersion: number, transport: InProcessTransport = this.transport): SyncEngine {
    return createSyncEngine({
      local: this.fx.local,
      transport,
      now: this.wall.wall,
      schemaVersion,
      onChange: (change) => this.changes.push(change),
    });
  }

  get ctx(): QueryContext {
    return this.fx.ctx;
  }

  get local(): QueryFixture['local'] {
    return this.fx.local;
  }

  /** Empareja con el hub: código → canje → `applyEnrollment` (§9.3). */
  async enroll(): Promise<void> {
    const { code } = await this.world.hub.createEnrollmentCode({ ttlMinutes: 60 });
    const response = await enrollInProcess(
      this.world.hub,
      this.online,
      {
        ...version(this.schemaVersion),
        code,
        deviceId: this.deviceId,
        deviceName: `PC-${this.name}`,
      },
      this.world.faults,
    );
    applyEnrollment(this.fx.local.db, response, this.fx.local.clock);
    this.token = response.token;
    this.enrolled = true;
  }

  /** Un ciclo de sync (nunca lanza: el resultado lo dice). */
  async sync(): Promise<CycleResult> {
    const result = await this.engine.runCycle();
    this.results.push(result);
    return result;
  }

  /** Un ciclo que tiene que salir bien. */
  async syncOk(): Promise<CycleResult> {
    const result = await this.sync();
    if (result.status !== 'ok') {
      throw new Error(`${this.name}: el ciclo no salió ok: ${JSON.stringify(result)}`);
    }
    return result;
  }

  cut(): void {
    this.online = false;
  }

  restore(): void {
    this.online = true;
  }

  /** Filas de una tabla en este cliente, con la forma explícita de la fusión. */
  rows(table: string): Map<string, RowState> {
    const syncTable = tableByName(table);
    const out = new Map<string, RowState>();
    const raw = this.fx.local.db.$client.prepare(`SELECT * FROM "${table}"`).all();
    for (const row of raw)
      out.set(String(row.id), decodeStored({ ...row } as SqlRow, syncTable.shape));
    return out;
  }

  raw(table: string, id: string): SqlRow | undefined {
    const row = this.fx.local.db.$client.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
    return row ? ({ ...row } as SqlRow) : undefined;
  }

  /** Filas con `syncDirty = 1` (pendientes de subir) en todas las tablas sincronizadas. */
  dirtyCount(): number {
    let total = 0;
    for (const table of syncTables) {
      const row = this.fx.local.db.$client
        .prepare(`SELECT count(*) AS n FROM "${table.name}" WHERE "syncDirty" = 1`)
        .get();
      total += Number(row?.n);
    }
    return total;
  }

  syncState(): ReturnType<typeof readSyncState> {
    return readSyncState(this.fx.local.db);
  }

  close(): void {
    this.fx.close();
  }
}

// ---------- Dispositivo "nuevo": habla el protocolo sin base local ----------

/**
 * Un dispositivo que solo habla el protocolo: lo que hará un cliente de una
 * versión POSTERIOR a la de los clientes reales del arnés (E-14), cuyas
 * columnas y tablas nuevas este código de escritorio no tiene. Sube y baja
 * filas en tránsito a mano, con relojes de verdad.
 */
export class RawDevice {
  readonly clock: HybridClock;
  readonly transport: InProcessTransport;
  private token: string | null = null;
  shortDeviceId = '';

  constructor(
    private readonly world: World,
    readonly name: string,
    readonly schemaVersion: number,
  ) {
    this.clock = new HybridClock('raw000', () => world.hubTime.now);
    this.transport = createInProcessTransport({
      hub: () => world.hub,
      token: () => this.token,
      online: () => true,
      faults: world.faults,
    });
  }

  async enroll(): Promise<void> {
    const { code } = await this.world.hub.createEnrollmentCode({ ttlMinutes: 60 });
    const response = await enrollInProcess(
      this.world.hub,
      true,
      { ...version(this.schemaVersion), code, deviceId: `raw-${this.name}`, deviceName: this.name },
      this.world.faults,
    );
    this.token = response.token;
    this.shortDeviceId = response.shortDeviceId;
    this.clock.setDev(response.shortDeviceId);
  }

  /** Un reloj nuevo de este dispositivo. */
  tick(): Clock {
    return this.clock.now();
  }

  push(rows: WireRow[]): Promise<PushResponse> {
    return this.transport.push({ ...version(this.schemaVersion), rows });
  }

  pull(since = 0, limit = 1000): Promise<PullResponse> {
    return this.transport.pull(since, limit, version(this.schemaVersion));
  }
}

// ---------- Comparación hub / clientes ----------

/** Diferencias entre las bases, en texto. Vacío = idénticas. */
export function diffAgainstHub(world: World, clients: readonly Client[] = world.clients): string[] {
  const problems: string[] = [];
  for (const table of syncTables) {
    const hub = world.hubRows(table.name);
    for (const client of clients) {
      const local = client.rows(table.name);
      for (const [id, hubRow] of hub) {
        const localRow = local.get(id);
        if (!localRow) {
          problems.push(`${client.name}: falta ${table.name}/${id} (el hub la tiene)`);
        } else if (canonical(localRow, table.shape) !== canonical(hubRow, table.shape)) {
          problems.push(
            `${client.name}: ${table.name}/${id} difiere\n  hub:    ${canonical(hubRow, table.shape)}\n  cliente: ${canonical(localRow, table.shape)}`,
          );
        }
      }
      for (const id of local.keys()) {
        if (!hub.has(id)) problems.push(`${client.name}: ${table.name}/${id} no está en el hub`);
      }
    }
  }
  return problems;
}

/** Todo converge: bases idénticas al hub, nada pendiente, ningún fallo interno del hub. */
export function convergenceProblems(
  world: World,
  clients: readonly Client[] = world.clients,
): string[] {
  const problems = diffAgainstHub(world, clients);
  for (const client of clients) {
    const dirty = client.dirtyCount();
    if (dirty > 0) problems.push(`${client.name}: ${dirty} fila(s) siguen pendientes de subir`);
  }
  for (const fault of world.faults) {
    problems.push(`fallo interno del hub: ${fault instanceof Error ? fault.stack : String(fault)}`);
  }
  return problems;
}
