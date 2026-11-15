import { lstatSync, rmSync } from 'node:fs';
import { toSlashes } from './paths';

// Restauración exacta (AFTERPLAY-2.0.md §12.7, F-22; D-20).
//
// ludusavi restaura escribiendo los archivos de la copia y no borra nada: un
// archivo de partida que la copia no tiene (una ranura nueva, un autoguardado
// posterior) sigue ahí después de restaurar, y algunos juegos lo leen como si
// fuera parte de la partida. Marcando la casilla, se borran esos archivos.
//
// Qué se puede borrar, y es la decisión que hace esto seguro: SOLO archivos de
// la lista que ludusavi detecta como partida de ese juego (`current`), nunca
// "lo que haya en la carpeta". En la pasada real esa lista es la de la copia
// previa que se acaba de hacer (§10bis.3, regla 1), así que todo lo que se
// borra está guardado en esa copia y la restauración se puede deshacer desde
// la lista de versiones. Nunca se borran carpetas.

const key = (path: string): string => toSlashes(path).toLowerCase();

/** Los archivos de `current` que la restauración no ha escrito (los que sobran). */
export function extraSaveFiles(current: readonly string[], restored: readonly string[]): string[] {
  const written = new Set(restored.map(key));
  const seen = new Set<string>();
  const extras: string[] = [];
  for (const path of current) {
    const normalized = key(path);
    if (written.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    extras.push(toSlashes(path));
  }
  return extras.sort();
}

/**
 * Borra los archivos indicados. Un archivo que ya no está cuenta como borrado;
 * uno que no es un archivo normal (carpeta, enlace) no se toca y va a
 * `failed`, igual que uno bloqueado. Nunca lanza: lo importante (la partida
 * restaurada) ya está hecho, y lo que no se pudo borrar se avisa.
 */
export function removeSaveFiles(paths: readonly string[]): { removed: string[]; failed: string[] } {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const path of paths) {
    try {
      let stats;
      try {
        stats = lstatSync(path);
      } catch {
        removed.push(path);
        continue;
      }
      if (!stats.isFile()) {
        failed.push(path);
        continue;
      }
      rmSync(path, { force: true });
      removed.push(path);
    } catch (error) {
      console.warn(`[saves] restauración exacta: no se pudo borrar ${path}:`, error);
      failed.push(path);
    }
  }
  return { removed, failed };
}
