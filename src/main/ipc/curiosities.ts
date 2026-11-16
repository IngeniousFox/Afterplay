import { handle } from './contractHandlers';
import { getCuriositiesStatus, runCuriositiesBackfill } from '../curiosities/backfill';
import { appCtx } from '../db/v2/appDb';
import { getAllCuriosities } from '../db/v2/queries/loop';

export const registerCuriositiesHandlers = (): void => {
  handle('curiosities:getAll', async () => {
    return getAllCuriosities(appCtx());
  });

  handle('curiosities:getStatus', async () => {
    return getCuriositiesStatus();
  });

  // Encola los pendientes y devuelve: la generación va de uno en uno por la
  // cola (curiosities/queue.ts) y su progreso viaja por el canal de eventos
  // 'curiosities:activity', no por esta respuesta — una pasada de 300 juegos
  // tarda muchos minutos y ningún invoke debe quedarse colgado tanto tiempo.
  // Se devuelve la promesa igualmente porque lo que SÍ hace aquí (leer la
  // lista de pendientes) puede fallar, y ese error debe llegar al renderer.
  handle('curiosities:runBackfill', () => runCuriositiesBackfill());
};
