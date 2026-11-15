import { and, asc, eq } from 'drizzle-orm';
import { UNKNOWN_DEVICE_NAME, type InstalledOn } from '../../../../../shared/devices';
import { devices, gameInstalls } from '../../schema';
import { alive } from '../../store';
import { liveGameInstall } from '../common/alive';
import type { QueryContext } from '../common/context';

// Las instalaciones de un juego (AFTERPLAY-2.0.md §11.4).
//
// Dos lecturas con dueños distintos, a propósito en el mismo fichero:
//  · `getLocalInstall` — la ruta de ESTE PC, que solo resuelve el main para
//    lanzar el juego. La ruta cruda ya no cruza el IPC en el sentido
//    renderer → main: el renderer manda el `gameId` y el main busca aquí.
//  · `getInstalledOn` — en qué dispositivos está instalado, SIN rutas. Es lo
//    único de las instalaciones ajenas que sale del main (las rutas de otro PC
//    no se interpretan fuera de su dispositivo, D-14).

export interface LocalInstall {
  readonly executablePath: string | null;
  readonly installDirectory: string | null;
}

/** La instalación viva de este PC, o null si el juego no está instalado aquí. */
export function getLocalInstall(ctx: QueryContext, gameId: string): LocalInstall | null {
  const row = ctx.db
    .select({
      executablePath: gameInstalls.executablePath,
      installDirectory: gameInstalls.installDirectory,
    })
    .from(gameInstalls)
    .where(
      and(
        eq(gameInstalls.gameId, gameId),
        eq(gameInstalls.deviceId, ctx.deviceId),
        liveGameInstall(),
      ),
    )
    .get();
  return row ?? null;
}

/**
 * Los dispositivos con una instalación viva del juego, este PC primero. Una
 * instalación cuyo dispositivo no se conoce (sync a medias) se nombra "another
 * PC". Una instalación sin ejecutable ni carpeta no cuenta como instalación.
 */
export function getInstalledOn(ctx: QueryContext, gameId: string): InstalledOn[] {
  const rows = ctx.db
    .select({
      deviceId: gameInstalls.deviceId,
      executablePath: gameInstalls.executablePath,
      installDirectory: gameInstalls.installDirectory,
      deviceName: devices.name,
    })
    .from(gameInstalls)
    .leftJoin(devices, and(eq(devices.id, gameInstalls.deviceId), alive(devices)))
    .where(and(eq(gameInstalls.gameId, gameId), liveGameInstall()))
    .orderBy(asc(gameInstalls.syncCreated), asc(gameInstalls.id))
    .all();
  const installs = rows
    .filter((row) => row.executablePath !== null || row.installDirectory !== null)
    .map((row): InstalledOn => ({
      deviceId: row.deviceId,
      deviceName: row.deviceName?.trim() || UNKNOWN_DEVICE_NAME,
      isThisDevice: row.deviceId === ctx.deviceId,
    }));
  return [...installs.filter((i) => i.isThisDevice), ...installs.filter((i) => !i.isThisDevice)];
}
