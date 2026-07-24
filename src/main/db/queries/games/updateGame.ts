import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameRow, UpdateGamePatch } from '../../../../shared/types';
import { gameColumns } from '../../projections';
import { gamesTable } from '../../schema';
import { updateOrFetch } from '../updateOrFetch';

export const updateGame = async (id: number, patch: UpdateGamePatch): Promise<GameRow | null> => {
  const db = getDb();

  return updateOrFetch(
    patch,
    async () => {
      const [game] = await db
        .select(gameColumns)
        .from(gamesTable)
        .where(eq(gamesTable.id, id))
        .limit(1);
      return game ?? null;
    },
    async () => {
      const [updated] = await db
        .update(gamesTable)
        .set(patch)
        .where(eq(gamesTable.id, id))
        .returning(gameColumns);
      return updated ?? null;
    },
  );
};
