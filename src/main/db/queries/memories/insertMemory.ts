import { getDb } from '../..';
import type { NewGeneratedMemory } from '../../schema';
import { generatedMemoriesTable } from '../../schema';

// UPSERT por periodo: una fila por (scopeType, scopeKey) — regenerar PISA la
// prosa anterior en vez de añadir otra fila (ver el porqué del cambio en
// schema.ts: el insert-only original multiplicaba la tabla entera con cada
// ajuste de prompt/modelo). El índice único hace el conflicto detectable y
// este ON CONFLICT lo convierte en "el último gana", ahora en escritura.
export const insertMemory = async (memory: Omit<NewGeneratedMemory, 'id'>): Promise<void> => {
  await getDb()
    .insert(generatedMemoriesTable)
    .values(memory)
    .onConflictDoUpdate({
      target: [generatedMemoriesTable.scopeType, generatedMemoriesTable.scopeKey],
      set: {
        payload: memory.payload,
        sourceHash: memory.sourceHash,
        model: memory.model,
        promptVersion: memory.promptVersion,
        // La fecha del recuerdo es la de su ÚLTIMA escritura — es lo que
        // getLatestMemories enseña y lo que el estado stale/current compara.
        createdAt: memory.createdAt ?? new Date(),
      },
    });
};
