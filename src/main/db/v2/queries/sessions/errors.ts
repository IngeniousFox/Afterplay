import { isStoreError, type StoreError } from '../../store';

// Contrato de errores de las consultas de sesiones para el watcher
// (CONSULTAS.md §3.2, fila "Unicidad").
//
// Los casos ESPERADOS (sesión ya abierta, cerrada, de otro PC, borrada, juego
// o emulador sin vida) son resultados: `null`, `false` o un estado. Lo único
// que puede salir lanzado de una consulta de este paquete es:
// - un `StoreError` de la puerta que la consulta no esperaba (la red de
//   seguridad de "una sesión abierta por objetivo" saltando por una carrera,
//   una fila llegada por sync con datos imposibles…);
// - un `Error` normal de los que la 1.x ya lanzaba a propósito (borrar una
//   sesión abierta, asignar una ya asignada) y que el IPC enseña al usuario;
// - un fallo de SQLite o de programación.
//
// Un `StoreError` de UNA sesión no debe tumbar el ciclo entero del watcher:
// el resto de sesiones del ciclo se tienen que abrir, cerrar y latir igual.
// Para eso está `captureStoreError`: el watcher envuelve con ella cada
// llamada por sesión. Es segura porque toda escritura de este paquete abre su
// propia `store.transaction` (un SAVEPOINT si va dentro de la del ciclo): al
// lanzar, la puerta ya ha deshecho SOLO esa operación, y la transacción de
// fuera sigue entera. Cualquier otro error se relanza: no es un caso de "una
// sesión", y el ciclo debe fallar (se reintenta en el siguiente tick).

export type Captured<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: StoreError };

/**
 * Ejecuta `fn` y convierte un `StoreError` en un resultado. Solo para
 * funciones que escriben dentro de su propia `store.transaction` (todas las
 * de este paquete).
 */
export function captureStoreError<T>(fn: () => T): Captured<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    if (!isStoreError(error)) throw error;
    return { ok: false, error };
  }
}
