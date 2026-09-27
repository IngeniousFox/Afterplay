import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import type { CreateGameWithDetailsInput } from '../../../shared/types';
import type {
  EnrichmentSource,
  GameEnrichment,
  GameEnrichmentOverrides,
} from '../queries/games/resolveGameEnrichment';
import { achievementUnlocksTable, achievementsTable, gamesTable } from '../schema';
import { cleanupDbs, freshDb, makeGame, type TestDb } from './harness';

let resolvedSource: EnrichmentSource | null = null;
let resolvedOverride: number | null | undefined;
mock.module('../queries/games/resolveGameEnrichment', {
  namedExports: {
    resolveGameEnrichment: async (
      source: EnrichmentSource,
      overrides: GameEnrichmentOverrides,
    ): Promise<GameEnrichment> => {
      resolvedSource = source;
      resolvedOverride = overrides.steamAppIdOverride;
      return {
        title: 'Correct game',
        coverUrl: null,
        heroUrl: null,
        developer: null,
        publisher: null,
        genres: null,
        igdbId: 'igdbId' in source ? source.igdbId : null,
        steamGridDbId: null,
        officialPlatforms: null,
        releaseYear: null,
        hltbMain: null,
        hltbMainExtras: null,
        hltbCompletionist: null,
        steamAppId:
          overrides.steamAppIdOverride ?? ('steamAppId' in source ? source.steamAppId : 111),
        steamAppIdCheckedAt: new Date(),
        ratingCritics: null,
        ratingCriticsCount: null,
        ratingUsers: null,
        ratingUsersCount: null,
        ratingsCheckedAt: new Date(),
        summary: null,
        igdbCollections: null,
        releaseDate: null,
        releaseDatePrecision: null,
      };
    },
  },
});

let db: TestDb;
let setSteamAppId: typeof import('../queries/games/setSteamAppId').setSteamAppId;
let createGameWithDetails: typeof import('../queries/games/createGameWithDetails').createGameWithDetails;
before(async () => {
  ({ setSteamAppId } = await import('../queries/games/setSteamAppId'));
  ({ createGameWithDetails } = await import('../queries/games/createGameWithDetails'));
});
beforeEach(async () => {
  db = await freshDb();
  resolvedSource = null;
  resolvedOverride = undefined;
});
after(() => cleanupDbs());

const input = (override: number | null): CreateGameWithDetailsInput => ({
  source: { igdbId: 20 },
  steamAppIdOverride: override,
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
  installDirectory: null,
  installSizeBytes: null,
});

describe('Steam App ID override', () => {
  it('uses the forced ID when adding a normal game and locks it against automatic refreshes', async () => {
    const created = await createGameWithDetails(input(222));
    assert.equal(resolvedOverride, 222);
    assert.deepEqual(resolvedSource, { igdbId: 20 });
    assert.equal(created.steamAppId, 222);
    assert.equal(created.steamAppIdManual, true);
  });

  it('keeps automatic matching when the Add Game field is empty', async () => {
    const created = await createGameWithDetails(input(null));
    assert.equal(created.steamAppId, 111);
    assert.equal(created.steamAppIdManual, false);
  });

  it('uses the forced ID as the source when Add Game starts from Steam search', async () => {
    const created = await createGameWithDetails({
      ...input(222),
      source: { steamAppId: 111 },
    });
    assert.deepEqual(resolvedSource, { steamAppId: 222 });
    assert.equal(created.steamAppId, 222);
    assert.equal(created.steamAppIdManual, true);
  });

  it('replaces the wrong Steam catalog while keeping RetroAchievements', async () => {
    const gameId = await makeGame(db, {
      steamAppId: 100,
      raGameId: 55,
      steamPositive: 50,
      achievementsSyncedAt: new Date('2026-01-01'),
    });
    const [oldSteam] = await db
      .insert(achievementsTable)
      .values({ gameId, apiName: 'OLD_WIN', displayName: 'Wrong game', sortIndex: 0 })
      .returning({ id: achievementsTable.id });
    const [ra] = await db
      .insert(achievementsTable)
      .values({ gameId, apiName: '12345', displayName: 'Retro', sortIndex: 0 })
      .returning({ id: achievementsTable.id });
    await db.insert(achievementUnlocksTable).values([
      { achievementId: oldSteam.id, source: 'emu', unlockedAt: new Date('2025-01-01') },
      { achievementId: ra.id, source: 'ra', unlockedAt: new Date('2025-01-01') },
    ]);

    const updated = await setSteamAppId(gameId, 200);
    assert.equal(updated?.steamAppId, 200);
    assert.equal(updated?.steamAppIdManual, true);
    assert.equal(updated?.steamPositive, null);
    assert.equal(updated?.achievementsSyncedAt, null);
    assert.deepEqual(
      (await db.select().from(achievementsTable).where(eq(achievementsTable.gameId, gameId))).map(
        (row) => row.apiName,
      ),
      ['12345'],
    );
    assert.equal((await db.select().from(achievementUnlocksTable)).length, 1);
  });

  it('rejects invalid IDs without changing the game', async () => {
    const gameId = await makeGame(db, { steamAppId: 100 });
    await assert.rejects(setSteamAppId(gameId, 0));
    await assert.rejects(setSteamAppId(gameId, 0x100000000));
    const [game] = await db.select().from(gamesTable).where(eq(gamesTable.id, gameId));
    assert.equal(game.steamAppId, 100);
  });
});
