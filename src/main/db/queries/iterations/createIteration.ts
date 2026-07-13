import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { CreateIterationInput, Iteration } from '../../../../shared/types';
import { iterationColumns } from '../../projections';
import { iterationsTable } from '../../schema';

export const createIteration = async (input: CreateIterationInput): Promise<Iteration> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    // label es notNull en la tabla pero opcional al crear: si viene vacío se
    // autogenera "Playthrough N" contando los que ya tiene el juego. Va en
    // transacción para que el conteo y el insert no se crucen con otro create.
    let label = input.label?.trim();
    if (!label) {
      const siblings = await tx
        .select({ id: iterationsTable.id })
        .from(iterationsTable)
        .where(eq(iterationsTable.gameId, input.gameId));
      label = `Playthrough ${siblings.length + 1}`;
    }

    const [iteration] = await tx
      .insert(iterationsTable)
      .values({ ...input, label })
      .returning(iterationColumns);
    return iteration;
  });
};
