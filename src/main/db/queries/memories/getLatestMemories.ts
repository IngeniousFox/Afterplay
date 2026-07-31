import { desc } from 'drizzle-orm';
import { getDb } from '../..';
import type { RecapPayload } from '../../../../shared/memory/payload';
import { generatedMemoriesTable } from '../../schema';

// El recap vigente de cada periodo. Desde el paso a upsert (ver schema.ts)
// la tabla garantiza UNA fila por scope, así que esto es un select plano —
// el dedupe en memoria que había con el diseño insert-only ya no hace falta.

export type LatestMemory = {
  scopeType: 'month' | 'year';
  scopeKey: string;
  payload: RecapPayload;
  sourceHash: string;
  // Con qué versión del prompt y qué modelo se escribió: si cualquiera de
  // los dos cambió desde entonces, el periodo cuenta como desactualizado
  // (ver status.ts) — la prosa se escribiría distinta hoy.
  promptVersion: number;
  model: string;
  createdAt: Date;
};

export const getLatestMemories = async (): Promise<LatestMemory[]> => {
  const rows = await getDb()
    .select()
    .from(generatedMemoriesTable)
    .orderBy(desc(generatedMemoriesTable.createdAt), desc(generatedMemoriesTable.id));

  return rows.map((row) => ({
    scopeType: row.scopeType,
    scopeKey: row.scopeKey,
    payload: row.payload,
    sourceHash: row.sourceHash,
    promptVersion: row.promptVersion,
    model: row.model,
    createdAt: row.createdAt,
  }));
};
