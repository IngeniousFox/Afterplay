// Tipos de la API v2 de la PWA. Búsqueda y datos de IGDB con las claves que sube el escritorio (§9.3).
// Ninguno lleva rutas locales de un PC (F-31).
//
// Rutas (todas GET, bajo `/api/v2`):
//   /search?q=            -> IgdbSearchResult[]
//   /games/:id/saga       -> SagaEntry[]
//   /games/:id/media      -> GameMedia
// Sin claves de IGDB en el hub, las tres responden `igdb_not_configured` (409):
// la PWA dice "abre Afterplay en tu PC una vez".

import type { GameListItem } from '../../types';

/** Un juego tal como lo da IGDB (búsqueda y capítulos de una saga). */
export interface IgdbSearchHit {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
}

/**
 * Un resultado del buscador de juegos, con si ya es tuyo: `library` si está en
 * tu biblioteca, `plan` si espera en tu Plan. Así el buscador lo dice antes de
 * que el alta choque con el duplicado.
 */
export interface IgdbSearchResult extends IgdbSearchHit {
  owned: 'library' | 'plan' | null;
}

/**
 * Un capítulo de la saga de un juego. Los que están en tu biblioteca o en tu
 * Plan traen `libraryId`; los demás viajan solo con lo que dice IGDB.
 */
export interface SagaEntry {
  igdbId: number;
  /** Id del juego en tu espacio (biblioteca o Plan), o null si no lo tienes. */
  libraryId: string | null;
  title: string;
  coverUrl: string | null;
  releaseYear: number | null;
  currentState: GameListItem<string>['currentState'];
  totalHours: number;
  planned: boolean;
}

/** Capturas y tráiler de un juego. */
export interface GameMedia {
  screenshots: string[];
  /** Id del vídeo de YouTube del tráiler, si IGDB tiene uno. */
  videoId: string | null;
}
