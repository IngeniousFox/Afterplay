// Paquete P4 · Sesiones, watcher y emuladores (CONSULTAS.md §4). Léase antes
// `../README.md`.

export { closeSession, closeSessionIfOpen } from './close';
export { readSessionRow, toSessionDto } from './dto';
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
  countAllSessions,
  getAllSessions,
  getPendingSessions,
  getSessionClosedInfo,
  type GetAllSessionsOptions,
} from './read';
export { resolvePlaythroughForSession, type ResolvedPlaythrough } from './resolvePlaythrough';
export { TIMER_CLOSE_COLUMNS, timerForeignWriteRule } from './timerRule';
export {
  LIVE_ELSEWHERE_MS,
  beatTimer,
  getActiveTimer,
  startTimer,
  stopTimer,
  type ActiveTimer,
  type StartTimerResult,
  type StopTimerResult,
  type StoppedTimer,
} from './timer';
export {
  createEmulatorSession,
  isEmulatorAlive,
  isGameAlive,
  startGameSession,
  type SessionOpener,
} from './start';
export { getWatchTargets, type WatchTarget } from './watchTargets';
