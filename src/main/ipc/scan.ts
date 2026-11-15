import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import { getConfigValue, setConfigValue } from '../config/store';
import { appCtx } from '../db/v2/appDb';
import { getOwnedGames } from '../db/v2/queries/library';
import { queueAchievementsRefreshForGame } from '../steam/backfill';

import { getCachedEntries, getLastScanAt } from '../scan/cache';
import type { ScannedFolder, ScanReport } from '../scan/contracts';
import type { GameId } from '../../shared/entityIds';
import { byFolderName } from '../scan/folders';
import { findInLibrary } from '../scan/folderTitle';
import { decideLink, linkInstall } from '../scan/linkInstalls';
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

  // Tu colección entera —biblioteca y plan— de la consulta PROPIA del
  // escaneo (getOwnedGames, ver su porqué allí). Los títulos van tal cual:
  // findInLibrary se encarga de normalizarlos y limpiarlos.
  const owned = getOwnedGames(appCtx());
  const library = owned.filter((game) => !game.planned);
  const libraryTitles = library.map((game) => game.title);
  const planned = owned.filter((game) => game.planned);
  const plannedTitles = planned.map((game) => game.title);

  const linkedGameIds: GameId[] = [];
  const candidates = entries
    .map((entry) => {
      // "Ya lo tienes" se comprueba con el juego propuesto Y con el nombre
      // de la carpeta, y por SIMILITUD (ver findInLibrary). La comparación
      // exacta fallaba justo donde más molesta: teniendo "Horizon Forbidden
      // West" añadido, la carpeta "…Complete Edition" salía como juego nuevo.
      const proposed = entry.matches[0];
      const titles = [...(proposed ? [proposed.title] : []), entry.folder.folderName];
      const inLibrary = findInLibrary(titles, libraryTitles);

      // Y contra el plan, con dos varas de medir en orden de confianza:
      // identidad de catálogo del PROPUESTO (solo del propuesto — que un
      // planeado aparezca entre las fichas ALTERNATIVAS de una carpeta no
      // convierte la carpeta en ese juego), y si no, similitud de nombre.
      //
      // findInLibrary UNA vez por carpeta, fuera de todo bucle: no es barata
      // (limpia y compara contra la lista entera, construyendo sus regex al
      // vuelo) — llamarla por cada juego planeado congelaba el main con un
      // plan grande. Bug real: la app entera colgada al abrir el escaneo.
      const plannedTitle = findInLibrary(titles, plannedTitles);
      const plannedGame =
        planned.find((game) => game.igdbId === proposed?.igdbId) ??
        (plannedTitle !== null ? planned.find((game) => game.title === plannedTitle) : undefined);

      // Vinculación (§11.2): un juego que YA está en la biblioteca pero sin
      // instalación en este PC se vincula a esta carpeta. Se decide aquí, en
      // el main, y no en el renderer: el renderer solo enseña el resultado.
      // Los que ya tienen instalación aquí no se tocan.
      let linkedOnThisPc = false;
      if (inLibrary !== null) {
        const decision = decideLink(entry.folder, titles, proposed?.igdbId ?? null, library);
        if (decision.action === 'linked') {
          linkedOnThisPc = true;
        } else if (decision.action === 'link' && !linkedGameIds.includes(decision.game.id)) {
          // Una sola carpeta por juego y pasada: si dos carpetas casan con el
          // mismo juego, gana la primera y la segunda no la pisa.
          linkedOnThisPc = linkInstall(appCtx(), decision.game, entry.folder);
          if (linkedOnThisPc) linkedGameIds.push(decision.game.id);
        }
      }

      return {
        ...entry.folder,
        matches: entry.matches,
        alreadyInLibrary: inLibrary !== null,
        linkedOnThisPc,
        plannedGameId: plannedGame?.id ?? null,
      };
    })
    .sort(byFolderName);

  // Los logros de emuladores de Steam leen la carpeta de la instalación local
  // (§11.4): como al editar la ruta, se piden de nuevo fuera del paso.
  for (const gameId of linkedGameIds) void queueAchievementsRefreshForGame(gameId);

  return { candidates, scannedAt: getLastScanAt(roots), linkedGameIds };
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
