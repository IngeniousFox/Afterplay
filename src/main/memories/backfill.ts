import type { MemoriesStatus } from '../../shared/types';
import { enqueueMemories, isMemoriesQueueRunning } from './queue';
import { computeMemoriesOverview } from './status';

// Los caminos MANUALES del sistema de recaps (la tarjeta de Ajustes, §3.6).
// Ninguno genera nada por su cuenta: los dos encolan, que es lo que garantiza
// que un periodo no se pague dos veces y que las llamadas salgan de una en
// una. La detección automática vive aparte, en detect.ts.

export const getMemoriesStatus = async (): Promise<MemoriesStatus> => {
  const { overview } = await computeMemoriesOverview();
  return {
    current: overview.current,
    missing: overview.missing.length,
    stale: overview.stale.length,
    running: isMemoriesQueueRunning(),
  };
};

// El backfill del pasado: todos los periodos cerrados con actividad que aún
// no tienen recap — el gasto gordo inicial, que por eso es un botón y no
// algo de fondo. Devuelve en milisegundos: solo lee la lista y encola.
export const runMemoriesBackfill = async (): Promise<void> => {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const { overview } = await computeMemoriesOverview();
  enqueueMemories(overview.missing, 'manual');
};

// Regenerar los desactualizados (corregiste el pasado, §7.2) — siempre a
// mano: pagar por sorpresa es exactamente lo que no se hace.
export const regenerateStaleMemories = async (): Promise<void> => {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const { overview } = await computeMemoriesOverview();
  enqueueMemories(overview.stale, 'manual');
};
