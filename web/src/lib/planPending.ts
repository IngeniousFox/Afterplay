// Los pendientes del buzón aplicados encima del plan: la regla vive en
// src/shared/domain/planOrder.ts, la MISMA que usan reorderUpNext y el drenado
// del escritorio. Aquí había una copia a mano del reparto (`redistribute`) que
// el propio comentario reconocía como réplica; si se desviaba, la fila saltaba
// al drenarse. Solo quedan los nombres que ya usa la pantalla del Plan.
export type { PendingPlanGhost as GhostGame } from '../../../src/shared/domain/planOrder';
export { applyPendingPlanEntries as applyPending } from '../../../src/shared/domain/planOrder';
