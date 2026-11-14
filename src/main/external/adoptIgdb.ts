import { appCtx } from '../db/v2/appDb';
import {
  applyIgdbAdoption,
  failed,
  selectAdoptionCandidates,
  type AdoptionCandidate,
  type AdoptionLookup,
} from '../db/v2/queries/external';
import { getGameDetails, getIgdbIdsBySteamAppIds } from '../igdb/api';
import type { GameId } from '../../shared/entityIds';

// CUANDO IGDB POR FIN TIENE EL JUEGO — el cambio de fuente.
//
// Un juego dado de alta solo con Steam (porque IGDB no lo tenía: ver
// steam/store.ts) vive con datos provisionales — carátula, hero, sinopsis,
// géneros y fecha salidos de la tienda. Son un apaño digno mientras dura,
// pero no es lo que la app quiere enseñar: sin id de IGDB no hay sagas, ni
// tráiler, ni capturas, ni notas de crítica, ni radar de secuelas.
//
// IGDB acaba metiendo casi todo. Medido sobre la biblioteca real (8-ago-2026):
// el 97% de los juegos tiene ficha con vídeo allí. Así que la pregunta no es
// SI llegará, es cuándo — y cuando llega hay que cambiarse de fuente entera,
// no quedarse con una mezcla de las dos.
//
// De ahí esta función, que hacen los TRES refrescos (el de la ficha, el de
// Ajustes/Plan y el radar semanal): buscar el id por appid, y si aparece,
// re-enriquecer el juego DESDE CERO con lo de IGDB.
//
// ── Qué se pisa y qué no ────────────────────────────────────────────────────
//
// Se pisa todo lo que vino de Steam: título, carátula, hero, sinopsis,
// géneros, estudio, editora, plataformas y fecha. No es un merge — mezclar
// dejaría un juego con la carátula de una fuente y la sinopsis de otra, que
// es justo la inconsistencia que este cambio existe para quitar.
//
// NO se toca nada tuyo: notas, sesiones, estados, gastos, la ruta del
// ejecutable, la carpeta, si es emulado… nada de eso sale de ninguna tienda.
//
// El aviso honesto: si le habías cambiado la carátula a mano a un juego de
// solo-Steam, esto se la lleva. Es el precio de "cámbialo todo a IGDB", y se
// paga UNA vez por juego — a partir de ahí el juego es de IGDB como cualquier
// otro y su carátula vuelve a ser cosa tuya.

// ¿Qué juegos son candidatos? Los que no tienen igdbId pero sí appid: sin
// appid no hay por dónde preguntar (un juego de consola sin ficha en IGDB se
// queda como está, y no hay nada que hacer al respecto).
export type { AdoptionCandidate };

export const findAdoptionCandidates = (): AdoptionCandidate[] => selectAdoptionCandidates(appCtx());

// El detalle de IGDB de un igdbId, listo para la escritura 2.0
// (queries/external/adoptIgdb.ts), que relee el juego y decide qué se pisa:
// la caché de IGDB en game_metadata, y los overrides de carátula, banner y
// textos se anulan (R-01). Un fallo de red se apunta como tal y no borra nada.
const lookupIgdb = async (igdbId: number): Promise<AdoptionLookup> => {
  try {
    return await getGameDetails(igdbId);
  } catch (error) {
    return failed(error);
  }
};

// La adopción de UN juego (la ficha): mira si IGDB ya lo tiene y, si sí, lo
// cambia de fuente. Devuelve el igdbId adoptado, o null si IGDB sigue sin
// tenerlo (o el juego cambió mientras tanto).
export const adoptIgdbForGame = async (
  gameId: GameId,
  steamAppId: number,
): Promise<number | null> => {
  try {
    const igdbId = (await getIgdbIdsBySteamAppIds([steamAppId])).get(steamAppId);
    const candidate = { gameId, steamAppId };
    if (igdbId === undefined) {
      applyIgdbAdoption(appCtx(), candidate, null);
      return null;
    }
    const outcome = applyIgdbAdoption(appCtx(), candidate, await lookupIgdb(igdbId));
    if (outcome !== 'adopted') return null;
    console.log(
      `[igdb] el juego ${gameId} ya esta en IGDB (${igdbId}) - datos cambiados a su ficha`,
    );
    return igdbId;
  } catch (error) {
    console.warn(`[igdb] no se pudo comprobar si el juego ${gameId} ya esta en IGDB:`, error);
    return null;
  }
};

// La adopción por lotes (los refrescos de Ajustes, Plan y radar): una sola
// consulta de appids a IGDB para todos los candidatos y el detalle solo de los
// que aparecen. Cada juego se escribe por separado: uno que falle no tumba a
// los demás.
export const adoptIgdbForCandidates = async (candidates: AdoptionCandidate[]): Promise<number> => {
  if (candidates.length === 0) return 0;
  let byAppId: Map<number, number>;
  try {
    byAppId = await getIgdbIdsBySteamAppIds(candidates.map((game) => game.steamAppId));
  } catch (error) {
    console.warn('[igdb] fallo comprobando los juegos que solo estaban en Steam:', error);
    return 0;
  }
  let adopted = 0;
  for (const candidate of candidates) {
    const igdbId = byAppId.get(candidate.steamAppId);
    try {
      const lookup = igdbId === undefined ? null : await lookupIgdb(igdbId);
      const outcome = applyIgdbAdoption(appCtx(), candidate, lookup);
      // Un fallo de red queda apuntado en la comprobación del juego (se
      // reintenta en otro refresco); aquí además se cuenta por consola.
      if (outcome === 'failed') {
        console.warn(
          `[igdb] no se pudo pedir la ficha del juego ${candidate.gameId} (sigo con los demas)`,
        );
      }
      if (outcome !== 'adopted') continue;
      adopted++;
      console.log(
        `[igdb] el juego ${candidate.gameId} ya esta en IGDB (${igdbId}) - datos cambiados a su ficha`,
      );
    } catch (error) {
      console.warn(
        `[igdb] no se pudo adoptar el juego ${candidate.gameId} (sigo con los demas):`,
        error,
      );
    }
  }
  return adopted;
};
