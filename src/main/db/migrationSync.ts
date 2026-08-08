import type { Client, InStatement } from '@libsql/client';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Lógica compartida por scripts/push-migrations-to-turso.ts (manual) y por
// runMigrations() en index.ts (automático al arrancar la app) — un solo
// sitio que sabe replicar drizzle-orm/migrator.js y migrator.utils.js contra
// una conexión directa a Turso, sin pasar por @tursodatabase/sync. Sin
// imports de electron a propósito: así el script standalone puede
// importarlo fuera del proceso principal.

const MIGRATIONS_TABLE = '__drizzle_migrations';

// La firma de una migración que RECONSTRUYE una tabla: drizzle-kit siempre la
// escribe creando una tabla puente con este prefijo. Es lo que busca la
// guarda de runMigrations para negarse a ejecutarla en local (ver allí).
export const REBUILD_MARKER = '__new_';

export type LocalMigration = {
  name: string;
  hash: string;
  folderMillis: number;
  statements: string[];
};

// Idéntico a formatToMillis en node_modules/drizzle-orm/migrator.utils.js.
const formatToMillis = (dateStr: string): number => {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(4, 6)) - 1;
  const day = Number(dateStr.slice(6, 8));
  const hour = Number(dateStr.slice(8, 10));
  const minute = Number(dateStr.slice(10, 12));
  const second = Number(dateStr.slice(12, 14));
  return Date.UTC(year, month, day, hour, minute, second);
};

// Idéntico a readMigrationFiles en node_modules/drizzle-orm/migrator.js —
// mismo hash y mismo split, para que el registro que dejamos en Turso sea
// indistinguible del que dejaría drizzle-kit corriendo en local.
export const readLocalMigrations = (migrationsFolder: string): LocalMigration[] => {
  const folders = readdirSync(migrationsFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(migrationsFolder, name, 'migration.sql')))
    .sort((a, b) => a.localeCompare(b));

  return folders.map((name) => {
    const raw = readFileSync(join(migrationsFolder, name, 'migration.sql'), 'utf8');
    return {
      name,
      hash: createHash('sha256').update(raw).digest('hex'),
      folderMillis: formatToMillis(name.slice(0, 14)),
      statements: raw.split('--> statement-breakpoint'),
    };
  });
};

export type PushResult = { applied: string[] };

// FASE 1 — solo LEER qué falta. Barata y sin efectos: es la única parte que
// el arranque puede permitirse correr con límite de tiempo (una base de Turso
// dormida tarda en despertar, y el arranque no puede esperarla para siempre).
export const listRemotePending = async (
  client: Client,
  migrationsFolder: string,
): Promise<LocalMigration[]> => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric,
      name text,
      applied_at TEXT
    )
  `);

  const { rows: appliedRows } = await client.execute(`SELECT name FROM ${MIGRATIONS_TABLE}`);
  const appliedNames = new Set(appliedRows.map((row) => row.name as string));

  return readLocalMigrations(migrationsFolder).filter(
    (migration) => !appliedNames.has(migration.name),
  );
};

// FASE 2 — aplicar lo pendiente. NUNCA se corre con timeout, nunca en una
// carrera, nunca con un close() esperando en un finally compartido: matar la
// conexión con DDL en vuelo fue una de las tres piezas del destrozo del
// 7-ago-2026 (withTimeout no cancela nada — el lote seguía ejecutándose en el
// servidor mientras el finally le cerraba la conexión por debajo).
//
// Y las otras dos piezas, aprendidas del cadáver que dejó producción, son las
// que justifican el resto de esta función:
//
//  · El lote remoto NO es fail-stop: producción quedó con el RENAME sin
//    ejecutar pero con la migración registrada — el registro era la última
//    sentencia del mismo lote y corrió igual. Por eso el registro ya NO viaja
//    en el lote: se escribe después, y solo si la verificación pasa. Una
//    migración a medias debe quedar SIN registrar, gritando en cada arranque,
//    no dada por buena en silencio.
//  · La VERIFICACIÓN: si tras aplicar queda una tabla puente __new_* en
//    sqlite_master, la migración se quedó a medias. Se lanza error con
//    instrucciones, sin registrar.
//
// client.migrate() (y no client.transaction()) sigue siendo el vehículo: hace
// el PRAGMA foreign_keys=off ANTES del BEGIN, único sitio donde SQLite lo
// acepta — con transaction() el DROP de la migración de sessions moría con
// FOREIGN KEY constraint failed.
//
// NOTA (8-ago-2026): aquí se leía que "el PRAGMA tampoco es de fiar en el
// servidor, el CASCADE que vació las tablas hijas lo demostró". Era FALSO y se
// corrige por si alguien lo da por bueno: ese CASCADE no salió de aquí. Venía
// de que la misma migración se aplicaba DOS veces —esta, directa, y otra en
// local que el CDC subía— y era la segunda la que destrozaba lo que esta había
// dejado bien (ver migrateWithoutCapture en db/index.ts). Comprobado contra la
// base de test con datos de producción: reconstrucción completa de `games` por
// esta vía, cero filas perdidas, integrity_check ok. Este camino siempre
// estuvo bien. La verificación se queda igualmente — no por desconfianza del
// PRAGMA, sino porque una migración a medias no debe registrarse jamás.
export const applyRemotePending = async (
  client: Client,
  migrations: LocalMigration[],
): Promise<PushResult> => {
  for (const migration of migrations) {
    const statements: InStatement[] = migration.statements
      .map((statement) => statement.trim())
      .filter(Boolean);

    try {
      await client.migrate(statements);
    } catch (error) {
      throw new Error(`fallo aplicando ${migration.name} contra Turso: ${String(error)}`);
    }

    const { rows: leftovers } = await client.execute(
      String.raw`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '\_\_new\_%' ESCAPE '\'`,
    );
    if (leftovers.length > 0) {
      throw new Error(
        `${migration.name} se quedó A MEDIAS en Turso: quedan ${leftovers
          .map((row) => String(row.name))
          .join(', ')}. NO se registra — revisa el estado remoto a mano antes de nada.`,
      );
    }

    await client.execute({
      sql: `INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)`,
      args: [migration.hash, migration.folderMillis, migration.name, new Date().toISOString()],
    });
  }

  return { applied: migrations.map((migration) => migration.name) };
};

// Las dos fases seguidas, para quien no necesita separarlas (el script
// manual). El arranque de la app NO usa esta: separa las fases para poder
// poner límite de tiempo a la lectura sin ponérselo jamás a la aplicación.
export const pushPendingMigrations = async (
  client: Client,
  migrationsFolder: string,
): Promise<PushResult> =>
  applyRemotePending(client, await listRemotePending(client, migrationsFolder));
