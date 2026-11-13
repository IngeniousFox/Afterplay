import { eq } from 'drizzle-orm';
import { gameMetadata, games, type ExternalCheckSource } from '../../../schema';
import { readCheck } from '../../common/checks';
import type { QueryFixture } from '../../common/__tests__/fixtures';
import type { IgdbBatchData, IgdbDetailData } from '../types';

// Ayudas de los tests de P6. Todo con datos inventados.

const SYNCED_TOUCHED = ['games', 'game_metadata', 'external_checks'] as const;

/** Deja limpias (`syncDirty = 0`) las tablas que escribe el refresco. */
export function markClean(fx: QueryFixture): void {
  for (const table of SYNCED_TOUCHED) {
    fx.local.db.$client.prepare(`UPDATE "${table}" SET syncDirty = 0`).run();
  }
}

/** Filas pendientes de sync en las tablas que escribe el refresco. */
export function dirtyRows(fx: QueryFixture): number {
  let total = 0;
  for (const table of SYNCED_TOUCHED) {
    const row = fx.local.db.$client
      .prepare(`SELECT count(*) AS n FROM "${table}" WHERE syncDirty = 1`)
      .get();
    total += Number(row?.n);
  }
  return total;
}

/** `syncUpdated` de todas las filas de esas tablas, para comparar antes y después. */
export function clocks(fx: QueryFixture): string {
  return SYNCED_TOUCHED.map((table) =>
    JSON.stringify(
      fx.local.db.$client.prepare(`SELECT id, syncUpdated FROM "${table}" ORDER BY id`).all(),
    ),
  ).join('|');
}

export const gameRow = (fx: QueryFixture, id: string): typeof games.$inferSelect | undefined =>
  fx.ctx.db.select().from(games).where(eq(games.id, id)).get();

export const mdRow = (fx: QueryFixture, id: string): typeof gameMetadata.$inferSelect | undefined =>
  fx.ctx.db.select().from(gameMetadata).where(eq(gameMetadata.id, id)).get();

export const checkOf = (
  fx: QueryFixture,
  gameId: string,
  source: ExternalCheckSource,
): ReturnType<typeof readCheck> => readCheck(fx.ctx, gameId, source);

export const countRows = (fx: QueryFixture, table: string, where = '1 = 1'): number =>
  Number(
    fx.local.db.$client.prepare(`SELECT count(*) AS n FROM "${table}" WHERE ${where}`).get()?.n,
  );

/** Un lote de IGDB inventado. */
export const batch = (overrides: Partial<IgdbBatchData> = {}): IgdbBatchData => ({
  ratingCritics: 81,
  ratingCriticsCount: 12,
  ratingUsers: 77,
  ratingUsersCount: 340,
  summary: 'Una sinopsis inventada.',
  igdbCollections: [{ id: 9, name: 'Saga inventada' }],
  releaseYear: 2024,
  releaseDate: new Date('2024-03-01T00:00:00Z'),
  releaseDatePrecision: 'day',
  ...overrides,
});

/** Un detalle de IGDB inventado. */
export const detail = (
  igdbId: number,
  overrides: Partial<IgdbDetailData> = {},
): IgdbDetailData => ({
  igdbId,
  title: `Ficha de IGDB ${igdbId}`,
  covers: [`https://img.example/cover-${igdbId}.jpg`],
  heroes: [`https://img.example/hero-${igdbId}.jpg`],
  developer: 'Estudio IGDB',
  publisher: 'Editora IGDB',
  genres: ['Aventura'],
  platforms: ['PC (Microsoft Windows)'],
  summary: 'Sinopsis de IGDB.',
  igdbCollections: null,
  release: { date: new Date('2023-05-05T00:00:00Z'), precision: 'day' },
  releaseYear: 2023,
  ratingCritics: 90,
  ratingCriticsCount: 20,
  ratingUsers: 85,
  ratingUsersCount: 500,
  ...overrides,
});

/** Los cinco overrides puestos, para comprobar que nadie los toca. */
export const MANUAL_OVERRIDES: {
  coverOverride: string;
  heroOverride: string;
  developerOverride: string;
  publisherOverride: string;
  genresOverride: string[];
} = {
  coverOverride: 'https://img.example/mi-caratula.jpg',
  heroOverride: 'https://img.example/mi-banner.jpg',
  developerOverride: 'Mi estudio',
  publisherOverride: 'Mi editora',
  genresOverride: ['Mis géneros'],
};

export const overridesOf = (
  fx: QueryFixture,
  id: string,
): Pick<
  typeof games.$inferSelect,
  'coverOverride' | 'heroOverride' | 'developerOverride' | 'publisherOverride' | 'genresOverride'
> => {
  const row = gameRow(fx, id);
  if (!row) throw new Error(`no existe el juego ${id}`);
  return {
    coverOverride: row.coverOverride,
    heroOverride: row.heroOverride,
    developerOverride: row.developerOverride,
    publisherOverride: row.publisherOverride,
    genresOverride: row.genresOverride,
  };
};
