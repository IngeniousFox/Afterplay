import {
  isDeviceShortId,
  isReservedDeviceShortId,
  type HybridClock,
} from '../../shared/sync/clock';
import type { EnrollResponse } from '../../shared/sync/protocol';
import type { LocalDb } from '../db/v2/store';

// `local_sync_state` (§7.6): la única fila (id = 1) con lo que el motor
// recuerda entre ciclos y entre arranques. Es una tabla LOCAL (no se
// sincroniza), así que se lee y escribe directamente, sin la puerta de §8.6.
//
// Se trabaja con SQL crudo y no con Drizzle para que las fechas sean siempre
// milisegundos (`timestamp_ms`) sin conversiones, igual que el resto del motor.

export interface SyncState {
  pullCursor: number;
  lastPushAt: number | null;
  lastPullAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  lastErrorCode: string | null;
  protocolVersion: number | null;
  shortDeviceId: string | null;
  hubId: string | null;
  hubEpoch: number | null;
  lastSyncedSchemaVersion: number | null;
  blockedMinSchema: number | null;
}

const COLUMNS: readonly (keyof SyncState)[] = [
  'pullCursor',
  'lastPushAt',
  'lastPullAt',
  'lastError',
  'lastErrorAt',
  'lastErrorCode',
  'protocolVersion',
  'shortDeviceId',
  'hubId',
  'hubEpoch',
  'lastSyncedSchemaVersion',
  'blockedMinSchema',
];

/** Asegura que la fila única existe (`openLocalDatabase` ya la crea; esto es defensa). */
export function ensureSyncState(db: LocalDb): void {
  db.$client
    .prepare('INSERT INTO "local_sync_state" ("id") VALUES (1) ON CONFLICT("id") DO NOTHING')
    .run();
}

export function readSyncState(db: LocalDb): SyncState {
  ensureSyncState(db);
  const row = db.$client.prepare('SELECT * FROM "local_sync_state" WHERE "id" = 1').get();
  const out = {} as Record<string, unknown>;
  for (const column of COLUMNS) out[column] = row?.[column] ?? null;
  out.pullCursor = Number(row?.pullCursor ?? 0);
  return out as unknown as SyncState;
}

/** Escribe solo las claves indicadas. */
export function patchSyncState(db: LocalDb, patch: Partial<SyncState>): void {
  const keys = Object.keys(patch) as (keyof SyncState)[];
  if (keys.length === 0) return;
  ensureSyncState(db);
  for (const key of keys) {
    if (!COLUMNS.includes(key)) throw new Error(`local_sync_state: columna desconocida ${key}`);
  }
  db.$client
    .prepare(
      `UPDATE "local_sync_state" SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE "id" = 1`,
    )
    .run(...keys.map((k) => patch[k] ?? null));
}

export interface EnrollmentOutcome {
  /** El id corto anterior (sorteado en local). */
  previousShortDeviceId: string | null;
  shortDeviceId: string;
}

/**
 * Tras emparejar (§9.3): el id corto que asigna el hub sustituye al sorteado
 * en local. También deja el motor como "nunca sincronizado con este hub":
 * sin identidad de hub ni cursor, de modo que el primer ciclo lo sube todo
 * (§8.4) y baja desde cero, y quita un bloqueo o error de un hub anterior.
 *
 * El reloj en marcha (compartido con la puerta de escritura) cambia de id en
 * caliente con `setDev`: lo escrito desde ahora firma con el id del hub y no
 * hace falta reiniciar. Los relojes ya escritos conservan el id sorteado.
 */
export function applyEnrollment(
  db: LocalDb,
  response: Pick<EnrollResponse, 'shortDeviceId'>,
  clock: Pick<HybridClock, 'setDev'>,
): EnrollmentOutcome {
  const { shortDeviceId } = response;
  if (!isDeviceShortId(shortDeviceId) || isReservedDeviceShortId(shortDeviceId)) {
    throw new Error(`el hub asignó un id corto inválido: ${String(shortDeviceId)}`);
  }
  const previous = readSyncState(db).shortDeviceId;
  patchSyncState(db, {
    shortDeviceId,
    hubId: null,
    hubEpoch: null,
    pullCursor: 0,
    blockedMinSchema: null,
    lastError: null,
    lastErrorAt: null,
    lastErrorCode: null,
  });
  clock.setDev(shortDeviceId);
  return {
    previousShortDeviceId: previous,
    shortDeviceId,
  };
}
