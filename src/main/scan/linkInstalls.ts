import { updateGame, type QueryContext } from '../db/v2/queries/common';
import type { GameId } from '../../shared/entityIds';
import type { ScannedFolder } from './contracts';
import { isExactLibraryTitle } from './folderTitle';

// VINCULACIÓN POR ESCANEO (AFTERPLAY-2.0.md §11.2).
//
// Un juego que ya está en la biblioteca (porque lo añadió otro PC y llegó por
// sync) y que este PC no tiene instalado se quedaba descartado como "ya en la
// biblioteca": Play apagado y el watcher sin objetivo (§11.1) aunque el juego
// estuviera en una carpeta escaneada. Ahora el escaneo, cuando encuentra su
// carpeta, crea la instalación de ESTE PC con el ejecutable que ha deducido.
//
// Reglas:
//  · Solo si el juego NO tiene instalación aquí. Si ya la tiene, no se toca
//    (la eligió una persona, o un escaneo anterior).
//  · Solo con el ejecutable encontrado: sin él no hay nada defendible que
//    escribir.
//  · Solo con identidad CONFIABLE: la misma ficha de IGDB, o el mismo título
//    exacto tras limpiar edición y ruido. El "se parece mucho" de la lista
//    ("ya lo tienes") no basta para escribir una ruta que se sincroniza.
//  · Solo juegos de la biblioteca. Los del Plan siguen su propio camino
//    (promoverlos rellena la carpeta y el .exe).
//  · Se escribe lo que escribe el editor: `updateGame` con la ruta, la
//    carpeta y el tamaño, o sea la fila `game_installs` de ESTE dispositivo.
//    Las de los demás no se tocan.

/** Lo que se necesita saber de un juego de la biblioteca para decidir. */
export type LinkableGame = {
  readonly id: GameId;
  readonly title: string;
  readonly igdbId: number | null;
  readonly hasLocalInstall: boolean;
  readonly localInstallDirectory: string | null;
};

export type LinkDecision =
  /** Hay que crear la instalación de este PC en ese juego. */
  | { readonly action: 'link'; readonly game: LinkableGame }
  /** Ya está vinculado a esta carpeta (lo hizo un escaneo anterior). */
  | { readonly action: 'linked'; readonly game: LinkableGame }
  /** No se hace nada. */
  | { readonly action: 'none' };

// Mismo criterio que la caché del escaneo: sin distinguir mayúsculas ni el
// sentido de las barras, y sin barra final.
const pathKey = (path: string): string =>
  path.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');

const NONE: LinkDecision = { action: 'none' };

/**
 * Decide qué hacer con una carpeta escaneada que ya está en la biblioteca.
 *
 * @param titles   los nombres con los que se buscó en la biblioteca (el título
 *                 propuesto por IGDB y el nombre de la carpeta).
 * @param igdbId   la ficha propuesta por IGDB para la carpeta, si hay.
 * @param library  los juegos de la biblioteca (no los del Plan).
 */
export function decideLink(
  folder: Pick<ScannedFolder, 'path' | 'executablePath'>,
  titles: string[],
  igdbId: number | null,
  library: readonly LinkableGame[],
): LinkDecision {
  const sameGame = (game: LinkableGame): boolean =>
    (igdbId !== null && game.igdbId === igdbId) || isExactLibraryTitle(titles, game.title);
  const candidates = library.filter(sameGame);
  if (candidates.length === 0) return NONE;

  // Ya vinculado a esta carpeta: nada que escribir, y la pantalla lo cuenta.
  const folderKey = pathKey(folder.path);
  const linked = candidates.find(
    (game) =>
      game.localInstallDirectory !== null && pathKey(game.localInstallDirectory) === folderKey,
  );
  if (linked) return { action: 'linked', game: linked };

  // Con varios juegos del mismo nombre y alguno ya instalado aquí, no se
  // adivina a cuál pertenece la carpeta.
  if (candidates.some((game) => game.hasLocalInstall)) return NONE;
  if (folder.executablePath === null) return NONE;
  // Varios candidatos sin instalar (dos juegos con el mismo título exacto):
  // solo se vincula si la ficha de IGDB señala a UNO. Si no, tampoco se
  // adivina: escribir la ruta en el juego equivocado se sincroniza.
  if (candidates.length > 1) {
    const byIgdb = candidates.filter((game) => igdbId !== null && game.igdbId === igdbId);
    return byIgdb.length === 1 ? { action: 'link', game: byIgdb[0] } : NONE;
  }
  return { action: 'link', game: candidates[0] };
}

/**
 * Crea la instalación de este PC. Devuelve false si el juego ya no existe
 * (borrado entre la lectura y la escritura).
 */
export function linkInstall(ctx: QueryContext, game: LinkableGame, folder: ScannedFolder): boolean {
  if (folder.executablePath === null) return false;
  const updated = updateGame(ctx, game.id, {
    executablePath: folder.executablePath,
    installDirectory: folder.path,
    installSizeBytes: folder.sizeBytes,
  });
  return updated !== null;
}
