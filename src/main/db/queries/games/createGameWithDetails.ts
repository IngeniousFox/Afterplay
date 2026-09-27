import { getDb } from '../..';
import type {
  CreateGameInput,
  CreateGameWithDetailsInput,
  GameRow,
} from '../../../../shared/types';
import { gameColumns } from '../../projections';
import { gamesTable, iterationsTable } from '../../schema';
import { resolveGameEnrichment } from './resolveGameEnrichment';
import { writeInitialPlaythrough } from './writeInitialPlaythrough';

// El main resuelve TODO lo que hace falta de fuentes externas (IGDB, HLTB,
// SteamGridDB) ANTES de abrir la transacción — así ninguna llamada de red
// queda a medias dentro de un db.transaction, que debe ser rápido y solo
// tocar la base de datos.
export const createGameWithDetails = async (
  input: CreateGameWithDetailsInput,
): Promise<GameRow> => {
  const forcedAppId = input.steamAppIdOverride ?? null;
  if (
    forcedAppId !== null &&
    (!Number.isSafeInteger(forcedAppId) || forcedAppId < 1 || forcedAppId > 0xffffffff)
  ) {
    throw new Error('Invalid Steam App ID.');
  }
  const source =
    forcedAppId !== null && 'steamAppId' in input.source
      ? { steamAppId: forcedAppId }
      : input.source;
  const enrichment = await resolveGameEnrichment(source, {
    coverUrl: input.coverUrl,
    heroUrl: input.heroUrl,
    steamGridDbId: input.steamGridDbId,
    steamAppIdOverride: forcedAppId,
  });

  const gameInput: CreateGameInput = {
    ...enrichment,
    steamAppIdManual: forcedAppId !== null,
    notes: input.gameNotes,
    executablePath: input.executablePath,
    installDirectory: input.installDirectory,
    installSizeBytes: input.installSizeBytes,
    endless: input.endless,
    isEmulated: input.isEmulated,
  };

  const db = getDb();

  return db.transaction(async (tx) => {
    const [game] = await tx.insert(gamesTable).values(gameInput).returning(gameColumns);

    const [iteration] = await tx
      .insert(iterationsTable)
      .values({
        gameId: game.id,
        label: 'Playthrough 1',
        playedPlatform: input.iteration.playedPlatform,
        origin: input.iteration.origin,
        format: input.iteration.format,
        manualTotalPlayed: input.hoursPlayed,
      })
      .returning({ id: iterationsTable.id });

    await writeInitialPlaythrough(tx, game.id, iteration.id, input);

    return game;
  });
};
