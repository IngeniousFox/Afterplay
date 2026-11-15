import { asc } from 'drizzle-orm';
import type { DeviceInfo } from '../../../../../shared/devices';
import { devices } from '../../schema';
import { alive } from '../../store';
import type { QueryContext } from '../common/context';

// Los dispositivos vivos que conoce esta base (AFTERPLAY-2.0.md §10.8, §11.4).
//
// Es lo que necesita la interfaz para decir "Playing on PC-A" o "Installed on
// PC-A, PC-B". Solo el id, el nombre y el sistema, más si es este PC: la
// versión, la carpeta de usuario y demás son hechos del dispositivo que nadie
// más necesita ver. Un dispositivo con lápida no sale.
//
// Un dispositivo revocado SÍ sale: sus sesiones y sus instalaciones siguen
// ahí y tienen que poder nombrarse.

/** Los dispositivos vivos, este PC primero y luego por orden de creación. */
export function getDevices(ctx: QueryContext): DeviceInfo[] {
  const rows = ctx.db
    .select({ id: devices.id, name: devices.name, os: devices.os })
    .from(devices)
    .where(alive(devices))
    .orderBy(asc(devices.syncCreated), asc(devices.id))
    .all();
  const mapped = rows.map((row): DeviceInfo => ({ ...row, isThisDevice: row.id === ctx.deviceId }));
  return [
    ...mapped.filter((device) => device.isThisDevice),
    ...mapped.filter((d) => !d.isThisDevice),
  ];
}
