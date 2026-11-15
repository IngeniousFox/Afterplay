// Consultas 2.0 del paquete P8 (CONSULTAS.md §4): recaps del Loop,
// curiosidades y radar de secuelas.

export {
  getLatestMemories,
  getMemory,
  getMemoryFacts,
  insertMemory,
  type InsertMemoryInput,
  type LatestMemory,
  type MemoryFacts,
  type MemoryStateEvent,
} from './memories';
export {
  chapterSignature,
  loadMemoryFactsSnapshot,
  memoryChapterFor,
  readLegacyGameIds,
  recheckMemorySignature,
  recheckStoredMemorySignatures,
  scopeFromKey,
  toLegacyIds,
  type AcceptedGeneration,
  type MemoryFactsSnapshot,
  type MemorySignatureCheck,
  type StoredMemoryCheck,
  type StoredMemorySignature,
} from './memorySignature';
export {
  getAllCuriosities,
  getGameCuriosities,
  getCuriositiesCounts,
  getPendingCuriositiesGames,
  storeCuriosities,
  type PendingCuriositiesGame,
  type StoreCuriositiesOptions,
} from './curiosities';
export {
  dismissRadarGame,
  listRadarGames,
  storeRadarDiscoveries,
  type RadarCandidate,
  type StoreRadarDiscoveriesResult,
} from './radar';
