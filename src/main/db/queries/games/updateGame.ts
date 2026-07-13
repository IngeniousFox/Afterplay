import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameRow, UpdateGamePatch } from '../../../../shared/types';
import { gameColumns } from '../../projections';
import { gamesTable } from '../../schema';

export const updateGame = async (id: number, patch: UpdateGamePatch): Promise<GameRow | null> => {
  const db = getDb();

  // Drizzle peta con un .set() vacío, y un patch vacío es legítimo (guardar
  // el formulario sin tocar nada) — en ese caso devuelvo la fila tal cual.
  if (Object.keys(patch).length === 0) {
    const [game] = await db
      .select(gameColumns)
      .from(gamesTable)
      .where(eq(gamesTable.id, id))
      .limit(1);
    return game ?? null;
  }

  const [updated] = await db
    .update(gamesTable)
    .set(patch)
    .where(eq(gamesTable.id, id))
    .returning(gameColumns);
  return updated ?? null;
};
