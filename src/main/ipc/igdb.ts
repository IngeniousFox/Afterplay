import { ipcMain } from 'electron';
import { getCollectionGames, getGameDetails, searchGames } from '../igdb/api';
import { searchSteamStore } from '../steam/store';

export const registerIgdbHandlers = (): void => {
  ipcMain.handle('igdb:search', async (_event, query: string) => {
    return searchGames(query);
  });

  ipcMain.handle('igdb:getById', async (_event, igdbId: number) => {
    return getGameDetails(igdbId);
  });

  // Los juegos de una saga (PLAN-TO-PLAY.md §3.5) — bajo demanda al abrir la
  // ficha, con caché TTL en memoria y SIN tabla: es dato decorativo y volátil.
  // Sin conexión, esto falla y la sección simplemente no se pinta.
  ipcMain.handle('igdb:collectionGames', async (_event, collectionIds: number[]) => {
    return getCollectionGames(collectionIds);
  });

  // El respaldo del buscador: los juegos que existen en Steam y que IGDB
  // todavía no tiene (ver steam/store.ts). Vive en este mismo registro y no
  // en uno de Steam porque para el renderer es LA MISMA pregunta —"¿qué
  // juegos se llaman así?"— solo que a otro catálogo.
  ipcMain.handle('igdb:searchSteam', async (_event, query: string) => {
    return searchSteamStore(query);
  });

  // El refresco de las notas de UN juego vivía aquí y se mudó a
  // external:refreshRatings: dejó de ser cosa solo de IGDB el día que la card
  // estrenó el tile de STEAM, y un canal llamado 'igdb:' que además le
  // pregunta a la tienda de Steam es un nombre que miente.
};
