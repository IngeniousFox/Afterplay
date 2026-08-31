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

// La proyección va ESCRITA y no un `.select()` pelado, que es lo que había:
// el select sin argumentos infiere desde el modelo entero de la tabla y con
// este tamaño de proyecto TypeScript se queda sin presupuesto de
// instanciación — la inferencia se degrada a `any` de forma no determinista,
// y el error salta en un fichero u otro según qué se compilara antes (el
// porqué largo, en db/projections.ts). Este era el último select pelado que
// quedaba en el main. Va aquí y no en projections.ts porque no es una fila
// completa: `id` no sale de la consulta, solo ordena.
export const getLatestMemories = async (): Promise<LatestMemory[]> =>
  getDb()
    .select({
      scopeType: generatedMemoriesTable.scopeType,
      scopeKey: generatedMemoriesTable.scopeKey,
      payload: generatedMemoriesTable.payload,
      sourceHash: generatedMemoriesTable.sourceHash,
      promptVersion: generatedMemoriesTable.promptVersion,
      model: generatedMemoriesTable.model,
      createdAt: generatedMemoriesTable.createdAt,
    })
    .from(generatedMemoriesTable)
    .orderBy(desc(generatedMemoriesTable.createdAt), desc(generatedMemoriesTable.id));
