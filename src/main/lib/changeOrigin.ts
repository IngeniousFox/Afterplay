import type { DataChangeOrigin } from '../../shared/ipc/dataChanged';

// El origen de lo que se escribe AHORA. La puerta es síncrona (driver
// `node:sqlite`): el oyente de cambios corre dentro del mismo `COMMIT`, así
// que una variable de módulo fijada mientras corre la función basta, sin
// contexto asíncrono.
let currentOrigin: DataChangeOrigin = 'local';

/**
 * Ejecuta una escritura síncrona marcándola con otro origen (el watcher). Lo
 * que no pasa por aquí es 'local'.
 */
export const withChangeOrigin = <T>(origin: DataChangeOrigin, fn: () => T): T => {
  const previous = currentOrigin;
  currentOrigin = origin;
  try {
    return fn();
  } finally {
    currentOrigin = previous;
  }
};

export const currentChangeOrigin = (): DataChangeOrigin => currentOrigin;
