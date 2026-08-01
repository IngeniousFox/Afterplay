import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import { getConfigValue, setConfigValue } from '../config/store';
import { getSaveGames } from '../db/queries/saves/getSaveGames';

import { getCachedEntries, getLastScanAt } from '../scan/cache';
import type { ScannedFolder, ScanReport } from '../scan/contracts';
import { byFolderName } from '../scan/folders';
import { findInLibrary } from '../scan/folderTitle';
import { getScanWatcher } from '../scan/watcher';

// Modo "Scan your folders" de Add Game: se leen las carpetas que el usuario
// señale (un nivel, sin recursividad) y cada subcarpeta se cruza con IGDB por
// su nombre. NO añade nada: propone, y el usuario elige de la lista.
//
// El trabajo de verdad lo hace el vigilante (scan/watcher.ts), que mantiene
// la caché al día por su cuenta. Aquí solo quedan dos cosas: LEER esa caché
// (instantáneo) y FORZAR un ciclo completo (el botón de Scan).

// La caché guarda lo que es un hecho del disco y del catálogo, que no cambia
// solo. "¿Ya lo tengo en la biblioteca?" NO es de esos: depende de la BD,
// que además sincroniza desde el otro PC. Se recalcula en cada lectura —
// cachearlo dejaría juegos ya añadidos apareciendo como nuevos.
const buildReport = async (): Promise<ScanReport> => {
  const roots = getConfigValue('scanFolders');
  const entries = getCachedEntries(roots);

  // Los títulos que ya están en la biblioteca, tal cual: findInLibrary se
  // encarga de normalizarlos y limpiarlos.
  const games = await getSaveGames();
  const libraryTitles = games.map((game) => game.title);

  const candidates = entries
    .map((entry) => {
      // "Ya está en la biblioteca" se comprueba con el juego propuesto Y con
      // el nombre de la carpeta, y por SIMILITUD (ver findInLibrary). La
      // comparación exacta fallaba justo donde más molesta: teniendo
      // "Horizon Forbidden West" añadido, la carpeta "…Complete Edition"
      // salía como juego nuevo.
      const proposed = entry.matches[0];
      const owned = findInLibrary(
        [...(proposed ? [proposed.title] : []), entry.folder.folderName],
        libraryTitles,
      );

      return { ...entry.folder, matches: entry.matches, alreadyInLibrary: owned !== null };
    })
    .sort(byFolderName);

  return { candidates, scannedAt: getLastScanAt(roots) };
};

export const registerScanHandlers = (): void => {
  // Las carpetas elegidas se recuerdan: escanear es algo que se repite cada
  // vez que instalas algo, y volver a señalarlas cada vez sería el peaje que
  // haría que nadie usara esto dos veces.
  ipcMain.handle('scan:getFolders', () => getConfigValue('scanFolders'));

  ipcMain.handle('scan:setFolders', (_event, folders: string[]) => {
    setConfigValue('scanFolders', folders);
    // Reenganchar la vigilancia EN CALIENTE. Señalar una carpeta nueva y que
    // no pasara nada hasta el siguiente barrido sería justo el momento en el
    // que esto parece que no funciona.
    getScanWatcher()?.rootsChanged();
    return folders;
  });

  // Lo que se pinta al abrir la pantalla: sale entero de la caché, así que
  // es instantáneo y no gasta ni disco ni cuota de IGDB.
  handleDb('scan:cached', (): Promise<ScanReport> => buildReport());

  // El botón. Rehace todo ignorando la caché — la vía de escape para cuando
  // algo no cuadra (un juego movido a mano, un tamaño que se quedó viejo).
  handleDb('scan:run', async (): Promise<ScanReport> => {
    await getScanWatcher()?.force();
    return buildReport();
  });

  // El autorrelleno del formulario ("Find in my game folders"): dado el
  // juego elegido en Add Game, ¿cuál de las carpetas ya escaneadas es la
  // suya? Se responde ENTERO desde la caché del vigilante — cero disco, cero
  // IGDB. Dos varas de medir, en orden de confianza:
  //   1º identidad de catálogo — la carpeta se cruzó con IGDB al escanearla,
  //      y si alguno de sus matches es EXACTAMENTE este igdbId, es él;
  //   2º similitud de nombre — la misma maquinaria (findInLibrary: limpiar
  //      edición/ruido + Dice ≥ 0.82) que ya decide "ya está en la
  //      biblioteca", aquí con la pregunta del revés.
  ipcMain.handle(
    'scan:matchTitle',
    (_event, query: { title: string; igdbId: number | null }): ScannedFolder | null => {
      const entries = getCachedEntries(getConfigValue('scanFolders'));

      if (query.igdbId !== null) {
        const byId = entries.find((entry) =>
          entry.matches.some((match) => match.igdbId === query.igdbId),
        );
        if (byId) return byId.folder;
      }

      const byName = entries.find(
        (entry) => findInLibrary([entry.folder.folderName], [query.title]) !== null,
      );
      return byName?.folder ?? null;
    },
  );
};
