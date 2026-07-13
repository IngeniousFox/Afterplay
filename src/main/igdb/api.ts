import { igdbRequest } from './client';
import { igdbImageUrl } from './images';
import { igdbDetailResponseSchema, igdbSearchResponseSchema } from './schemas';
import type { IgdbGameDetail, IgdbSearchResult } from './types';

const SEARCH_FIELDS =
  'name, cover.image_id, first_release_date, platforms.name, genres.name, summary';

// El texto del usuario va dentro de comillas en el body APICalypse — una
// comilla suelta en lo que escriba rompería (o alteraría) la query entera.
const escapeQuery = (query: string): string => query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const toReleaseYear = (unixSeconds: number | undefined): number | null =>
  unixSeconds === undefined ? null : new Date(unixSeconds * 1000).getUTCFullYear();

export const searchGames = async (query: string): Promise<IgdbSearchResult[]> => {
  const body = `fields ${SEARCH_FIELDS}; search "${escapeQuery(query)}"; limit 25;`;
  const games = igdbSearchResponseSchema.parse(await igdbRequest('games', body));

  return games.map((game) => ({
    igdbId: game.id,
    title: game.name,
    coverUrl: game.cover ? igdbImageUrl(game.cover.image_id, 'cover_small') : null,
    releaseYear: toReleaseYear(game.first_release_date),
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
