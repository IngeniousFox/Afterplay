import { eq } from 'drizzle-orm';
import { devices } from '../../schema';
import type { QueryContext } from '../common';

// El valor propio de la instalación publicado en `devices` (§12.6, F-24).
//
// Cada instalación guarda en machine-saves.json un valor aleatorio suyo y lo
// publica en la fila de su dispositivo. Si al mirar el publicado no es el
// suyo, otra instalación usa el mismo id (la carpeta de datos se copió a otro
// PC) y se bloquean la poda y los backups hasta que el usuario lo resuelva.
//
// Solo se publica cuando no hay ninguno: sobrescribir el de otra instalación
// haría que cada una pisara a la otra y ninguna se diera cuenta.

/** El valor publicado para el dispositivo de este contexto, o null. */
export function readPublishedInstallNonce(ctx: QueryContext): string | null {
  return (
    ctx.db
      .select({ nonce: devices.installNonce })
      .from(devices)
      .where(eq(devices.id, ctx.deviceId))
      .get()?.nonce ?? null
  );
}

export type InstallNonceCheck =
  /** Publicado ahora: no había ninguno. */
  | 'published'
  /** El publicado es el nuestro. */
  | 'same'
  /** El publicado es de OTRA instalación con el mismo id. */
  | 'conflict'
  /** No existe la fila de este dispositivo (no debería: la crea el arranque). */
  | 'no-device';

/**
 * Compara el valor publicado con `nonce` y, si no hay ninguno, publica este.
 * Nunca pisa uno distinto: eso lo decide el usuario (`forcePublishInstallNonce`).
 */
export function checkInstallNonce(ctx: QueryContext, nonce: string): InstallNonceCheck {
  return ctx.store.transaction(() => {
    const row = ctx.db
      .select({ nonce: devices.installNonce })
      .from(devices)
      .where(eq(devices.id, ctx.deviceId))
      .get();
    if (!row) return 'no-device';
    if (row.nonce === null) {
      ctx.store.patch('devices', ctx.deviceId, { installNonce: nonce });
      return 'published';
    }
    return row.nonce === nonce ? 'same' : 'conflict';
  });
}

/**
 * "Este PC es el original" (§12.6): publica `nonce` aunque haya otro. La otra
 * instalación verá que el publicado ya no es el suyo y se bloqueará ella.
 */
export function forcePublishInstallNonce(ctx: QueryContext, nonce: string): void {
  ctx.store.patch('devices', ctx.deviceId, { installNonce: nonce });
}
