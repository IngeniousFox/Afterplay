import type {
  CreateGameWithDetailsInput,
  CreatePlannedGameInput,
  PromotePlannedGameInput,
} from '../../../../../../shared/types';
import type { GameEnrichmentData } from '../newGame';

// Entradas de ejemplo de los tests de P2. Datos inventados.

/** El resultado de la red para un juego de IGDB, con todo relleno. */
export const enrichment = (overrides: Partial<GameEnrichmentData> = {}): GameEnrichmentData => ({
  title: 'Silksong',
  igdbId: 20001,
  steamAppId: 1030300,
  steamGridDbId: 5555,
  coverUrl: 'https://covers/silksong.jpg',
  heroUrl: 'https://heroes/silksong.jpg',
  developer: 'Team Cherry',
  publisher: 'Team Cherry',
  genres: ['Platform'],
  officialPlatforms: ['PC (Microsoft Windows)'],
  releaseYear: 2026,
  releaseDate: new Date('2026-09-04T00:00:00Z'),
  releaseDatePrecision: 'day',
  summary: 'Hornet vuelve a un reino que no la esperaba.',
  igdbCollections: null,
  hltbMain: 32,
  hltbMainExtras: null,
  hltbCompletionist: null,
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
  ...overrides,
});

/** Un juego que solo existe en Steam (sin igdbId). */
export const steamEnrichment = (overrides: Partial<GameEnrichmentData> = {}): GameEnrichmentData =>
  enrichment({
    title: 'Juego de Steam',
    igdbId: null,
    steamAppId: 99,
    steamGridDbId: null,
    officialPlatforms: ['PC (Microsoft Windows)'],
    hltbMain: null,
    ...overrides,
  });

/** El alta normal mínima: sin estado, sin gasto, sin horas, sin rutas. */
export const createInput = (
  overrides: Partial<CreateGameWithDetailsInput> = {},
): CreateGameWithDetailsInput => ({
  source: { igdbId: 20001 },
  endless: false,
  isEmulated: false,
  iteration: { playedPlatform: 'PC', origin: 'Purchased', format: 'digital' },
  hoursPlayed: null,
  started: null,
  finished: null,
  initialStatus: null,
  note: null,
  gameNotes: null,
  moneySpent: null,
  moneySpentDate: null,
  executablePath: null,
  coverUrl: null,
  heroUrl: null,
  steamGridDbId: null,
  steamAppIdOverride: null,
  installDirectory: null,
  installSizeBytes: null,
  ...overrides,
});

export const planInput = (
  overrides: Partial<CreatePlannedGameInput> = {},
): CreatePlannedGameInput => ({
  source: { igdbId: 20001 },
  note: null,
  gameNotes: null,
  coverUrl: null,
  heroUrl: null,
  steamGridDbId: null,
  ...overrides,
});

export const promoteInput = (
  gameId: string,
  overrides: Partial<PromotePlannedGameInput<string>> = {},
): PromotePlannedGameInput<string> => ({
  gameId,
  endless: false,
  isEmulated: false,
  iteration: { playedPlatform: 'Nintendo Switch', origin: 'Gift', format: 'physical' },
  hoursPlayed: null,
  started: null,
  finished: null,
  initialStatus: null,
  note: null,
  gameNotes: null,
  moneySpent: null,
  moneySpentDate: null,
  executablePath: null,
  coverUrl: null,
  heroUrl: null,
  steamGridDbId: null,
  installDirectory: null,
  installSizeBytes: null,
  ...overrides,
});

export const EUR = { currency: 'EUR' } as const;
