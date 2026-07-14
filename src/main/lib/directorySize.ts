import { readdir, stat } from 'fs/promises';
import { join } from 'path';

// Recorrido recursivo, un nivel a la vez pero en paralelo dentro de cada
// carpeta (Promise.all) — suficiente para no bloquear minutos en librerías
// de juegos con decenas de miles de ficheros, sin montar nada más elaborado
// (worker threads, colas...) para un cálculo que se hace una vez al elegir
// la carpeta, no en cada carga del detalle.
export const getDirectorySize = async (dirPath: string): Promise<number> => {
  const entries = await readdir(dirPath, { withFileTypes: true });

  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) return getDirectorySize(fullPath);
      if (entry.isFile()) return (await stat(fullPath)).size;
      return 0;
    }),
  );

  return sizes.reduce((sum, size) => sum + size, 0);
};
