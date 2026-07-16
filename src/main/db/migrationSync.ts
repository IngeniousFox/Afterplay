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

type LocalMigration = {
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
const readLocalMigrations = (migrationsFolder: string): LocalMigration[] => {
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

// Aplica contra `client` (conexión PLANA a Turso, sin sync/CDC de por medio)
// las migraciones de `migrationsFolder` que todavía no estén registradas en
// su __drizzle_migrations — mismo criterio "por nombre" que usa drizzle
// (ver getMigrationsToRun). Cada migración pendiente corre en su propia
// transacción remota; si una falla, se revierte y se para ahí (no se
// intentan las siguientes con el remoto en un estado a medias).
export const pushPendingMigrations = async (
  client: Client,
  migrationsFolder: string,
): Promise<PushResult> => {
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

  const pending = readLocalMigrations(migrationsFolder).filter(
    (migration) => !appliedNames.has(migration.name),
  );

  for (const migration of pending) {
    // client.migrate() (a diferencia de client.transaction()) hace el
    // PRAGMA foreign_keys=off ANTES del BEGIN, no dentro — igual que
    // necesita esta migración para poder recrear `sessions` sin que la
    // referencia desde iterations.startSessionId/endSessionId lo bloquee.
    // Un PRAGMA metido dentro de la transacción es un no-op en SQLite/
    // libSQL (foreign_keys solo se puede tocar sin BEGIN/SAVEPOINT
    // pendiente) — con client.transaction() el remoto sí lo respetaba a
    // rajatabla y el DROP TABLE sessions moría con FOREIGN KEY constraint
    // failed, aunque en local (más laxo con esto) no diera problema.
    const statements: InStatement[] = migration.statements
      .map((statement) => statement.trim())
      .filter(Boolean);
    statements.push({
      sql: `INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at, name, applied_at) VALUES (?, ?, ?, ?)`,
      args: [migration.hash, migration.folderMillis, migration.name, new Date().toISOString()],
    });

    try {
      await client.migrate(statements);
    } catch (error) {
      throw new Error(`fallo aplicando ${migration.name} contra Turso: ${String(error)}`);
    }
  }

  return { applied: pending.map((migration) => migration.name) };
};
