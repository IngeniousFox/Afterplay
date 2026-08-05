import { getGameDetails, resolveAchievementsSteamAppId } from '../../../igdb/api';
import { getHltbTimes } from '../../../hltb/api';
import { sgdbSearch } from '../../../sgdb/api';

// Enriquecimiento externo compartido por createGameWithDetails (alta normal)
// y createPlannedGame (alta en Plan to Play): mismo detalle de IGDB, mismos
// tiempos de HLTB y mismo id de SteamGridDB, resueltos ANTES de abrir la
// transacción — ninguna llamada de red debe quedar a medias dentro de un
// db.transaction, que debe ser rápido y solo tocar la base de datos. Cada
// caller esparce el resultado y añade lo suyo (notes/executablePath/
// planned...).
export type GameEnrichmentOverrides = {
  // Elegidos a mano en el CoverPicker (SPEC 4.6) — null significa "sin
  // elección propia", se usa el propio default (detail.covers[0]/heroes[0],
  // la primera candidata de IGDB).
  coverUrl: string | null;
  heroUrl: string | null;
  // null = buscar el id en SteamGridDB por nombre+año, como siempre. Puesto
  // a mano = usar ESE id directo, sin sgdbSearch — el usuario ya lo tecleó.
  steamGridDbId: number | null;
};

export type GameEnrichment = {
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  developer: string | null;
  publisher: string | null;
  genres: string[] | null;
  igdbId: number;
  steamGridDbId: number | null;
  officialPlatforms: string[] | null;
  releaseYear: number | null;
  hltbMain: number | null;
  hltbMainExtras: number | null;
  hltbCompletionist: number | null;
  // Appid de Steam + su marca de "ya preguntado" (LOGROS.md). Van juntos en
  // el enrichment porque salen de la MISMA respuesta de IGDB que el resto:
  // un juego dado de alta nace ya comprobado, y el backfill de arranque no
  // tiene que volver a preguntar por él.
  steamAppId: number | null;
  steamAppIdCheckedAt: Date;
  // Puntuaciones — mismo viaje gratis que el resto: ya vienen en el detalle
  // que se pide de todas formas, así que el juego nace con sus notas de
  // salida en vez de con la ficha vacía hasta el primer refresco manual.
  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
  ratingsCheckedAt: Date;
};

export const resolveGameEnrichment = async (
  igdbId: number,
  overrides: GameEnrichmentOverrides,
): Promise<GameEnrichment> => {
  const detail = await getGameDetails(igdbId);
  if (!detail) {
    throw new Error(`No se encontró el juego de IGDB ${igdbId} (¿lo quitaron del catálogo?)`);
  }

  // SGDB es opcional (clave sin configurar, servicio caído...): sin él se
  // pierde steamGridDbId (menos candidatas de carátula), pero el alta del
  // juego NO debe fallar — IGDB es la única fuente imprescindible aquí. Si
  // el usuario ya escribió un id a mano, ni se busca: se usa ese.
  //
  // El appid de Steam viaja en el MISMO lote a propósito: no depende de HLTB
  // ni de SGDB, y encadenarlo detrás del detalle (que es donde estaba)
  // sumaba su latencia entera a la espera del botón "Add". Aquí se esconde
  // detrás de HowLongToBeat, que siempre es el más lento de los tres.
  const [hltb, steamGridDbId, steamAppId] = await Promise.all([
    // Sin red de seguridad, esto SÍ podía tumbar el alta entera: hltb-client
    // pega directo contra una API no oficial sin límite de tiempo propio, y
    // un fallo suyo (o un cuelgue) rechazaba este Promise.all aunque IGDB —la
    // única fuente que de verdad hace falta— ya hubiera contestado bien. Los
    // otros dos ingredientes de este mismo Promise.all ya tenían su .catch;
    // a este se le había quedado fuera.
    getHltbTimes(detail.title, detail.releaseYear).catch((error) => {
      console.warn('[hltb] sin tiempos de HowLongToBeat para este alta (sigo sin ellos):', error);
      return null;
    }),
    overrides.steamGridDbId !== null
      ? Promise.resolve(overrides.steamGridDbId)
      : sgdbSearch(detail.title, detail.releaseYear).catch((error) => {
          console.warn('[sgdb] sin id de SteamGridDB para este alta (sigo sin él):', error);
          return null;
        }),
    resolveAchievementsSteamAppId(
      detail.igdbId,
      detail.parentIgdbId,
      detail.directSteamAppId,
    ).catch((error) => {
      // El appid es un extra para los logros, no un requisito del alta: si
      // esto falla, el juego se da de alta igual y el backfill lo recogerá.
      console.warn('[steam] fallo resolviendo el appid en el alta (sigo sin el):', error);
      return null;
    }),
  ]);

  return {
    title: detail.title,
    coverUrl: overrides.coverUrl ?? detail.covers[0] ?? null,
    heroUrl: overrides.heroUrl ?? detail.heroes[0] ?? null,
    developer: detail.developer,
    publisher: detail.publisher,
    genres: detail.genres.length > 0 ? detail.genres : null,
    igdbId: detail.igdbId,
    steamGridDbId,
    officialPlatforms: detail.platforms.length > 0 ? detail.platforms : null,
    releaseYear: detail.releaseYear,
    hltbMain: hltb?.hltbMain ?? null,
    hltbMainExtras: hltb?.hltbMainExtras ?? null,
    hltbCompletionist: hltb?.hltbCompletionist ?? null,
    steamAppId,
    steamAppIdCheckedAt: new Date(),
    ratingCritics: detail.ratingCritics,
    ratingCriticsCount: detail.ratingCriticsCount,
    ratingUsers: detail.ratingUsers,
    ratingUsersCount: detail.ratingUsersCount,
    ratingsCheckedAt: new Date(),
  };
};
