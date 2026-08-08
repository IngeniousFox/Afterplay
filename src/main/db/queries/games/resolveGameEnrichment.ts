import { getGameDetails, resolveAchievementsSteamAppId } from '../../../igdb/api';
import { getHltbTimes } from '../../../hltb/api';
import { sgdbSearch, sgdbSearchBySteamAppId } from '../../../sgdb/api';
import { getSteamStoreDetails } from '../../../steam/store';

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
  // null = el juego se dio de alta desde Steam porque IGDB no lo tenía.
  igdbId: number | null;
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
  // PLAN-TO-PLAY.md §7/§7bis/§10 — sinopsis, sagas y fecha completa con su
  // precisión. Mismo viaje gratis que las notas: ya vienen en el detalle que
  // se pide de todas formas, así que un juego nace con todo puesto en vez de
  // esperar al primer refresco masivo. `ratingsCheckedAt` los cubre a los
  // tres: salen de la misma respuesta, no hacen falta marcas propias.
  summary: string | null;
  igdbCollections: { id: number; name: string }[] | null;
  releaseDate: Date | null;
  releaseDatePrecision: 'year' | 'month' | 'day' | null;
};

// De dónde sale la ficha de este juego. Son EXCLUYENTES a propósito: o el
// juego es de IGDB, o es de Steam. Nada de mezclar las dos fuentes en un alta
// — un juego con la carátula de una y la sinopsis de otra es justo lo que
// adoptIgdb.ts existe para no dejar nunca.
export type EnrichmentSource = { igdbId: number } | { steamAppId: number };

// El alta de un juego que existe en Steam y que IGDB TODAVÍA no tiene.
//
// Nace con `igdbId: null`, que es lo que la columna admite desde la migración
// del 8-ago-2026, y con todo lo demás sacado de la tienda: título, sinopsis,
// estudio, editora, géneros, carátula (la vertical de la biblioteca de Steam,
// misma proporción que el cover_big de IGDB), hero y fecha.
//
// Es PROVISIONAL por diseño: el día que IGDB meta el juego, cualquiera de los
// tres refrescos lo detecta y cambia la fuente entera (external/adoptIgdb.ts).
// Mientras tanto el juego funciona como cualquier otro salvo en lo que
// depende del id de IGDB — sagas, tráiler, capturas y notas de crítica, que
// simplemente no se pintan.
const resolveFromSteam = async (
  steamAppId: number,
  overrides: GameEnrichmentOverrides,
): Promise<GameEnrichment> => {
  const details = await getSteamStoreDetails(steamAppId);
  if (!details) {
    throw new Error(`Steam no tiene ficha del appid ${steamAppId} (¿se retiró de la tienda?)`);
  }

  // Mismo criterio que la vía de IGDB: SGDB y HLTB son accesorios y su fallo
  // no puede tumbar el alta.
  const [hltb, steamGridDbId] = await Promise.all([
    getHltbTimes(details.title, details.releaseYear).catch((error) => {
      console.warn('[hltb] sin tiempos para este alta de Steam (sigo sin ellos):', error);
      return null;
    }),
    // Por APPID y no por nombre: aquí el emparejado es exacto (el appid es el
    // mismo identificador en Steam y en SGDB) en vez de pasar por el matcher
    // difuso de sgdbSearch. Que IGDB no tenga el juego no dice nada sobre
    // SteamGridDB, que suele tener arte en cuanto hay página de tienda.
    overrides.steamGridDbId !== null
      ? Promise.resolve(overrides.steamGridDbId)
      : sgdbSearchBySteamAppId(steamAppId),
  ]);

  return {
    title: details.title,
    coverUrl: overrides.coverUrl ?? details.coverUrl,
    heroUrl: overrides.heroUrl ?? details.heroUrl,
    developer: details.developer,
    publisher: details.publisher,
    genres: details.genres,
    // LA diferencia: sin id de IGDB. El resto de la app ya sabe convivir con
    // esto (se salta lo que dependa de IGDB en vez de romperse).
    igdbId: null,
    steamGridDbId,
    // Un juego de Steam es de PC por definición. No se inventa nada más:
    // IGDB es quien sabe de plataformas, y aquí no está.
    officialPlatforms: ['PC (Microsoft Windows)'],
    releaseYear: details.releaseYear,
    hltbMain: hltb?.hltbMain ?? null,
    hltbMainExtras: hltb?.hltbMainExtras ?? null,
    hltbCompletionist: hltb?.hltbCompletionist ?? null,
    // El appid ya lo sabemos: es POR DONDE se dio de alta. Se marca como
    // comprobado para que el backfill no vuelva a preguntarlo.
    steamAppId,
    steamAppIdCheckedAt: new Date(),
    // Las notas de IGDB no existen para este juego. El % de reseñas de Steam
    // sí, y lo rellena el primer refresco (no aquí: el alta no debe esperar a
    // dos peticiones más).
    ratingCritics: null,
    ratingCriticsCount: null,
    ratingUsers: null,
    ratingUsersCount: null,
    ratingsCheckedAt: new Date(),
    summary: details.summary,
    igdbCollections: null,
    releaseDate: details.releaseDate,
    releaseDatePrecision: details.releaseDatePrecision,
  };
};

export const resolveGameEnrichment = async (
  source: EnrichmentSource,
  overrides: GameEnrichmentOverrides,
): Promise<GameEnrichment> => {
  if ('steamAppId' in source) return resolveFromSteam(source.steamAppId, overrides);
  const { igdbId } = source;
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
    summary: detail.summary,
    igdbCollections: detail.igdbCollections,
    releaseDate: detail.release?.date ?? null,
    releaseDatePrecision: detail.release?.precision ?? null,
  };
};
