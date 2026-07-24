import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Iteration, UpdateIterationPatch } from '../../../../shared/types';
import { iterationColumns } from '../../projections';
import { iterationsTable } from '../../schema';
import { updateOrFetch } from '../updateOrFetch';

// Guardar el modal de editar sin tocar la iteración (solo campos del juego)
// es legítimo — de ahí el patch vacío que updateOrFetch resuelve con un fetch.
export const updateIteration = async (
  id: number,
  patch: UpdateIterationPatch,
): Promise<Iteration | null> => {
  const db = getDb();

  return updateOrFetch(
    patch,
    async () => {
      const [iteration] = await db
        .select(iterationColumns)
        .from(iterationsTable)
        .where(eq(iterationsTable.id, id))
        .limit(1);
      return iteration ?? null;
    },
    async () => {
      const [updated] = await db
        .update(iterationsTable)
        .set(patch)
        .where(eq(iterationsTable.id, id))
        .returning(iterationColumns);
      return updated ?? null;
    },
  );
};
