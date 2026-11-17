// Esquema del hub (§9.4): las tablas sincronizadas derivadas de las MISMAS
// definiciones de Drizzle que usa el cliente (S-01, comprobado en el spike
// `hub-do`), más las tablas propias del hub.
//
// Por qué se genera el DDL en ejecución con `getTableConfig` y no se guardan
// SQL generados (drizzle-kit):
// - Una sola fuente de verdad: añadir una columna al cliente la añade al hub
//   sin un segundo paso que alguien pueda olvidar. Un SQL guardado puede
//   quedarse atrás en silencio; el test `schema.test.ts` falla si el hub y el
//   cliente difieren en columnas.
// - El hub no usa el migrador de Drizzle: su esquema es siempre "lo que dice
//   el código" y solo crece (§8.7), así que basta crear lo que falta y añadir
//   las columnas que falten. Eso es más simple y más barato en un Durable
//   Object que llevar un diario de migraciones.
// - El coste de arranque se evita con una huella del DDL guardada en
//   `tenant_meta`: si coincide, no se toca el esquema.
//
// Diferencias con el cliente, todas deliberadas:
// - Sin claves foráneas (§7.7): una rota al confirmar reinicia el Durable
//   Object, y el hub tiene que poder guardar un hijo cuyo padre no ha llegado.
// - Con `syncSeq INTEGER` indexado (§7.3, §8.4). El índice es parcial: solo
//   entran las filas que han cambiado alguna vez.
// - `syncDirty` existe pero no significa nada: no viaja ni se lee. Está para
//   que la puerta de escritura del cliente (`WriteStore`), que lo marca en
//   cada escritura, funcione tal cual sobre las tablas del hub cuando escribe
//   el móvil (§13.3). Por la misma razón están, vacías y sin restricciones,
//   las tablas locales (clase L): las consultas del escritorio las leen o las
//   cruzan, y el móvil no tiene nada local.
// - Sin restricciones CHECK ni índices propios del cliente: el hub guarda y
//   fusiona, no valida el dominio. Una restricción que fallase en mitad de un
//   lote desharía el lote entero. Los índices del cliente sirven a consultas
//   del cliente; cada índice extra es una escritura más por fila (§9.7). Si una
//   barrida del hub necesita uno, se añade aquí con su motivo.
// - Las columnas de datos son NULLables aunque en el cliente no lo sean: un
//   cliente más viejo no manda las columnas nuevas y la fusión las rellena con
//   su defecto o con null. Un NOT NULL haría fallar y deshacer el lote entero.
//   La integridad la impone la puerta de escritura del cliente.

import { getTableConfig } from 'drizzle-orm/sqlite-core';
import {
  localEntries,
  syncedEntries,
  type LocalTableEntry,
  type SyncedTableEntry,
} from '../../src/main/db/v2/registry';
import { BOTTOM } from '../../src/shared/sync/clock';
import type { SqlValue, TableShape } from '../../src/shared/sync/merge';
import { sha1 } from '../../src/shared/sync/sha1';
import { MAX_SQL_PARAMS, type SqlStorage } from './storage';

/** Columnas de §7.3 que no son datos: ni van en `TableShape` ni tienen reloj propio. */
const COMMON_COLUMNS = new Set([
  'id',
  'syncCreated',
  'syncUpdated',
  'syncFields',
  'syncDeleted',
  'syncDirty',
  'syncSeq',
]);

/** Las columnas comunes que SÍ existen en el hub, en el orden en que se guardan. */
export const HUB_SYNC_COLUMNS = [
  'id',
  'syncCreated',
  'syncUpdated',
  'syncFields',
  'syncDeleted',
  'syncSeq',
] as const;

export interface HubTableColumn {
  name: string;
  /** Tipo SQL (`text`, `integer`, `real`). */
  type: string;
  /** Literal SQL del valor por defecto, o null. */
  defaultSql: string | null;
}

/** Una tabla sincronizada tal como existe en el hub. */
export interface HubTable {
  name: string;
  /** Lo que necesita `merge.ts`: columnas de datos y sus defectos. */
  shape: TableShape;
  /** Columnas de datos (las de `shape.columns`) con su tipo, para el DDL. */
  dataColumns: HubTableColumn[];
  createSql: string;
  indexSql: string;
  /** `INSERT ... ON CONFLICT(id) DO UPDATE` con todas las columnas. */
  upsertSql: string;
  /** Columnas del upsert (sin `id`) en el orden de sus parámetros; el `id` va el último. */
  upsertColumns: string[];
}

const quote = (name: string): string => `"${name}"`;

/** Ver la cabecera: sin significado en el hub, solo para la puerta del cliente. */
const SYNC_DIRTY_DDL = `${quote('syncDirty')} INTEGER NOT NULL DEFAULT 0`;

function sqlLiteral(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function buildTable(entry: SyncedTableEntry): HubTable {
  const config = getTableConfig(entry.table);
  const dataColumns: HubTableColumn[] = [];
  const defaults: Record<string, SqlValue> = {};

  for (const column of config.columns) {
    if (COMMON_COLUMNS.has(column.name)) continue;
    let defaultSql: string | null = null;
    if (column.hasDefault && column.default !== undefined) {
      // Defecto estático (false, [], 'measured'...): se pasa por el mismo
      // mapeo que usa Drizzle al escribir, para obtener el valor crudo de SQL
      // (0/1, texto JSON, ms). Un defecto que sea una expresión SQL no tiene
      // valor crudo y no cabe en un hub que solo fusiona: se falla al arrancar.
      const raw: unknown = column.mapToDriverValue(column.default);
      if (typeof raw !== 'string' && typeof raw !== 'number' && raw !== null) {
        throw new Error(`${entry.name}.${column.name}: el defecto no es un valor de SQL simple`);
      }
      defaults[column.name] = raw;
      defaultSql = sqlLiteral(raw);
    }
    dataColumns.push({ name: column.name, type: column.getSQLType(), defaultSql });
  }

  const columnSql = [
    `${quote('id')} TEXT PRIMARY KEY NOT NULL`,
    `${quote('syncCreated')} TEXT NOT NULL`,
    `${quote('syncUpdated')} TEXT NOT NULL`,
    `${quote('syncFields')} TEXT NOT NULL DEFAULT '{}'`,
    `${quote('syncDeleted')} TEXT`,
    `${quote('syncSeq')} INTEGER`,
    SYNC_DIRTY_DDL,
    ...dataColumns.map(
      (c) =>
        `${quote(c.name)} ${c.type.toUpperCase()}${c.defaultSql ? ` DEFAULT ${c.defaultSql}` : ''}`,
    ),
  ];
  const upsertColumns = [
    ...HUB_SYNC_COLUMNS.filter((c) => c !== 'id'),
    ...dataColumns.map((c) => c.name),
  ];
  // Un parámetro por columna más el id: tiene que caber en el límite de un DO.
  if (upsertColumns.length + 1 > MAX_SQL_PARAMS) {
    throw new Error(
      `${entry.name}: demasiadas columnas para una sentencia (${upsertColumns.length + 1})`,
    );
  }

  const insertColumns = ['id', ...upsertColumns];
  return {
    name: entry.name,
    shape: { columns: dataColumns.map((c) => c.name), defaults },
    dataColumns,
    createSql: `CREATE TABLE IF NOT EXISTS ${quote(entry.name)} (\n  ${columnSql.join(',\n  ')}\n);`,
    // Parcial: solo las filas con secuencia (todas las que ha tocado el hub).
    indexSql: `CREATE INDEX IF NOT EXISTS ${quote(`${entry.name}_sync_seq_idx`)} ON ${quote(entry.name)} ("syncSeq") WHERE "syncSeq" IS NOT NULL;`,
    upsertSql:
      `INSERT INTO ${quote(entry.name)} (${insertColumns.map(quote).join(', ')}) ` +
      `VALUES (${insertColumns.map(() => '?').join(', ')}) ` +
      `ON CONFLICT("id") DO UPDATE SET ${upsertColumns.map((c) => `${quote(c)} = excluded.${quote(c)}`).join(', ')}`,
    upsertColumns,
  };
}

/** Una tabla local (clase L) del cliente, vacía en el hub (ver la cabecera). */
export interface HubLocalTable {
  name: string;
  columns: HubTableColumn[];
  createSql: string;
}

function buildLocalTable(entry: LocalTableEntry): HubLocalTable {
  const config = getTableConfig(entry.table);
  // Sin claves, sin NOT NULL ni defectos: nadie escribe en ellas en el hub.
  const columns = config.columns.map((column) => ({
    name: column.name,
    type: column.getSQLType(),
    defaultSql: null,
  }));
  const body = columns.map((c) => `${quote(c.name)} ${c.type.toUpperCase()}`).join(',\n  ');
  return {
    name: entry.name,
    columns,
    createSql: `CREATE TABLE IF NOT EXISTS ${quote(entry.name)} (\n  ${body}\n);`,
  };
}

/** Las tablas locales del cliente, en el orden del registro. */
export function buildHubLocalTables(
  entries: readonly LocalTableEntry[] = localEntries,
): HubLocalTable[] {
  return entries.map(buildLocalTable);
}

/** Las tablas sincronizadas del hub, en el orden del registro. */
export function buildHubTables(entries: readonly SyncedTableEntry[] = syncedEntries): HubTable[] {
  return entries.map(buildTable);
}

// ---------- Tablas propias del hub (§9.4) ----------

// `tenant_meta` es clave/valor: `seq` (secuencia del inquilino), `hubId`,
// `epoch`, `minSchema`, `createdAt` y `schemaStamp` (huella del DDL). Las
// demás son una por función. Ninguna guarda credenciales de terceros (F-29).
const TENANT_META_SQL = `CREATE TABLE IF NOT EXISTS tenant_meta (k TEXT PRIMARY KEY NOT NULL, v);`;

const HUB_OWN_SQL = [
  // Un token por emparejado. Solo se guarda la huella SHA-256 del secreto.
  `CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  deviceId TEXT NOT NULL,
  deviceName TEXT NOT NULL,
  shortDeviceId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastUsedAt INTEGER,
  revokedAt INTEGER
);`,
  `CREATE INDEX IF NOT EXISTS device_tokens_device_idx ON device_tokens (deviceId);`,
  // Id corto de reloj por dispositivo (§8.2). UNIQUE: no hay dos iguales en el inquilino.
  `CREATE TABLE IF NOT EXISTS device_short_ids (
  deviceId TEXT PRIMARY KEY NOT NULL,
  shortId TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL
);`,
  // Códigos de emparejado (§9.3). Se guarda la huella, nunca el código.
  `CREATE TABLE IF NOT EXISTS enrollment_codes (
  codeHash TEXT PRIMARY KEY NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  usesLeft INTEGER NOT NULL
);`,
  // Secreto de alta de la migración (§9.3, §19.3.1): UNO por inquilino (`id = 1`),
  // de varios usos, que caduca. Emitir otro sustituye al anterior. Solo huella.
  `CREATE TABLE IF NOT EXISTS enrollment_secret (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  secretHash TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);`,
  // Concesiones de trabajo (§14.3). Cerrada = `closedAt` no nulo; cerrada sigue ocupando el par hasta `expiresAt`.
  `CREATE TABLE IF NOT EXISTS job_leases (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  jobKey TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  closedAt INTEGER,
  outcome TEXT,
  reason TEXT
);`,
  `CREATE INDEX IF NOT EXISTS job_leases_kind_key_idx ON job_leases (kind, jobKey);`,
];

/**
 * Columnas que una versión posterior añade a una tabla PROPIA del hub (las
 * sincronizadas se añaden solas desde Drizzle). Solo aditivo (§8.7). Vacío por
 * ahora: se rellena con `{ table, column, ddl }` y se aplica si falta.
 */
const HUB_OWN_ADDED_COLUMNS: readonly { table: string; column: string; ddl: string }[] = [];

// ---------- Aplicar el esquema ----------

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Huella del DDL completo: si no cambia, no hay nada que aplicar. */
export function schemaFingerprint(
  tables: readonly HubTable[],
  locals: readonly HubLocalTable[] = buildHubLocalTables(),
): string {
  const text = [
    TENANT_META_SQL,
    ...HUB_OWN_SQL,
    ...HUB_OWN_ADDED_COLUMNS.map((c) => `${c.table}.${c.column} ${c.ddl}`),
    ...tables.flatMap((t) => [t.createSql, t.indexSql]),
    ...locals.map((t) => t.createSql),
  ].join('\n');
  return hex(sha1(new TextEncoder().encode(text)));
}

function existingColumns(storage: SqlStorage, table: string): Set<string> {
  // `PRAGMA table_info` es de las pocas pragmas que admite un Durable Object.
  return new Set(storage.exec(`PRAGMA table_info(${quote(table)})`).map((row) => String(row.name)));
}

/**
 * Crea lo que falta y añade las columnas que faltan (solo aditivo, §8.7):
 * nunca renombra, borra ni cambia el tipo de nada. Idempotente y barato en
 * el caso normal (una lectura de `tenant_meta`).
 *
 * Una columna sincronizada que se añade a una tabla con filas nace con reloj
 * `BOTTOM` en todas ellas (§8.3, H-6): si heredara el reloj de creación, su
 * valor por defecto empataría con el valor real que escriba otro dispositivo.
 * Eso son las filas de `syncFields`; no se sube la secuencia (los clientes que
 * ganan columnas ponen su cursor a cero, §8.7).
 */
export function ensureSchema(
  storage: SqlStorage,
  tables: readonly HubTable[],
  locals: readonly HubLocalTable[] = buildHubLocalTables(),
): void {
  storage.execScript(TENANT_META_SQL);
  const fingerprint = schemaFingerprint(tables, locals);
  const stamp = storage.exec(`SELECT v FROM tenant_meta WHERE k = 'schemaStamp'`)[0]?.v;
  if (stamp === fingerprint) return;

  storage.transactionSync(() => {
    storage.execScript(
      [...HUB_OWN_SQL, ...tables.map((t) => t.createSql), ...locals.map((t) => t.createSql)].join(
        '\n',
      ),
    );
    for (const local of locals) {
      const present = existingColumns(storage, local.name);
      for (const column of local.columns) {
        if (present.has(column.name)) continue;
        storage.exec(
          `ALTER TABLE ${quote(local.name)} ADD COLUMN ${quote(column.name)} ${column.type.toUpperCase()}`,
        );
      }
    }
    for (const table of tables) {
      const present = existingColumns(storage, table.name);
      // Hubs creados antes de que existiera (§13.3): se añade sin tocar relojes.
      if (!present.has('syncDirty')) {
        storage.exec(`ALTER TABLE ${quote(table.name)} ADD COLUMN ${SYNC_DIRTY_DDL}`);
      }
      for (const column of table.dataColumns) {
        if (present.has(column.name)) continue;
        storage.exec(
          `ALTER TABLE ${quote(table.name)} ADD COLUMN ${quote(column.name)} ${column.type.toUpperCase()}` +
            (column.defaultSql ? ` DEFAULT ${column.defaultSql}` : ''),
        );
        // Las filas que ya existen: reloj BOTTOM para la columna nueva. En una
        // tabla recién creada no hay filas y no cuesta nada.
        storage.exec(
          `UPDATE ${quote(table.name)} SET "syncFields" = json_set("syncFields", ?, ?)`,
          `$.${quote(column.name)}`,
          BOTTOM,
        );
      }
    }
    for (const added of HUB_OWN_ADDED_COLUMNS) {
      if (!existingColumns(storage, added.table).has(added.column)) {
        storage.exec(
          `ALTER TABLE ${quote(added.table)} ADD COLUMN ${quote(added.column)} ${added.ddl}`,
        );
      }
    }
    storage.execScript(tables.map((t) => t.indexSql).join('\n'));
    storage.exec(
      `INSERT INTO tenant_meta (k, v) VALUES ('schemaStamp', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      fingerprint,
    );
  });
}
