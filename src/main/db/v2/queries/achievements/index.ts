// Consultas 2.0 de logros (paquete P5 de CONSULTAS.md §4). Léase antes
// `../README.md`. Todo síncrono, con `ctx` primero e ids de texto.

export {
  achievementKey,
  catalogSourceOf,
  dtoSourceOf,
  parseAchievementKey,
  unlockOriginOf,
  type AchievementKey,
  type AchievementRef,
  type UnlockFeed,
} from './ids';
export {
  fillHiddenDescriptions,
  getGoldbergCatalogItems,
  mergeRaCatalog,
  mergeSteamCatalog,
  normalizeCatalogItem,
  readCatalogItems,
  storeRaCatalog,
  storeSteamCatalog,
  type CatalogItem,
  type GoldbergCatalogItem,
  type RaCatalogDefinition,
  type SteamCatalogDefinition,
  type StoreCatalogResult,
  type StoreRaCatalogInput,
  type StoreSteamCatalogInput,
} from './catalog';
export {
  BULK_SAME_SECOND,
  markSteamUnlocksSynced,
  storeUnlocks,
  type StoreUnlocksInput,
  type UnlockInput,
  type UnlockToast,
} from './storeUnlocks';
export {
  storeRaProgress,
  type RaProgressDefinition,
  type StoreRaProgressInput,
  type StoreRaProgressResult,
} from './raSync';
export {
  PLACEMENT_GRACE_MS,
  getSessionWindows,
  placeUnlock,
  type SessionWindow,
  type UnlockPlacement,
} from './placement';
export { replaceUnlockPlacements } from './replacePlacements';
export {
  getGameAchievements,
  getSessionUnlocks,
  type GameAchievementsV2,
} from './gameAchievements';
export {
  getAchievementsOverview,
  type AchievementsOverviewV2,
  type AlmostThereV2,
  type PerfectGameV2,
} from './overview';
export { getGameCompletion, type SourceCompletion } from './completion';
export {
  getAchievementsRefreshTarget,
  getAchievementsStatus,
  getEmuUnlockTargets,
  getPendingAchievementsGames,
  getRaMatchedGames,
  getSteamLivePollGames,
  type AchievementsSourceStatus,
  type AchievementsStatusOptions,
  type AchievementsStatusV2,
  type AchievementsSyncTarget,
  type RaMatchedGame,
} from './status';
