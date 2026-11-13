// P1 · Biblioteca y ficha (lecturas) sobre el esquema 2.0 (CONSULTAS.md §4).
// Léase antes `../README.md`.

export { canMoveToPlan, canMoveToPlanCondition } from './canMoveToPlan';
export { getGameById } from './getGameById';
export { getGames } from './getGames';
export { getOwnedGames } from './getOwnedGames';
export { getPlannedGameExtras, getPlannedGames } from './getPlannedGames';
export { readPlanHistory } from './planHistory';
export { playthroughSessionTotals } from './playthroughTotals';
export type {
  GameDetailV2,
  IterationDetailV2,
  IterationEdgeEventV2,
  OwnedGameRef,
  PlanHistory,
} from './types';
