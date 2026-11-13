import { eq } from 'drizzle-orm';
import { devices, type DeviceOs, type DeviceRow } from '../../schema';
import type { QueryContext } from './context';

// La fila de `devices` de este PC (CONSULTAS.md §3.1).
//
// Hace falta antes de cualquier otra escritura: es la clave foránea de
// `game_installs`, `emulator_installs`, `sessions` y `save_backups`, así que
// sin ella no se puede guardar una ruta ni abrir una sesión. El arranque la
// asegura justo después de abrir la base.
//
// Nada de `os` ni de Electron aquí: el nombre, la carpeta de usuario y las
// versiones llegan por parámetro, para que se pueda probar sin máquina real.

/** Cada cuánto, como mucho, se refresca `lastSeenAt` (§7.4: ruido de sync). */
export const LAST_SEEN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ThisDeviceInfo {
  /** `os.hostname()`. Solo se escribe al crear: después es editable por el usuario. */
  readonly name: string;
  /** `os.homedir()`: genera los redirects al restaurar partidas en otro PC. */
  readonly home: string;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly now: Date;
  /** Por defecto `'windows'`: la 2.0 solo publica Windows (D-14). */
  readonly os?: DeviceOs;
}

export interface EnsureThisDeviceResult {
  readonly outcome: 'created' | 'updated' | 'unchanged';
  readonly device: DeviceRow;
}

/**
 * Crea la fila de este PC si no existe. Si existe, actualiza lo que haya
 * cambiado de `appVersion`, `schemaVersion` y `home`, y `lastSeenAt` como mucho
 * una vez cada 24 h. Idempotente: arrancar dos veces el mismo día con la misma
 * versión no escribe nada.
 */
export function ensureThisDevice(ctx: QueryContext, info: ThisDeviceInfo): EnsureThisDeviceResult {
  return ctx.store.transaction(() => {
    const existing = readDevice(ctx);
    if (!existing) {
      ctx.store.create('devices', {
        id: ctx.deviceId,
        name: info.name,
        kind: 'desktop',
        os: info.os ?? 'windows',
        home: info.home,
        appVersion: info.appVersion,
        schemaVersion: info.schemaVersion,
        firstSeenAt: info.now,
        lastSeenAt: info.now,
      });
      return { outcome: 'created', device: mustReadDevice(ctx) };
    }

    const lastSeen = existing.lastSeenAt?.getTime() ?? null;
    const seenLongAgo = lastSeen === null || info.now.getTime() - lastSeen >= LAST_SEEN_INTERVAL_MS;
    // `home` no lo nombra §3.1, pero es un hecho de ESTE PC que solo él
    // escribe, y uno viejo daría redirects equivocados al restaurar partidas
    // aquí desde otro PC (MAPA-1X nota 7). `name` NO: es editable.
    const { changed } = ctx.store.patch('devices', ctx.deviceId, {
      appVersion: info.appVersion,
      schemaVersion: info.schemaVersion,
      home: info.home,
      ...(seenLongAgo ? { lastSeenAt: info.now } : {}),
    });
    return {
      outcome: changed.length > 0 ? 'updated' : 'unchanged',
      device: mustReadDevice(ctx),
    };
  });
}

function readDevice(ctx: QueryContext): DeviceRow | undefined {
  return ctx.db.select().from(devices).where(eq(devices.id, ctx.deviceId)).get();
}

function mustReadDevice(ctx: QueryContext): DeviceRow {
  const row = readDevice(ctx);
  if (!row) throw new Error(`devices: falta la fila de este dispositivo (${ctx.deviceId})`);
  return row;
}
