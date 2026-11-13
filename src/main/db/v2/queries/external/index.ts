// P6 · Refresco externo y claves (CONSULTAS.md §4). Léase antes `../README.md`.
//
// Cada refresco de hoy tiene aquí sus dos mitades de base, pensadas para el
// patrón que exige el driver síncrono:
//   (1) leer candidatos / la foto → (2) red, fuera de toda transacción →
//   (3) una transacción corta que RELEE la identidad del juego y escribe.
//
// Reglas comunes (ver `internal.ts`): solo se escribe caché (`game_metadata`,
// `external_checks`) y las claves externas de `games` con su `…Source`; nunca
// un `*Override` (salvo la adopción, R-01, y borrar uno igual al automático,
// §19.5) ni una clave manual; lo que no cambia no se escribe (F-33); un juego
// borrado no recibe nada (R-15).

export {
  failed,
  isFailure,
  type AppIdResolution,
  type HltbTimesData,
  type IgdbBatchData,
  type IgdbDetailData,
  type RefreshScope,
  type SourceFailure,
  type SteamStoreData,
} from './types';
export { igdbDetailToBatch } from './internal';
export { readExternalSnapshot, type ExternalSnapshot } from './snapshot';
export {
  applyIgdbAdoption,
  selectAdoptionCandidates,
  type AdoptionCandidate,
  type AdoptionLookup,
  type AdoptionOutcome,
} from './adoptIgdb';
export {
  applyRefreshPass,
  applyRefreshPassGame,
  needsAppIdLookup,
  needsAppIdReview,
  selectHltbOrphans,
  selectRefreshTargets,
  type HltbOrphan,
  type RefreshPassGameOutcome,
  type RefreshPassItem,
  type RefreshPassResult,
  type RefreshTarget,
} from './refreshPass';
export {
  applyRefreshGameResult,
  type RefreshGameNetworkResult,
  type RefreshGameOutcome,
} from './refreshGame';
export {
  applyRatingsRefreshResult,
  type RatingsRefreshNetworkResult,
  type RatingsRefreshOutcome,
} from './refreshRatings';
export {
  applySgdbResult,
  selectSgdbCandidates,
  type SgdbCandidate,
  type SgdbOutcome,
} from './sgdbBackfill';
export { applyWarmSteamData, type WarmSteamOutcome } from './warmSteamData';
export {
  applySteamAppIdBackfill,
  selectSteamAppIdBackfillCandidates,
  type SteamAppIdBackfillApplied,
  type SteamAppIdBackfillCandidate,
  type SteamAppIdBackfillResult,
} from './steamAppIdBackfill';
export {
  applyHltbRefreshResult,
  readHltbRefreshTarget,
  type HltbRefreshTarget,
} from './hltbRefresh';
export {
  applyRaMatchResults,
  forgetRaMatchChecks,
  readPlayedPlatforms,
  readRaRefreshTarget,
  selectRaCatalogPending,
  selectRaMatchCandidates,
  selectRaMatchedGames,
  selectRaUnmatchedPlatforms,
  type RaMatchApplied,
  type RaMatchCandidate,
  type RaMatchResult,
  type RaRefreshTarget,
  type RaSyncTarget,
} from './raMatch';
export { getExternalDataCounts, type ExternalDataCounts } from './status';
export { collectUsedImages, type UsedImage, type UsedImageType } from './usedImages';
export {
  applyRadarMembership,
  selectRadarMembershipTargets,
  type RadarMembershipTarget,
} from './radarMembership';
