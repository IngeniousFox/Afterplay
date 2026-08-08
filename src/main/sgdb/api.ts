import { getSgdbClient } from './client';
import { findBestMatch } from './match';
import { sgdbImageResponseSchema, sgdbSearchResponseSchema } from './schemas';
import type { GetSgdbImagesInput, SgdbImageCandidate, SgdbImages } from './types';

const SGDB_TIMEOUT_MS = 10_000;

// El paquete "steamgriddb" arma su propia llamada axios(options) por dentro
// sin exponer ningún hook de timeout — a diferencia de IGDB (10s vía nuestro
// propio cliente axios) y HLTB (30s ya incluidos en su paquete), una llamada
// a SGDB que nunca responde se quedaría colgada sin límite. Esto le pone la
// misma cota por fuera, sin tocar el paquete.
const withSgdbTimeout = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('SteamGridDB tardó demasiado en responder')),
        SGDB_TIMEOUT_MS,
      ),
    ),
  ]);

// Busca el juego en SteamGridDB y devuelve su id, o null si no hay match con
// confianza suficiente. Mismo criterio que HLTB (nombre + año) — aquí hace
// más falta todavía: el buscador de SGDB devuelve DLC, mods de fans y hasta
// juegos sin relación con nombre parecido (probado en vivo).
export const sgdbSearch = async (
  title: string,
  releaseYear: number | null,
): Promise<number | null> => {
  const client = await getSgdbClient();
  const raw = await withSgdbTimeout(client.searchGame(title));
  const candidates = sgdbSearchResponseSchema.parse(raw);
  const match = findBestMatch(candidates, title, releaseYear);
  return match?.id ?? null;
};

// El id de SteamGridDB de un juego a partir de su APPID de Steam.
//
// Para un juego que solo está en Steam esta es la vía buena, y con diferencia:
// sgdbSearch tiene que buscar por nombre y colar el resultado por un matcher
// difuso (que existe porque SGDB devuelve DLC, mods de fans y juegos sin
// relación con nombre parecido). Aquí no hay nada que adivinar — el appid es
// el mismo identificador en las dos partes, así que el emparejado es exacto.
//
// Y sí funciona para estos juegos: que IGDB no tenga un juego recién anunciado
// no dice nada sobre SteamGridDB, que va por su cuenta y suele tener arte de
// un título en cuanto tiene página de tienda.
//
// null = SGDB no conoce ese appid (o no contestó). El alta sigue igual: sin id
// de SGDB solo se pierden candidatas en el CoverPicker.
export const sgdbSearchBySteamAppId = async (steamAppId: number): Promise<number | null> => {
  try {
    const client = await getSgdbClient();
    const game = await withSgdbTimeout(client.getGameBySteamAppId(steamAppId));
    const id = (game as { id?: number } | null)?.id;
    return typeof id === 'number' ? id : null;
  } catch (error) {
    // Lanza con "Game not found" cuando no lo tiene — no es un fallo que
    // merezca ruido de error, es una respuesta.
    console.warn(`[sgdb] sin ficha para el appid ${steamAppId}:`, error);
    return null;
  }
};

// EL id de SteamGridDB de un juego, por la mejor vía que haya.
//
// Existe porque este id tenía el mismo agujero que tuvo el appid de Steam: se
// resolvía UNA vez, en el alta, y si salía null ahí se quedaba para siempre.
// Y sale null por motivos que caducan — SGDB caído, la clave sin configurar
// todavía, o un juego tan recién anunciado que aún no tenía arte. El juego se
// quedaba sin candidatas en el CoverPicker sin ninguna forma de reintentarlo.
//
// Medido sobre la biblioteca real (8-ago-2026): 15 juegos de 985 sin id, y
// los 15 con appid de Steam — o sea que la vía exacta los cubre a todos.
//
// El orden no es casual: por appid primero porque es un emparejado EXACTO, y
// solo se cae al nombre+año (con su matcher difuso) cuando no hay appid. Un
// juego de consola es justo ese caso.
//
// Nunca lanza: sin clave de SGDB o con el servicio caído devuelve null y quien
// llama sigue igual que estaba.
export const resolveSgdbId = async (game: {
  title: string;
  releaseYear: number | null;
  steamAppId: number | null;
}): Promise<number | null> => {
  if (game.steamAppId !== null) return sgdbSearchBySteamAppId(game.steamAppId);
  try {
    return await sgdbSearch(game.title, game.releaseYear);
  } catch (error) {
    console.warn(`[sgdb] no se pudo resolver el id de "${game.title}":`, error);
    return null;
  }
};

const toCandidate = (image: {
  url: string;
  thumb: string;
  style?: string | null;
  score?: number;
}): SgdbImageCandidate => ({
  url: image.url,
  thumb: image.thumb,
  style: image.style ?? null,
  score: image.score ?? 0,
});

// SteamGridDB LANZA ("Game not found") si el id no tiene absolutamente nada
// para ese tipo de imagen (probado en vivo) — se traduce a lista vacía en vez
// de propagar el throw, así IGDB sigue sirviendo aunque SGDB no tenga nada
// para este juego concreto.
const safeImageCall = async (call: () => Promise<unknown>): Promise<SgdbImageCandidate[]> => {
  try {
    const raw = await withSgdbTimeout(call());
    return sgdbImageResponseSchema.parse(raw).map(toCandidate);
  } catch (error) {
    console.error('[sgdb] fallo pidiendo imagenes, devuelvo lista vacia:', error);
    return [];
  }
};

const sgdbGetGrids = async (id: number): Promise<SgdbImageCandidate[]> =>
  safeImageCall(async () => (await getSgdbClient()).getGridsById(id));

const sgdbGetHeroes = async (id: number): Promise<SgdbImageCandidate[]> =>
  safeImageCall(async () => (await getSgdbClient()).getHeroesById(id));

const sgdbGetLogos = async (id: number): Promise<SgdbImageCandidate[]> =>
  safeImageCall(async () => (await getSgdbClient()).getLogosById(id));

export const getSgdbImages = async (input: GetSgdbImagesInput): Promise<SgdbImages> => {
  const id = 'sgdbId' in input ? input.sgdbId : await sgdbSearch(input.title, input.releaseYear);
  if (id === null) return { grids: [], heroes: [], logos: [] };

  const [grids, heroes, logos] = await Promise.all([
    sgdbGetGrids(id),
    sgdbGetHeroes(id),
    sgdbGetLogos(id),
  ]);
  return { grids, heroes, logos };
};
