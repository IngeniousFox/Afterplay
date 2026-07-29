import { ipcMain } from 'electron';
import { handleDb } from './dbHandle';
import { getCuriositiesStatus, runCuriositiesBackfill } from '../curiosities/backfill';
import { getAllCuriosities } from '../db/queries/curiosities/getAllCuriosities';

export const registerCuriositiesHandlers = (): void => {
  handleDb('curiosities:getAll', async () => {
    return getAllCuriosities();
  });

  handleDb('curiosities:getStatus', async () => {
    return getCuriositiesStatus();
  });

  // Encola los pendientes y devuelve: la generación va de uno en uno por la
  // cola (curiosities/queue.ts) y su progreso viaja por el canal de eventos
  // 'curiosities:activity', no por esta respuesta — una pasada de 300 juegos
  // tarda muchos minutos y ningún invoke debe quedarse colgado tanto tiempo.
  // Se devuelve la promesa igualmente porque lo que SÍ hace aquí (leer la
  // lista de pendientes) puede fallar, y ese error debe llegar al renderer.
  ipcMain.handle('curiosities:runBackfill', () => runCuriositiesBackfill());
};
