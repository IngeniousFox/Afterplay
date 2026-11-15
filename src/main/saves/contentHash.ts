import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

// Huella del contenido de una partida (AFTERPLAY-2.0.md §12.2).
//
// Identifica un ESTADO de la partida con independencia de la máquina y de la
// hora: dos backups con la misma huella son la misma partida, vengan del PC
// que vengan. Es la pieza sobre la que se apoyan el linaje (§12.3) y el estado
// de la ficha (§12.4).
//
// Entrada: los archivos de la versión, cada uno con su ruta TOKENIZADA y el
// hash que ludusavi ya calcula y deja en mapping.yaml (SHA-1 del contenido),
// más el hash del registro si la versión lo trae. Se ordena, se serializa de
// forma canónica y se le aplica SHA-256.
//
// Tokenizar. La misma partida vive en `C:/Users/Ana/AppData/...` en un PC y en
// `C:/Users/Jon/AppData/...` en otro. La ruta se reescribe respecto a la
// carpeta de usuario DE LA MÁQUINA QUE HIZO EL BACKUP (`<home>/AppData/...`),
// que es lo que hace comparable un backup de A con el disco de B. Solo se usa
// ese token, a propósito: AppData, Documentos o "Saved Games" cuelgan de la
// carpeta de usuario en una instalación normal de Windows, y cualquier token
// que dependa del entorno de ESTE proceso (como los de `paths.ts`) daría otra
// huella al recalcularla desde otro PC. Una partida que vive fuera de la
// carpeta de usuario (D:/Juegos/...) solo coincide si la ruta es la misma en
// los dos PCs; si no, la huella difiere y la ficha lo muestra como
// informativo, nunca afirma nada falso (R-12).
//
// Mayúsculas. Windows no distingue mayúsculas en rutas, así que la ruta
// canónica va en minúsculas (D-14: la 2.0 es solo Windows; con Linux habrá que
// revisarlo).
//
// Sin huella. Si falta el hash de un solo archivo no hay huella (null): una
// huella parcial podría decir "iguales" de dos partidas que no lo son.

/** Versión del formato canónico. Cambiarlo cambia todas las huellas. */
const CANONICAL_VERSION = 1;

/** Un archivo de la partida: su ruta tal cual y su hash (SHA-1 en hex), si se conoce. */
export interface ContentFile {
  readonly path: string;
  readonly hash: string | null | undefined;
}

export interface ContentHashInput {
  readonly files: readonly ContentFile[];
  /** Hash del registro de la versión; null si no toca el registro. */
  readonly registryHash: string | null;
  /** Carpeta de usuario de la máquina en la que viven esas rutas ('' si no se sabe). */
  readonly home: string;
}

const slashes = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * La ruta canónica de un archivo: barras `/`, minúsculas, sin el prefijo
 * `\\?\` de rutas largas y con la carpeta de usuario como `<home>`.
 */
export function canonicalSavePath(path: string, home: string): string {
  let canonical = slashes(path).toLowerCase();
  if (canonical.startsWith('//?/')) canonical = canonical.slice(4);
  let base = slashes(home).toLowerCase();
  if (base.startsWith('//?/')) base = base.slice(4);
  if (base.length > 0 && (canonical === base || canonical.startsWith(`${base}/`))) {
    canonical = `<home>${canonical.slice(base.length)}`;
  }
  return canonical;
}

const normalizeHash = (hash: string | null | undefined): string | null => {
  if (typeof hash !== 'string') return null;
  const trimmed = hash.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * La huella de un conjunto de archivos (y registro), o null si falta algún
 * hash. Una partida sin archivos ni registro tampoco tiene huella: ludusavi no
 * hace backups vacíos, así que no hay nada con lo que compararla.
 */
export function computeContentHash(input: ContentHashInput): string | null {
  if (input.files.length === 0 && input.registryHash === null) return null;
  const files: [string, string][] = [];
  for (const file of input.files) {
    const hash = normalizeHash(file.hash);
    if (hash === null) return null;
    files.push([canonicalSavePath(file.path, input.home), hash]);
  }
  files.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  const registry = input.registryHash === null ? null : normalizeHash(input.registryHash);
  if (input.registryHash !== null && registry === null) return null;
  const canonical = JSON.stringify({ v: CANONICAL_VERSION, files, registry });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * SHA-1 del contenido de un archivo del disco, el mismo algoritmo con el que
 * ludusavi rellena mapping.yaml. Por streaming: una partida grande no pasa
 * entera por el heap.
 */
export function sha1OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * La huella de lo que hay AHORA en el disco (`L` en §12.4), a partir de la
 * lista de archivos que ludusavi detecta para el juego. null si algún archivo
 * no se deja leer (bloqueado, borrado entre el listado y la lectura): sin
 * todos los hashes no hay huella.
 */
export async function hashLocalSave(
  paths: readonly string[],
  home: string,
): Promise<string | null> {
  const files: ContentFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, hash: await sha1OfFile(path) });
    } catch {
      return null;
    }
  }
  return computeContentHash({ files, registryHash: null, home });
}
