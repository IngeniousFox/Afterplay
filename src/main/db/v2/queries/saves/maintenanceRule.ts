import type { ForeignWrite, ForeignWriteRule } from '../../store';

// Excepción a la regla del dueño para el mantenimiento del bucket (decisión
// R-13 de CONSULTAS.md §5.0; AFTERPLAY-2.0.md §12.5).
//
// `save_backups` es de clase O: cada fila es del dispositivo que subió el zip,
// y la puerta rechaza crear o borrar filas de otro (`not_owner`). Pero hay cuatro
// rutas de mantenimiento que, por su naturaleza, tocan filas ajenas:
//
// - recuperar el índice desde el bucket (`recoverIndexFromCloud`): crea las
//   filas de los zips que subieron otros PCs;
// - borrar del bucket todo lo de una máquina (`deleteMachineFromCloud`): pone
//   lápida a sus filas;
// - borrar una versión ajena desde la ficha (`saves:deleteBackup`): pone
//   lápida a su fila y a la de sus diferenciales (el borrado cruzado de §12.5:
//   el PC dueño borra su zip local al ver la lápida, antes de su siguiente
//   backup);
// - limpiar a mano la carpeta de un juego borrado (`purgeSaveFolder`, §12.7):
//   pone lápida a las copias de esa carpeta, de todos los PCs.
//
// La regla es MÍNIMA a propósito. No basta con "save_backups admite filas
// ajenas": eso abriría la puerta a cualquier consulta. Así que solo admite una
// escritura cuando está activo el ámbito de una de esas rutas, que solo
// abren las consultas de esta carpeta (`withSaveMaintenance`), y aun entonces:
// - solo en `save_backups`;
// - solo la operación de esa ruta (`create` al recuperar, `remove` al borrar);
//   nunca `patch`: una fila ajena no se edita, se recrea o se borra;
// - solo filas de los dispositivos que la ruta declara (la máquina que se
//   borra, el dueño de la versión que se borra, las máquinas del bucket).
//
// El ámbito es una variable del módulo y no un parámetro porque la regla la
// registra quien abre la base (`openLocalDatabase({ foreignWriteRules })`) y
// solo recibe la escritura. Es seguro porque todo es síncrono (§8.9): entre
// abrir y cerrar el ámbito no se ejecuta otro código, y si la función devuelve
// una promesa se rechaza (lo que hiciera tras el `await` quedaría fuera).

/** Las rutas de mantenimiento del bucket. */
export type SaveMaintenanceRoute =
  'recover_index' | 'delete_machine' | 'delete_backup' | 'purge_folder';

const KIND_OF_ROUTE: Readonly<Record<SaveMaintenanceRoute, 'create' | 'remove'>> = {
  recover_index: 'create',
  delete_machine: 'remove',
  delete_backup: 'remove',
  purge_folder: 'remove',
};

interface MaintenanceScope {
  readonly route: SaveMaintenanceRoute;
  readonly devices: ReadonlySet<string>;
}

let active: MaintenanceScope | null = null;

/**
 * La `ForeignWriteRule` de R-13. Hay que registrarla al abrir la base
 * (`foreignWriteRules: [saveMaintenanceForeignWriteRule]`); eso lo hace el
 * cambio final (P9). Sin registrarla, las rutas de mantenimiento fallan
 * con `not_owner` sobre filas ajenas y todo lo demás sigue igual.
 */
export const saveMaintenanceForeignWriteRule: ForeignWriteRule = (write: ForeignWrite) => {
  if (active === null || write.table !== 'save_backups') return false;
  if (write.kind !== KIND_OF_ROUTE[active.route]) return false;
  const owner = write.kind === 'create' ? write.values.deviceId : write.row.deviceId;
  return typeof owner === 'string' && active.devices.has(owner);
};

/**
 * Ejecuta `fn` (síncrona) con el ámbito de una ruta de mantenimiento abierto
 * para las filas de `devices`. Solo para las consultas de esta carpeta.
 */
export function withSaveMaintenance<T>(
  route: SaveMaintenanceRoute,
  devices: Iterable<string>,
  fn: () => T,
): T {
  // No se anida: dos rutas a la vez sumarían sus permisos sin que nadie lo
  // haya decidido.
  if (active !== null) {
    throw new Error(`mantenimiento de partidas: ya hay una ruta abierta (${active.route})`);
  }
  active = { route, devices: new Set(devices) };
  try {
    const result = fn();
    if (
      result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      throw new Error('mantenimiento de partidas: la función tiene que ser síncrona');
    }
    return result;
  } finally {
    active = null;
  }
}
