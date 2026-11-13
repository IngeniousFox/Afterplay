// P1 · Biblioteca y ficha (lecturas) sobre el esquema 2.0 (CONSULTAS.md §4).
// Léase antes `../README.md`.
//
// Los tipos que devuelve son los compartidos con ids de texto
// (`GameDetail<string>` con `planHistory`, `OwnedGameRef<string>`…, en
// `src/shared/types.ts`). "¿Se puede devolver al Plan?" vive en `common/`
// (`canMoveToPlan`), porque la escritura de `games/` usa la misma condición.

export { getGameById } from './getGameById';
export { getGames } from './getGames';
export { getOwnedGames } from './getOwnedGames';
export { getPlannedGameExtras, getPlannedGames } from './getPlannedGames';
export { readPlanHistory } from './planHistory';
export { playthroughSessionTotals } from './playthroughTotals';
