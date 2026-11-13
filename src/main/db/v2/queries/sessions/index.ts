// Paquete P4 · Sesiones, watcher y emuladores (CONSULTAS.md §4). Léase antes
// `../README.md`.

export { closeSession, closeSessionIfOpen } from './close';
export { readSessionRow, toSessionDto, type SessionDto, type SessionWithGameDto } from './dto';
export { assignSession, deletePendingSession, deleteSession, updateSessionNote } from './edit';
export { createEmulator, deleteEmulator, getEmulators } from './emulators';
export { captureStoreError, type Captured } from './errors';
export {
  SESSION_LAST_SEEN_INTERVAL_MS,
  heartbeatSessions,
  pruneSessionBeats,
  readSessionBeat,
  type HeartbeatResult,
} from './heartbeat';
export { getOpenSessions, type OpenSession } from './open';
export {
  getAllSessions,
  getPendingSessions,
  getSessionClosedInfo,
  type GetAllSessionsOptions,
} from './read';
export { resolvePlaythroughForSession, type ResolvedPlaythrough } from './resolvePlaythrough';
export {
  createEmulatorSession,
  isEmulatorAlive,
  isGameAlive,
  startGameSession,
  type SessionOpener,
} from './start';
export { getWatchTargets, type WatchTarget } from './watchTargets';
