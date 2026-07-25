import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getDirectorySize } from '../lib/directorySize';
import { guessExecutable } from './executable';
import type { ScannedFolder } from './contracts';

// Escaneo de "mi carpeta de juegos": cada SUBCARPETA de primer nivel es un
// juego candidato, y su nombre es el título con el que buscar en IGDB.
//
// SIN recursividad aquí, a propósito y por petición explícita: bajar niveles
// convertiría `Juegos/Serie/Parte 1` y `Juegos/Juego/Binaries` en candidatos
// indistinguibles, y llenaría la lista de basura. Un nivel es exactamente la
// convención que usa la gente para organizar juegos. (El .exe SÍ se busca en
// profundidad — ver executable.ts: ahí la recursividad es imprescindible
// porque casi ningún juego deja su binario en la raíz.)

// Carpetas de primer nivel que claramente no son un juego.
const IGNORED = new Set([
  'workshop',
  'downloads',
  'temp',
  'tmp',
  'redist',
  'commonredist',
  '_commonredist',
  'steamvr',
  'steamworks shared',
  'soundtrack',
  'soundtracks',
  'ost',
  'saves',
  'savegames',
  'backups',
  'mods',
  'tools',
  'crack',
  '_crack',
]);

const isIgnored = (name: string): boolean =>
  name.startsWith('.') || name.startsWith('$') || IGNORED.has(name.toLowerCase());

export const scanFolders = async (roots: string[]): Promise<ScannedFolder[]> => {
  const found: ScannedFolder[] = [];
  // Una misma carpeta puede llegar dos veces (elegida dos veces, o una raíz
  // dentro de otra): se queda con la primera.
  const seen = new Set<string>();

  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      console.warn(`[scan] no se pudo leer ${root}:`, error);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnored(entry.name)) continue;

      const path = join(root, entry.name);
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Tamaño y ejecutable en paralelo: los dos recorren el mismo árbol y
      // son lo caro de esta operación.
      const [sizeBytes, executable] = await Promise.all([
        getDirectorySize(path).catch(() => 0),
        guessExecutable(path, entry.name).catch(() => null),
      ]);

      found.push({
        folderName: entry.name,
        path,
        root: basename(root) || root,
        sizeBytes,
        executablePath: executable?.path ?? null,
        executableAlternatives: executable?.alternatives ?? 0,
      });
    }
  }

  // Alfabético e insensible a mayúsculas, como el resto de listas de la app.
  return found.sort((a, b) =>
    a.folderName.localeCompare(b.folderName, undefined, { sensitivity: 'base' }),
  );
};
