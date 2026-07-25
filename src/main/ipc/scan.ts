import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import { getConfigValue, setConfigValue } from '../config/store';
import { getSaveGames } from '../db/queries/saves/getSaveGames';
import { searchGames } from '../igdb/api';

import type { ScanCandidate, ScannedFolder } from '../scan/contracts';
import { buildSearchQueries, findInLibrary } from '../scan/folderTitle';
import { scanFolders } from '../scan/folders';

// Modo "Scan your folders" de Add Game: se leen las carpetas que el usuario
// señale (un nivel, sin recursividad) y cada subcarpeta se cruza con IGDB por
// su nombre. NO añade nada: propone, y el usuario elige de la lista.

// Cuántas búsquedas de IGDB van a la vez. Su límite es de 4 peticiones por
// segundo y CADA búsqueda nuestra son dos (relevancia + comodín, ver
// igdb/api.ts), así que de dos en dos vamos justo por debajo sin necesitar
// un limitador de verdad.
const SEARCH_CONCURRENCY = 2;

// Tope de carpetas que se cruzan con IGDB de una tacada. Señalar por error la
// raíz de un disco no puede convertirse en mil búsquedas.
const MAX_CANDIDATES = 300;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const matchFolder = async (
  folder: ScannedFolder,
  libraryTitles: string[],
): Promise<ScanCandidate> => {
  // Cadena de consultas, de la más fiel al nombre de la carpeta a la más
  // recortada (ver folderTitle.ts). Se para en la PRIMERA que devuelva algo:
  // una carpeta limpia no paga el coste ni el riesgo de las variantes.
  let matches: Awaited<ReturnType<typeof searchGames>> = [];
  for (const query of buildSearchQueries(folder.folderName)) {
    // Un fallo de búsqueda NO es "sin resultados": con 16 carpetas seguidas
    // es casi siempre el rate limit de IGDB (4 peticiones/seg), y tragárselo
    // pintaba juegos perfectamente conocidos como "no match". Se reintenta
    // una vez tras un respiro antes de darlo por vacío.
    let result = await searchGames(query).catch(() => null);
    if (result === null) {
      await sleep(1500);
      result = await searchGames(query).catch(() => []);
    }
    if (result.length > 0) {
      matches = result;
      break;
    }
  }

  // "Ya está en la biblioteca" se comprueba con el juego propuesto Y con el
  // nombre de la carpeta, y por SIMILITUD (ver findInLibrary). La comparación
  // exacta fallaba justo donde más molesta: teniendo "Horizon Forbidden West"
  // añadido, la carpeta "…Complete Edition" salía como juego nuevo.
  const proposed = matches[0];
  const owned = findInLibrary(
    [...(proposed ? [proposed.title] : []), folder.folderName],
    libraryTitles,
  );

  return { ...folder, matches: matches.slice(0, 6), alreadyInLibrary: owned !== null };
};

export const registerScanHandlers = (): void => {
  // Las carpetas elegidas se recuerdan: escanear es algo que se repite cada
  // vez que instalas algo, y volver a señalarlas cada vez sería el peaje que
  // haría que nadie usara esto dos veces.
  ipcMain.handle('scan:getFolders', () => getConfigValue('scanFolders'));

  ipcMain.handle('scan:setFolders', (_event, folders: string[]) => {
    setConfigValue('scanFolders', folders);
    return folders;
  });

  handleDb('scan:run', async (_event, folders: string[]): Promise<ScanCandidate[]> => {
    const found = (await scanFolders(folders)).slice(0, MAX_CANDIDATES);

    // Los títulos que ya están en la biblioteca, tal cual: findInLibrary se
    // encarga de normalizarlos y limpiarlos.
    const games = await getSaveGames();
    const libraryTitles = games.map((game) => game.title);

    const candidates: ScanCandidate[] = [];
    for (let index = 0; index < found.length; index += SEARCH_CONCURRENCY) {
      const batch = found.slice(index, index + SEARCH_CONCURRENCY);
      candidates.push(
        ...(await Promise.all(batch.map((folder) => matchFolder(folder, libraryTitles)))),
      );
      // Respiro entre lotes: cada búsqueda son DOS peticiones (relevancia +
      // comodín), así que un lote de 2 ya toca el límite de 4/seg de IGDB.
      // Sin esta pausa, los lotes encadenados lo superaban y las búsquedas
      // caían con 429.
      if (index + SEARCH_CONCURRENCY < found.length) await sleep(600);
    }
    return candidates;
  });
};
