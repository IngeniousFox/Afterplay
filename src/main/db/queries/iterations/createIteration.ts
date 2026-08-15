import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { CreateIterationInput, Iteration } from '../../../../shared/types';
import { iterationColumns } from '../../projections';
import { iterationsTable } from '../../schema';
import { nextPlaythroughLabel } from './nextPlaythroughLabel';

export const createIteration = async (input: CreateIterationInput): Promise<Iteration> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    // label es notNull en la tabla pero opcional al crear: si viene vacío se
    // autogenera "Playthrough N" a partir de los que ya tiene el juego (la
    // regla, con su cicatriz, vive en nextPlaythroughLabel). Va en transacción
    // para que la lectura de los hermanos y el insert no se crucen con otro
    // create.
    let label = input.label?.trim();
    if (!label) {
      const siblings = await tx
        .select({ label: iterationsTable.label })
        .from(iterationsTable)
        .where(eq(iterationsTable.gameId, input.gameId));
      label = nextPlaythroughLabel(siblings.map((sibling) => sibling.label));
    }

    const [iteration] = await tx
      .insert(iterationsTable)
      .values({ ...input, label })
      .returning(iterationColumns);
    return iteration;
  });
};
