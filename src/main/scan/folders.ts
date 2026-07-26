import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getDirectorySize } from '../lib/directorySize';
import { guessExecutables } from './executable';
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
//
// El escaneo está partido en dos mitades muy desiguales a propósito, y esa
// separación es lo que hace posible vigilar las carpetas en segundo plano
// (ver watcher.ts): LISTAR es un readdir por raíz —milisegundos, se puede
// repetir cada pocos minutos sin que se note— y DESCRIBIR recorre la carpeta
// entera dos veces (tamaño + .exe), que es lo que cuesta de verdad. Así el
// vigilante puede preguntar "¿hay algo nuevo?" constantemente y pagar el
// precio caro solo por las carpetas que de verdad son nuevas.

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

// Una carpeta candidata SIN mirar dentro: lo que se sabe de ella con solo
// haberla listado.
export type FolderRef = { folderName: string; path: string; root: string };

// El listado dice también QUÉ raíces no se pudieron leer. No es decorativo:
// el vigilante interpreta "carpeta cacheada que no está en el listado" como
// "juego desinstalado" y la borra de la caché — si un disco desenchufado no
// se distinguiera de uno vacío, sacarlo un rato costaría reescanear y volver
// a preguntar a IGDB por TODA su biblioteca al enchufarlo.
export type FolderListing = { folders: FolderRef[]; unreadableRoots: string[] };

// La mitad barata. Un readdir por raíz y nada más — ni tamaños ni .exe.
export const listGameFolders = async (roots: string[]): Promise<FolderListing> => {
  const found: FolderRef[] = [];
  const unreadableRoots: string[] = [];
  // Una misma carpeta puede llegar dos veces (elegida dos veces, o una raíz
  // dentro de otra): se queda con la primera.
  const seen = new Set<string>();

  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      // Raíz que ya no existe (disco externo desenchufado, carpeta borrada):
      // se salta, no se tumba el escaneo de las demás.
      console.warn(`[scan] no se pudo leer ${root}:`, error);
      unreadableRoots.push(root);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || isIgnored(entry.name)) continue;

      const path = join(root, entry.name);
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({ folderName: entry.name, path, root: basename(root) || root });
    }
  }

  return { folders: found, unreadableRoots };
};

// La mitad cara: mirar DENTRO de una carpeta. Tamaño y ejecutables en
// paralelo porque los dos recorren el mismo árbol.
export const describeFolder = async (ref: FolderRef): Promise<ScannedFolder> => {
  const [sizeBytes, executables] = await Promise.all([
    getDirectorySize(ref.path).catch(() => 0),
    guessExecutables(ref.path, ref.folderName).catch((): string[] => []),
  ]);

  return {
    ...ref,
    sizeBytes,
    executablePath: executables[0] ?? null,
    executableCandidates: executables,
  };
};

// Cuántas carpetas se miran POR DENTRO a la vez. Describir ya es paralelo de
// puertas adentro (getDirectorySize hace Promise.all por nivel), así que
// esto multiplica: soltar las 300 de una biblioteca entera de golpe eran
// cientos de recorridos de árbol simultáneos peleándose por el disco — en
// un HDD, la máquina de rodillas. De cuatro en cuatro el total apenas
// cambia y el disco respira.
const DESCRIBE_CONCURRENCY = 4;

export const describeFolders = async (refs: FolderRef[]): Promise<ScannedFolder[]> => {
  const described: ScannedFolder[] = [];
  for (let index = 0; index < refs.length; index += DESCRIBE_CONCURRENCY) {
    const batch = refs.slice(index, index + DESCRIBE_CONCURRENCY);
    described.push(...(await Promise.all(batch.map((ref) => describeFolder(ref)))));
  }
  return described;
};

// Alfabético e insensible a mayúsculas, como el resto de listas de la app.
export const byFolderName = (a: { folderName: string }, b: { folderName: string }): number =>
  a.folderName.localeCompare(b.folderName, undefined, { sensitivity: 'base' });

export const scanFolders = async (roots: string[]): Promise<ScannedFolder[]> => {
  const { folders } = await listGameFolders(roots);
  const described = await describeFolders(folders);
  return described.sort(byFolderName);
};
