import type { SyncedTableName } from '../registry';

// Regla del dueño (clase O, AFTERPLAY-2.0.md §7.1 y "Quién puede escribir qué"
// en §7.4).
//
// Una fila O pertenece al dispositivo de su columna `deviceId`. En la 1.x
// cualquier PC adoptaba, latía y cerraba sesiones ajenas, y así se perdían
// horas jugadas (F-01 a F-03); la regla central de §10.1 es que solo el dueño
// las toca. La puerta la impone para TODAS las tablas O (sesiones,
// instalaciones de juegos y emuladores, índice de partidas): crear o parchear
// una fila ajena se rechaza salvo lo que se lista aquí.
//
// Lo que NO pasa por esta regla, a propósito:
// - Las lápidas que llegan en cascada al borrar un padre (un juego, un
//   playthrough, un emulador): borrar un juego es una decisión explícita del
//   usuario y alcanza también las sesiones e instalaciones de otros PCs
//   (§7.7: quien borra un padre marca a sus hijos). Que el dueño se entere
//   (incluso con su sesión abierta) es trabajo del watcher en la fase 4.
// - La fusión de filas que llegan por sync (fase 3): no es una escritura local.

/** Una escritura sobre una fila de otro dispositivo, para decidir si se admite. */
export type ForeignWrite =
  | {
      readonly kind: 'create';
      readonly table: SyncedTableName;
      readonly values: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'patch';
      readonly table: SyncedTableName;
      readonly row: Readonly<Record<string, unknown>>;
      /** Columnas que el parche cambia de verdad (las iguales no cuentan). */
      readonly columns: readonly string[];
    }
  | {
      readonly kind: 'remove';
      readonly table: SyncedTableName;
      readonly row: Readonly<Record<string, unknown>>;
    };

/**
 * Punto de extensión para las excepciones de la fase 4, que esta fase deja sin
 * implementar a propósito:
 * - el barrido de sesiones abandonadas (§10.5), que cierra (`endedAt`,
 *   `durationSec`, `closedBy`) sesiones de un dispositivo muerto; en la 2.0 lo
 *   hace el hub, pero si algún día lo hiciera un cliente, entraría por aquí, y
 *   además tendría que escribir con el reloj sucesor del dueño (H-3), no con
 *   el reloj local;
 * - las sesiones `timer`, cuyo dueño es el dispositivo `web` pero que
 *   cualquier dispositivo del usuario puede parar (§7.4).
 *
 * Una regla devuelve `true` para admitir la escritura. Se consultan solo
 * cuando las reglas fijas de abajo la rechazan.
 */
export type ForeignWriteRule = (write: ForeignWrite) => boolean;

/**
 * Campos de una sesión ajena que cualquier dispositivo puede escribir (§7.4):
 * la nota y el playthrough (asignar una sesión de emulador a un juego).
 */
export const SESSION_FIELDS_ANY_DEVICE: readonly string[] = ['note', 'playthroughId'];

/** ¿Admiten las reglas fijas esta escritura sobre una fila ajena? */
function allowedByDefault(write: ForeignWrite): boolean {
  if (write.table !== 'sessions') return false;
  switch (write.kind) {
    case 'create':
      return false;
    case 'patch':
      return write.columns.every((column) => SESSION_FIELDS_ANY_DEVICE.includes(column));
    case 'remove':
      // Borrar la sesión de otro solo si está cerrada: borrar una abierta le
      // quitaría al dueño la fila que está latiendo.
      return write.row.endedAt !== null && write.row.endedAt !== undefined;
  }
}

export function foreignWriteAllowed(
  write: ForeignWrite,
  extraRules: readonly ForeignWriteRule[],
): boolean {
  return allowedByDefault(write) || extraRules.some((rule) => rule(write));
}
