import { appCtx } from '../db/v2/appDb';
import { selectGamesToEnrich } from '../db/v2/queries/external';
import { appJobClaims } from '../sync/jobClaims';
import { createEnrichRunner, type EnrichSummary } from './enrichPending';
import { refreshGameEverything } from './refreshGame';
import type { GameId } from '../../shared/entityIds';

// El completado de juegos pendientes de ESTA app: la orquestación de
// `enrichPending.ts` cableada con la base, las concesiones del hub y
// `refreshGameEverything` (el "actualízalo todo" de la ficha, que es el mismo
// código de refresco que usan las pasadas de arranque, aplicado a un juego).

const runner = createEnrichRunner({
  claims: appJobClaims(),
  select: (limit) => selectGamesToEnrich(appCtx(), limit),
  canRun: () => Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET),
  enrich: async (gameId) => {
    const result = await refreshGameEverything(gameId as GameId);
    if (result === null) return 'el juego ya no existe';
    // IGDB es la fuente de la que depende lo demás: si no contestó, el juego
    // sigue sin completar y la concesión lo anota como fallo.
    return result.igdb === 'failed' ? 'IGDB no contesto' : null;
  },
  log: (message) => console.log(`[enrich] ${message}`),
});

/**
 * Completa los juegos que llegaron por sync sin comprobaciones externas. Se
 * llama tras cada ciclo que baja filas de `games` y tras el primer ciclo del
 * arranque. Nunca lanza: es trabajo de fondo.
 */
export const runEnrichPending = async (): Promise<EnrichSummary | null> => {
  try {
    return await runner.run();
  } catch (error) {
    console.warn('[enrich] fallo completando juegos pendientes (se reintentara):', error);
    return null;
  }
};
