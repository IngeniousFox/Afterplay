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
