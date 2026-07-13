import { asc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { Iteration } from '../../../../shared/types';
import { iterationColumns } from '../../projections';
import { iterationsTable } from '../../schema';

// Filas crudas de la tabla — la versión enriquecida (horas, fechas derivadas,
// estado, sesiones) ya la monta games:getById con IterationDetail.
export const getIterationsByGame = async (gameId: number): Promise<Iteration[]> => {
  const db = getDb();
  return db
    .select(iterationColumns)
    .from(iterationsTable)
    .where(eq(iterationsTable.gameId, gameId))
    .orderBy(asc(iterationsTable.id));
};
