import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLInputValue } from 'node:sqlite';
import {
  openLocalDatabase,
  type LocalDatabase,
  type OpenLocalDatabaseOptions,
} from '../connection';
import type { WriteStore } from '../store';

// Utilidades de los tests de la base 2.0. Todo con datos inventados.

export const MIGRATIONS_FOLDER = 'drizzle-v2';

/** El dispositivo local y otro PC del mismo usuario. */
export const LOCAL = '0194c2f0-aaaa-7000-8000-00000000000a';
export const OTHER = '0194c2f0-bbbb-7000-8000-00000000000b';

/** Instante fijo de los tests: 2025-11-13. */
export const T0 = 1_763_020_800_000;

export interface FakeWall {
  readonly wall: () => number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function fakeWall(start = T0): FakeWall {
  let now = start;
  return {
    wall: () => now,
    advance: (ms) => {
      now += ms;
    },
    set: (ms) => {
      now = ms;
    },
  };
}

export function openTestDb(
  options: Partial<Omit<OpenLocalDatabaseOptions, 'migrationsFolder'>> = {},
): LocalDatabase {
  return openLocalDatabase({
    ...options,
    path: options.path ?? ':memory:',
    deviceId: options.deviceId ?? LOCAL,
    migrationsFolder: MIGRATIONS_FOLDER,
    wall: options.wall ?? fakeWall().wall,
  });
}

/**
 * Carpeta temporal propia que se borra al terminar (cerrar antes la base).
 * Usa la familia `afterplay-test-` de scripts/lib/testTempDirectories.ts: si
 * una pasada se interrumpe, la limpieza de `pretest` recoge los restos.
 */
export function tempDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'afterplay-test-'));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export type RawRow = Record<string, SQLInputValue | null>;

/** La fila tal como está en SQLite, sin pasar por Drizzle. */
export function rawRow(local: LocalDatabase, table: string, id: string): RawRow | undefined {
  const row = local.db.$client.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
  return row ? ({ ...row } as RawRow) : undefined;
}

export function count(local: LocalDatabase, table: string, where = '1 = 1'): number {
  const row = local.db.$client.prepare(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`).get();
  return Number(row?.n);
}

/**
 * Inserta una fila "llegada por sync" saltándose la puerta: la de otro
 * dispositivo, o una con un reloj concreto. Solo en tests; la barrera de §8.6
 * no mira `__tests__`.
 */
export function insertSynced(
  local: LocalDatabase,
  table: string,
  values: Record<string, SQLInputValue | null>,
  clock = '1763020800000-0000-zzzzzz',
): void {
  const row: Record<string, SQLInputValue | null> = {
    syncCreated: clock,
    syncUpdated: clock,
    syncFields: '{}',
    syncDirty: 0,
    ...values,
  };
  const columns = Object.keys(row);
  local.db.$client
    .prepare(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .run(...columns.map((c) => row[c]));
}

/** Limpia `syncDirty` como haría el motor tras una subida aceptada. */
export function markClean(local: LocalDatabase, table: string): void {
  local.db.$client.prepare(`UPDATE "${table}" SET syncDirty = 0`).run();
}

/** Los dos dispositivos, más un juego con un playthrough. Devuelve sus ids. */
export function seedBasics(store: WriteStore): { gameId: string; playthroughId: string } {
  store.create('devices', {
    id: LOCAL,
    name: 'PC-A',
    kind: 'desktop',
    os: 'windows',
    firstSeenAt: new Date(T0),
  });
  store.create('devices', {
    id: OTHER,
    name: 'PC-B',
    kind: 'desktop',
    os: 'windows',
    firstSeenAt: new Date(T0),
  });
  const { id: gameId } = store.create('games', {
    title: 'Celeste',
    igdbId: 26226,
    addedAt: new Date(T0),
  });
  const { id: playthroughId } = store.create('playthroughs', {
    gameId,
    playedPlatform: 'PC',
    origin: 'Steam',
  });
  return { gameId, playthroughId };
}

/**
 * ¿Es un error de SQLite con este texto? Drizzle envuelve el error del driver
 * en `DrizzleQueryError` y deja el original en `cause`.
 */
export const sqliteError =
  (pattern: RegExp) =>
  (error: unknown): boolean => {
    const cause = (error as { cause?: unknown }).cause;
    const message = cause instanceof Error ? cause.message : (error as Error).message;
    return pattern.test(message);
  };
