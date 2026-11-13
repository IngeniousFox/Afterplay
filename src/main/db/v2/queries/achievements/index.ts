// Consultas 2.0 de logros (paquete P5 de CONSULTAS.md §4). Léase antes
// `../README.md`. Todo síncrono, con `ctx` primero e ids de texto.
//
// Las lecturas devuelven los DTO compartidos con ids de texto, que ya llevan
// el completado por fuente (R-11): `GameAchievements<string>.completion`,
// `source` en `perfectGames`/`almostThere` de `AchievementsOverview<string>`,
// `AchievementsStatus<string>.bySource` y `SourceCompletion` (shared/types.ts).

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
export { getGameAchievements, getSessionUnlocks } from './gameAchievements';
export { getAchievementsOverview } from './overview';
export { getGameCompletion } from './completion';
export { getReliableUnlocks } from './reliableUnlocks';
export {
  getAchievementsRefreshTarget,
  getAchievementsStatus,
  getEmuUnlockTargets,
  getPendingAchievementsGames,
  getRaMatchedGames,
  getSteamLivePollGames,
  type AchievementsStatusOptions,
  type AchievementsSyncTarget,
  type RaMatchedGame,
} from './status';
