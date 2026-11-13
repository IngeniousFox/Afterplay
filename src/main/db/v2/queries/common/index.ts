// Las piezas comunes de las consultas 2.0 (paquete P0 de CONSULTAS.md §4).
// Léase antes `../README.md`.

export { createQueryContext, type CreateQueryContextOptions, type QueryContext } from './context';
export {
  LAST_SEEN_INTERVAL_MS,
  ensureThisDevice,
  type EnsureThisDeviceResult,
  type ThisDeviceInfo,
} from './device';
export {
  emulatorIsAlive,
  gameIsAlive,
  liveEmulator,
  liveEmulatorInstall,
  liveGame,
  liveGameInstall,
  livePlanEntry,
  livePlaythrough,
  liveRow,
  liveSession,
  liveSpendEvent,
  liveStateEvent,
  liveUnlock,
  ofLiveGame,
  playthroughIsAlive,
} from './alive';
export {
  gameViewRows,
  readGameRow,
  readGameRows,
  toGameRow,
  viewCuriosities,
  viewInstall,
  viewMetadata,
  viewPlan,
  type GameViewRow,
} from './gameView';
export {
  autoPlaythroughLabel,
  customLabelToStore,
  effectivePlaythroughLabel,
  nextPlaythroughPosition,
  playthroughCreationOrder,
  playthroughPosition,
  playthroughPositions,
} from './labels';
export {
  CHECK_POLICIES,
  RA_REMATCH_AFTER_MS,
  answeredAt,
  checkIsDue,
  clearCheck,
  externalCheckId,
  isCheckDue,
  nextCheckAtFor,
  readCheck,
  recordCheck,
  writeCheck,
  type CheckPolicy,
  type RecheckAfter,
  type WriteCheckOptions,
} from './checks';
export { canMoveToPlan, canMoveToPlanCondition, hasLivePlanEntry } from './canMoveToPlan';
export { DEFAULT_CURRENCY } from './currency';
export {
  closeOpenOwnSessions,
  closeOwnSession,
  computeDurationSec,
  type CloseOpenSessionsResult,
  type CloseSessionInput,
  type CloseSessionResult,
} from './sessionsClose';
export { updateGame } from './updateGame';
