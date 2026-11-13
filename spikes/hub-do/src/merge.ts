// Fusión por campo de §8.3, versión mínima para el spike (TypeScript puro).
import type { TransitRow } from './synthetic';

export type StoredRow = Record<string, unknown> & {
  id: string;
  syncCreated: string;
  syncUpdated: string;
  syncFields: string;
  syncDeleted: string | null;
};

const max = (a: string, b: string) => (a > b ? a : b);

/** Devuelve la fila a escribir, o null si la entrante no cambia nada (eco). */
export function mergeRow(
  existing: StoredRow | undefined,
  incoming: TransitRow,
): { kind: 'insert' | 'update'; values: Record<string, unknown> } | null {
  if (!existing) {
    let updated = incoming.created;
    for (const c of Object.values(incoming.clocks)) updated = max(updated, c);
    if (incoming.deleted) updated = max(updated, incoming.deleted);
    return {
      kind: 'insert',
      values: {
        id: incoming.id,
        ...incoming.fields,
        syncCreated: incoming.created,
        syncUpdated: updated,
        syncFields: JSON.stringify(incoming.clocks),
        syncDeleted: incoming.deleted,
      },
    };
  }

  const exClocks: Record<string, string> = JSON.parse(existing.syncFields || '{}');
  const outClocks = { ...exClocks };
  const patch: Record<string, unknown> = {};
  let changed = false;
  for (const [col, value] of Object.entries(incoming.fields)) {
    const inClock = incoming.clocks[col] ?? incoming.created;
    const exClock = exClocks[col] ?? existing.syncCreated;
    if (inClock > exClock) {
      if (existing[col] !== value) changed = true;
      patch[col] = value;
      outClocks[col] = inClock;
      if (exClocks[col] !== inClock) changed = true;
    }
  }
  // syncDeleted: gana el reloj mayor (simplificado: el valor ES el reloj)
  if (incoming.deleted && (!existing.syncDeleted || incoming.deleted > existing.syncDeleted)) {
    patch.syncDeleted = incoming.deleted;
    changed = true;
  }
  const created = incoming.created < existing.syncCreated ? incoming.created : existing.syncCreated;
  if (created !== existing.syncCreated) {
    patch.syncCreated = created;
    changed = true;
  }
  if (!changed) return null;
  let updated = existing.syncUpdated;
  for (const c of Object.values(outClocks)) updated = max(updated, c);
  if (patch.syncDeleted) updated = max(updated, patch.syncDeleted as string);
  patch.syncUpdated = updated;
  patch.syncFields = JSON.stringify(outClocks);
  return { kind: 'update', values: patch };
}
