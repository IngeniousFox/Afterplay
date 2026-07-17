import { getGameDetails } from '../../../igdb/api';
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
};

export const resolveGameEnrichment = async (
  igdbId: number,
  overrides: GameEnrichmentOverrides,
): Promise<GameEnrichment> => {
  const detail = await getGameDetails(igdbId);
  if (!detail) {
    throw new Error(`No se encontró el juego de IGDB ${igdbId} (¿lo quitaron del catálogo?)`);
  }

  const [hltb, steamGridDbId] = await Promise.all([
    getHltbTimes(detail.title, detail.releaseYear),
    sgdbSearch(detail.title, detail.releaseYear),
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
  };
};
