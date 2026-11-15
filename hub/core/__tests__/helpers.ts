// Andamio de los tests del hub: un hub sobre SQLite en memoria con reloj
// controlable, y constructores de filas en tránsito.

import { formatClock, type Clock } from '../../../src/shared/sync/clock';
import type { SqlValue, WireRow } from '../../../src/shared/sync/merge';
import {
  PROTOCOL_VERSION,
  type ClientVersion,
  type PushRequest,
  type PushResponse,
} from '../../../src/shared/sync/protocol';
import { APP_SCHEMA_VERSION } from '../../../src/main/db/v2/schemaVersion';
import { TenantHub, type HubOptions } from '../hub';
import { NodeSqlStorage } from '../node/nodeStorage';
import type { SqlRow, SqlStorage } from '../storage';

/** Una fecha fija y razonable: 2026-01-01T00:00:00Z. */
export const T0 = Date.UTC(2026, 0, 1);

export const VERSION: ClientVersion = {
  protocolVersion: PROTOCOL_VERSION,
  schemaVersion: APP_SCHEMA_VERSION,
};

export interface TestHub {
  hub: TenantHub;
  storage: SqlStorage;
  /** Hora del hub, en ms. Se mueve a mano. */
  time: { now: number };
}

export function makeHub(options: Partial<HubOptions> = {}, storage?: SqlStorage): TestHub {
  const time = { now: T0 };
  const store = storage ?? new NodeSqlStorage();
  const hub = new TenantHub(store, () => time.now, { tenantId: 'tenant1', ...options });
  return { hub, storage: store, time };
}

/** Reloj de un dispositivo en el milisegundo `ms` (relativo a T0). */
export const clockAt = (ms: number, dev: string, counter = 0): Clock =>
  formatClock(T0 + ms, counter, dev);

export interface RowSpec {
  table?: string;
  id: string;
  /** Reloj de creación y de todas las columnas, salvo que `clocks` diga otra cosa. */
  at: Clock;
  fields?: Record<string, SqlValue>;
  clocks?: Record<string, Clock>;
  deleted?: Clock | null;
}

/** Una fila en tránsito con relojes explícitos para cada columna. */
export function wire(spec: RowSpec): WireRow {
  const fields = spec.fields ?? {};
  const clocks: Record<string, Clock> = {};
  for (const column of Object.keys(fields)) clocks[column] = spec.clocks?.[column] ?? spec.at;
  const deleted = spec.deleted ?? null;
  if (deleted !== null) clocks.syncDeleted = spec.clocks?.syncDeleted ?? deleted;
  return {
    table: spec.table ?? 'games',
    id: spec.id,
    created: spec.at,
    deleted,
    fields,
    clocks,
  };
}

export const pushRequest = (rows: WireRow[]): PushRequest => ({ ...VERSION, rows });

/** `push` y comprueba que la petición entera no falla. */
export function push(hub: TenantHub, ...rows: WireRow[]): PushResponse {
  return hub.push(pushRequest(rows));
}

/** Pagina `pull` hasta agotarlo y devuelve todas las filas entregadas. */
export function pullAll(hub: TenantHub, since = 0, limit = 1000): WireRow[] {
  const out: WireRow[] = [];
  let cursor = since;
  for (;;) {
    const page = hub.pull(cursor, limit, VERSION);
    out.push(...page.rows);
    cursor = page.next;
    if (!page.more) return out;
  }
}

export const seqOf = (hub: TenantHub): number => hub.status(VERSION).seq;

/** Un `SqlStorage` que anota cada sentencia que se ejecuta, para comprobar límites. */
export function recordingStorage(inner: SqlStorage): {
  storage: SqlStorage;
  statements: { sql: string; params: SqlValue[] }[];
} {
  const statements: { sql: string; params: SqlValue[] }[] = [];
  const storage: SqlStorage = {
    exec(sql, ...params): SqlRow[] {
      statements.push({ sql, params });
      return inner.exec(sql, ...params);
    },
    execScript: (sql) => inner.execScript(sql),
    transactionSync: (fn) => inner.transactionSync(fn),
  };
  return { storage, statements };
}
