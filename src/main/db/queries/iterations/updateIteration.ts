import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Iteration, UpdateIterationPatch } from '../../../../shared/types';
import { iterationColumns } from '../../projections';
import { iterationsTable } from '../../schema';

// Igual que updateGame.ts — Drizzle peta con un .set() vacío, y guardar el
// modal de editar sin tocar la iteración (solo campos del juego) es legítimo.
export const updateIteration = async (
  id: number,
  patch: UpdateIterationPatch,
): Promise<Iteration | null> => {
  const db = getDb();

  if (Object.keys(patch).length === 0) {
    const [iteration] = await db
      .select(iterationColumns)
      .from(iterationsTable)
      .where(eq(iterationsTable.id, id))
      .limit(1);
    return iteration ?? null;
  }

  const [updated] = await db
    .update(iterationsTable)
    .set(patch)
    .where(eq(iterationsTable.id, id))
    .returning(iterationColumns);
  return updated ?? null;
};
