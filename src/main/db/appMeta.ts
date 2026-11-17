import { sql, type SQL } from 'drizzle-orm';
import type { CutoverInfo } from './readOnly';

// Lectura y escritura de app_meta según el contrato de AFTERPLAY-2.0 §19.3.1.
//
// La 1.8 LEE `cutover` y ESCRIBE solo `device_status:<machineId>`. Nunca
// `cutover` ni `hub` (los escribe la 2.0, directo contra Turso). Sin imports de
// electron: recibe la conexión por parámetro para poder probarse con una base
// de verdad (libsql) igual que con la de producción (tursodatabase-sync).

// Lo mínimo que se le pide a la conexión: las dos vías de drizzle para SQL
// crudo. Se acepta sin envolver (la de getDb() está guardada y rechazaría
// escribir en modo solo lectura, y device_status se sigue publicando).
export type MetaDb = {
  all: <T>(query: SQL) => Promise<T[]> | T[];
  run: (query: SQL) => Promise<unknown>;
};

export type DeviceStatus = {
  deviceName: string;
  appVersion: string;
  // ms; null si este PC aún no ha subido nada con éxito en esta sesión.
  lastPushOkAt: number | null;
  pendingChanges: number;
  // ms: cuándo se publicó esta foto.
  at: number;
  // `at` de la fila `cutover` que este PC tenía asumida al construir la foto
  // (null = aún no ha visto ningún corte). Campo opcional del contrato: los
  // lectores antiguos lo ignoran. Si trae valor, este PC ya estaba en solo
  // lectura cuando midió pendingChanges.
  seenCutoverAt?: number | null;
};

export const CUTOVER_KEY = 'cutover';
export const deviceStatusKey = (machineId: string): string => `device_status:${machineId}`;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// Una fila `cutover` en cualquier estado = solo lectura. Un JSON roto o con un
// estado desconocido NO lo levanta: ante la duda, no se escribe.
export const parseCutover = (raw: string): CutoverInfo => {
  let parsed: Record<string, unknown> = {};
  try {
    const candidate: unknown = JSON.parse(raw);
    if (candidate && typeof candidate === 'object') parsed = candidate as Record<string, unknown>;
  } catch {
    // se queda el objeto vacío: la fila existe y eso basta
  }
  return {
    state: parsed.state === 'done' ? 'done' : 'migrating',
    deviceId: asString(parsed.deviceId),
    deviceName: asString(parsed.deviceName),
    appVersion: asString(parsed.appVersion),
    at: asNumber(parsed.at),
  };
};

// null = no hay corte (sin fila). Si la tabla aún no existe (migración sin
// aplicar) o la lectura falla, LANZA: quien llama conserva el estado anterior
// en vez de levantar el modo por un error pasajero.
export const readCutover = async (db: MetaDb): Promise<CutoverInfo | null> => {
  const rows = await db.all<{ value: string }>(
    sql`SELECT value FROM app_meta WHERE key = ${CUTOVER_KEY} LIMIT 1`,
  );
  const row = rows[0];
  return row ? parseCutover(String(row.value)) : null;
};

// Upsert de la fila de este PC: una sola sentencia, una fila por máquina (dos
// PCs nunca se pisan entre sí porque la clave lleva el machineId).
export const publishDeviceStatus = async (
  db: MetaDb,
  machineId: string,
  status: DeviceStatus,
): Promise<void> => {
  const value = JSON.stringify({
    deviceName: status.deviceName,
    appVersion: status.appVersion,
    lastPushOkAt: status.lastPushOkAt,
    pendingChanges: status.pendingChanges,
    at: status.at,
    seenCutoverAt: status.seenCutoverAt ?? null,
  });
  await db.run(sql`
    INSERT INTO app_meta (key, value, updatedAt)
    VALUES (${deviceStatusKey(machineId)}, ${value}, ${status.at})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `);
};
