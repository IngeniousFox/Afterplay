import { unixSecondsToUtcYear } from '../lib/titleMatch';
import { igdbRequest } from './client';
import { igdbImageUrl } from './images';
import { filterAndRankGames } from './rank';
import { igdbDetailResponseSchema, igdbSearchResponseSchema } from './schemas';
import type { IgdbGameDetail, IgdbSearchResult } from './types';

const SEARCH_FIELDS =
  'name, cover.image_id, first_release_date, platforms.name, genres.name, summary, ' +
  'category, version_parent, parent_game, collection, total_rating_count, follows, hypes';

// IGDB's own "search" ordering es sobre todo relevancia de texto — no
// distingue el juego base de sus DLC/mods/ediciones sueltas ni de morralla
// poco relevante. Se pide un banco de candidatos bastante más grande del que
// se va a mostrar para que el ranking (rank.ts) tenga margen real donde
// elegir, y luego se recorta al límite que ve el usuario.
const CANDIDATE_POOL_SIZE = 60;
const RESULT_LIMIT = 25;

// El texto del usuario va dentro de comillas en el body APICalypse — una
// comilla suelta en lo que escriba rompería (o alteraría) la query entera.
const escapeQuery = (query: string): string => query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const toReleaseYear = (unixSeconds: number | undefined): number | null =>
  unixSeconds === undefined ? null : unixSecondsToUtcYear(unixSeconds);

export const searchGames = async (query: string): Promise<IgdbSearchResult[]> => {
  const escaped = escapeQuery(query);

  // IGDB's "search" pondera relevancia de texto y no hace bien el "a medio
  // escribir" — comprobado en vivo, buscar "pragmat" no encontraba
  // "Pragmata" (solo apareció al completar la palabra entera), justo lo
  // contrario de lo que hace falta en una caja que filtra mientras se
  // escribe. El operador `~ *"..."*` hace un "contiene" literal
  // case-insensitive, que sí encuentra prefijos/substrings a medias. Se
  // piden las dos en paralelo y se combinan: la de relevancia aporta
  // tolerancia a erratas y orden de palabras, la de wildcard aporta que no
  // se pierda nada por ir todavía a medio escribir.
  const relevanceBody = `fields ${SEARCH_FIELDS}; search "${escaped}"; limit ${CANDIDATE_POOL_SIZE};`;
  const wildcardBody = `fields ${SEARCH_FIELDS}; where name ~ *"${escaped}"*; limit ${CANDIDATE_POOL_SIZE};`;

  const [relevanceRaw, wildcardRaw] = await Promise.all([
    igdbRequest('games', relevanceBody),
    igdbRequest('games', wildcardBody),
  ]);

  const relevanceGames = igdbSearchResponseSchema.parse(relevanceRaw);
  const wildcardGames = igdbSearchResponseSchema.parse(wildcardRaw);

  // Dedupe por id — el mismo juego casi siempre sale en las dos listas.
  const gamesById = new Map<number, (typeof relevanceGames)[number]>();
  for (const game of [...relevanceGames, ...wildcardGames]) {
    gamesById.set(game.id, game);
  }

  // Cada candidato lleva los campos que rank.ts necesita para filtrar/
  // puntuar PEGADOS a los campos originales — así filterAndRankGames() puede
  // devolver los objetos completos y no hace falta volver a cruzarlos con
  // el array de partida.
  //
  // category ?? 0 y NO ?? -1: IGDB omite el campo directamente cuando vale 0
  // (main_game, el caso más común) — comprobado en vivo, "Cyberpunk 2077" no
  // trae `category` en la respuesta y aun así es category:0. Tratar "no
  // viene" como "desconocido y fuera" excluía el juego principal de CASI
  // toda búsqueda.
  const rankable = [...gamesById.values()].map((game) => ({
    ...game,
    category: game.category ?? 0,
    versionParent: game.version_parent ?? null,
    parentGame: game.parent_game ?? null,
    collection: game.collection ?? null,
    hasCover: game.cover !== undefined,
    totalRatingCount: game.total_rating_count ?? null,
    follows: game.follows ?? null,
    hypes: game.hypes ?? null,
    firstReleaseYear: toReleaseYear(game.first_release_date),
  }));

  const ranked = filterAndRankGames(rankable, query).slice(0, RESULT_LIMIT);

  return ranked.map((game) => ({
    igdbId: game.id,
    title: game.name,
    coverUrl: game.cover ? igdbImageUrl(game.cover.image_id, 'cover_small') : null,
    releaseYear: game.firstReleaseYear,
    platforms: game.platforms?.map((platform) => platform.name) ?? [],
    genres: game.genres?.map((genre) => genre.name) ?? [],
    summary: game.summary ?? null,
  }));
};

export const getGameDetails = async (igdbId: number): Promise<IgdbGameDetail | null> => {
  // El id va interpolado en el body: entero obligatorio, que por ahí no se
  // cuele texto arbitrario hacia la query.
  if (!Number.isInteger(igdbId)) {
    throw new Error(`igdbId inválido: ${igdbId}`);
  }

  const body =
    `fields ${SEARCH_FIELDS}, artworks.image_id, screenshots.image_id, ` +
    `involved_companies.company.name, involved_companies.developer, involved_companies.publisher; ` +
    `where id = ${igdbId};`;
  const [game] = igdbDetailResponseSchema.parse(await igdbRequest('games', body));
  if (!game) return null;

  const companies = game.involved_companies ?? [];

  return {
    igdbId: game.id,
    title: game.name,
    coverUrl: game.cover ? igdbImageUrl(game.cover.image_id, 'cover_big') : null,
    releaseYear: toReleaseYear(game.first_release_date),
    platforms: game.platforms?.map((platform) => platform.name) ?? [],
    genres: game.genres?.map((genre) => genre.name) ?? [],
    summary: game.summary ?? null,
    developer: companies.find((entry) => entry.developer)?.company.name ?? null,
    publisher: companies.find((entry) => entry.publisher)?.company.name ?? null,
    covers: game.cover ? [igdbImageUrl(game.cover.image_id, 'cover_big')] : [],
    heroes: game.artworks?.map((artwork) => igdbImageUrl(artwork.image_id, '1080p')) ?? [],
    screenshots:
      game.screenshots?.map((shot) => igdbImageUrl(shot.image_id, 'screenshot_big')) ?? [],
  };
};
