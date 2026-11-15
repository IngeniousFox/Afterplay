import type { ForeignWrite, ForeignWriteRule } from '../../store';

// Excepción a la regla del dueño para parar un cronómetro desde cualquier PC
// (AFTERPLAY-2.0.md §7.4 y §13.3).
//
// Un cronómetro es una sesión con `startedBy = 'timer'` cuyo dueño es el
// dispositivo `web` (el móvil, que no tiene proceso que vigilar). Ningún PC
// es "el dueño", así que si solo el dueño pudiera cerrarla, un cronómetro
// olvidado quedaría abierto hasta que lo barriera el hub. La regla deja que
// cualquier dispositivo de la persona lo pare, y NADA más:
// - solo `patch` sobre `sessions` (no se crea ni se borra con esta regla);
// - solo si la fila es un cronómetro y sigue abierta (`endedAt` nulo): un
//   cronómetro ya cerrado no se reescribe;
// - solo las columnas del cierre: `endedAt`, `durationSec` y `closedBy`.
//
// Quién puede usarla (solo una persona que pulsa Stop, `closedBy: 'user'`; los
// cierres automáticos de un cronómetro ajeno no se permiten, los rancios los
// cierra el hub) lo decide la consulta `closeOwnSession`, no esta regla: la
// regla solo ve la fila y las columnas.

/** Columnas que un dispositivo ajeno puede escribir al parar un cronómetro. */
export const TIMER_CLOSE_COLUMNS: readonly string[] = ['endedAt', 'durationSec', 'closedBy'];

export const timerForeignWriteRule: ForeignWriteRule = (write: ForeignWrite) => {
  if (write.kind !== 'patch' || write.table !== 'sessions') return false;
  if (write.row.startedBy !== 'timer') return false;
  if (write.row.endedAt !== null) return false;
  return write.columns.every((column) => TIMER_CLOSE_COLUMNS.includes(column));
};
