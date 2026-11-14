import { appCtx } from '../db/v2/appDb';
import { dismissRadarGame, listRadarGames } from '../db/v2/queries/loop';
import type { RadarGame } from '../../shared/types';
import { handleDb } from './dbHandle';

// El radar de secuelas (PLAN-TO-PLAY.md §4) — lo que la pasada semanal ha
// descubierto, para pintarlo en "On the horizon" del Plan.
export const registerRadarHandlers = (): void => {
  handleDb('radar:list', async (): Promise<RadarGame[]> => listRadarGames(appCtx()));

  handleDb('radar:dismiss', async (_event, igdbId: number) => {
    dismissRadarGame(appCtx(), igdbId);
    return true;
  });

  // No hay ningún canal para forzar la pasada, y no es un olvido: el radar es
  // lo único automático de todo el documento y así debe seguir (§4).
  //
  // Aquí vivía un ipcMain.handle('radar:runNow') presentado como "la vía de
  // escape para probarlo sin esperar siete días". No lo era: con
  // contextIsolation la página solo ve lo que expone `api` por contextBridge,
  // y ese canal era el único de toda la app sin pareja en preload/ — así que
  // nadie, ni desde DevTools, podía invocarlo. Un canal muerto documentado
  // como si funcionara es peor que no tenerlo.
  //
  // Para forzarla de verdad: poner radarLastRunAt en userData/config.json a
  // cualquier fecha vieja distinta de cero (un 1 vale) — el tic horario ve
  // que hace más de una semana y la lanza.
  //
  // A CERO NO, aunque sea el valor tentador: cero es el que la app usa para
  // "esto no ha corrido nunca", y runRadarPass lo lee como que esta es la
  // primera pasada de la vida — la que siembra en SILENCIO (§4.4). Forzarla
  // así la deja muda: descubre las secuelas, las guarda y no avisa de
  // ninguna, que es justo lo contrario de lo que se quiere al probarla.
};
