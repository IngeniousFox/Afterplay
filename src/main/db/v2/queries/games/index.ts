// Escrituras sobre juegos en 2.0 (paquete P2 de CONSULTAS.md §4): altas,
// edición, Plan, borrado, appid de Steam y reinicio de endless.

export { createGameWithDetails, type CreateGameOptions } from './createGameWithDetails';
export { createPlannedGame } from './createPlannedGame';
export { promotePlannedGame, type PromotePlannedGameOptions } from './promotePlannedGame';
export { canMoveToPlan, hasNoPlayRecords, moveToPlan } from './moveToPlan';
export { deleteGame } from './deleteGame';
export { updateGame, updateGameSaves, type SaveGamePatch } from './updateGame';
export { setSteamAppId } from './setSteamAppId';
export { resetEndlessState } from './resetEndlessState';
export { reorderUpNext, setPlanPinned } from './planPins';
export { readPlanEntry } from './planEntry';
export {
  findLiveGameIdForIgdb,
  planEnrichmentRequest,
  type EnrichmentRequest,
  type GameEnrichmentData,
  type NewGameChoices,
} from './newGame';
export {
  assertInitialStatus,
  writeInitialPapers,
  type InitialPlaythroughInput,
} from './initialPlaythrough';
export { GameWriteError, isGameWriteError, type GameWriteErrorCode } from './errors';
