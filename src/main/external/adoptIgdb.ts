import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { getGameDetails, getIgdbIdsBySteamAppIds } from '../igdb/api';
import type { UpdateGamePatch } from '../../shared/types';

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
export type AdoptionCandidate = { id: number; steamAppId: number };

export const findAdoptionCandidates = async (): Promise<AdoptionCandidate[]> =>
  withDbAccess(async () => {
    const rows = await getDb()
      .select({ id: gamesTable.id, steamAppId: gamesTable.steamAppId })
      .from(gamesTable)
      .where(and(isNull(gamesTable.igdbId), isNotNull(gamesTable.steamAppId)));
    return rows.filter((row): row is AdoptionCandidate => row.steamAppId !== null);
  });

// El patch de adopción de UN juego, ya resuelto contra IGDB. Separado de la
// escritura para que quien llame lo meta en su propia transacción si quiere
// (el barrido por lotes lo hace) o lo escriba suelto (la ficha).
export const buildIgdbAdoptionPatch = async (igdbId: number): Promise<UpdateGamePatch | null> => {
  const detail = await getGameDetails(igdbId);
  if (!detail) return null;

  return {
    igdbId: detail.igdbId,
    title: detail.title,
    // La carátula y el hero de IGDB sustituyen a las de la tienda. `?? null`
    // y no "conservar la de Steam si IGDB no trae": un juego a medias entre
    // dos fuentes es peor que uno sin imagen, y el CoverPicker (que ya sabe
    // buscar en SteamGridDB) es la vía para ponerle una.
    coverUrl: detail.covers[0] ?? null,
    heroUrl: detail.heroes[0] ?? null,
    developer: detail.developer,
    publisher: detail.publisher,
    genres: detail.genres.length > 0 ? detail.genres : null,
    officialPlatforms: detail.platforms.length > 0 ? detail.platforms : null,
    summary: detail.summary,
    igdbCollections: detail.igdbCollections,
    releaseDate: detail.release?.date ?? null,
    releaseDatePrecision: detail.release?.precision ?? null,
    // Mismo criterio de siempre: el año NUNCA se pone a null (de él dependen
    // las stats y el matching de HowLongToBeat).
    ...(detail.releaseYear !== null ? { releaseYear: detail.releaseYear } : {}),
    ratingCritics: detail.ratingCritics,
    ratingCriticsCount: detail.ratingCriticsCount,
    ratingUsers: detail.ratingUsers,
    ratingUsersCount: detail.ratingUsersCount,
    ratingsCheckedAt: new Date(),
  };
};

// La adopción de UN juego: mira si IGDB ya lo tiene y, si sí, lo cambia de
// fuente. Devuelve el igdbId adoptado, o null si IGDB sigue sin tenerlo.
//
// Nunca lanza por culpa de IGDB: un fallo de red aquí no puede tumbar el
// refresco que la llamó — el juego se queda como estaba y se reintenta en el
// siguiente.
export const adoptIgdbForGame = async (
  gameId: number,
  steamAppId: number,
): Promise<number | null> => {
  try {
    const igdbId = (await getIgdbIdsBySteamAppIds([steamAppId])).get(steamAppId);
    if (igdbId === undefined) return null;

    const patch = await buildIgdbAdoptionPatch(igdbId);
    if (!patch) return null;

    await withDbAccess(async () =>
      getDb().update(gamesTable).set(patch).where(eq(gamesTable.id, gameId)),
    );
    // Solo ASCII, misma convención que el resto de logs del main.
    console.log(
      `[igdb] el juego ${gameId} ya esta en IGDB (${igdbId}) - datos cambiados a su ficha`,
    );
    return igdbId;
  } catch (error) {
    console.warn(`[igdb] no se pudo comprobar si el juego ${gameId} ya esta en IGDB:`, error);
    return null;
  }
};

// Y la versión por LOTES, para los dos barridos (Ajustes/Plan y el radar
// semanal): una sola petición de external_games para todos los candidatos, y
// después el detalle de los que hayan aparecido.
//
// El detalle sí va de uno en uno porque getGameDetails ya está cacheado y
// porque los que aparecen de golpe son poquísimos: son juegos que llevaban
// esperando a que IGDB los metiera, no la biblioteca entera.
//
// Y cada candidato se cae SOLO, igual que en la versión de un juego. El
// try/catch envolvía el bucle entero y devolvía 0: cinco candidatos, los
// cuatro primeros ya adoptados y escritos (cada UPDATE se commitea suelto, no
// hay transacción del lote que deshacer) y un 503 de IGDB en el quinto se
// llevaba por delante el contador. Quien llama lo usa para decidir cosas: la
// pasada de biblioteca relee su lista SOLO si el número es > 0 (external/
// refresh.ts), así que esos cuatro juegos seguían el resto de la pasada con
// igdbId null en memoria — fuera del lote de notas, fuera de la ronda de
// appids y guardados por la rama de "IGDB no lo conoce" — y el parte de
// Ajustes cantaba "0 adoptados" en una pasada donde cuatro cambiaron de
// fuente. Encima el quinto fallo cortaba la cola para los que venían detrás.
export const adoptIgdbForCandidates = async (candidates: AdoptionCandidate[]): Promise<number> => {
  if (candidates.length === 0) return 0;

  // La petición del LOTE sí es de todo o nada: sin ella no hay a quién
  // adoptar, y no se ha tocado ninguna fila todavía.
  let byAppId: Map<number, number>;
  try {
    byAppId = await getIgdbIdsBySteamAppIds(candidates.map((game) => game.steamAppId));
  } catch (error) {
    console.warn('[igdb] fallo comprobando los juegos que solo estaban en Steam:', error);
    return 0;
  }
  if (byAppId.size === 0) return 0;

  let adopted = 0;
  for (const candidate of candidates) {
    const igdbId = byAppId.get(candidate.steamAppId);
    if (igdbId === undefined) continue;

    try {
      const patch = await buildIgdbAdoptionPatch(igdbId);
      if (!patch) continue;

      await withDbAccess(async () =>
        getDb().update(gamesTable).set(patch).where(eq(gamesTable.id, candidate.id)),
      );
      adopted++;
      console.log(
        `[igdb] el juego ${candidate.id} ya esta en IGDB (${igdbId}) - datos cambiados a su ficha`,
      );
    } catch (error) {
      // Solo ASCII, misma convención que el resto de logs del main.
      console.warn(
        `[igdb] no se pudo adoptar el juego ${candidate.id} (sigo con los demas):`,
        error,
      );
    }
  }
  return adopted;
};
