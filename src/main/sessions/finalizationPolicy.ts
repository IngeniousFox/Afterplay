import type { Session, SessionCloseReason, SessionFinalized } from '../../shared/types';

export const SESSION_EPILOGUE_MIN_DURATION_SEC = 5 * 60;

type FinalizableSession = Pick<
  Session,
  'id' | 'iterationId' | 'startedAt' | 'endedAt' | 'durationSec' | 'note'
>;

export type SessionFinalizationPolicy = {
  createEpilogue: boolean;
  notify: boolean;
  scheduleBackup: boolean;
};

const TECHNICAL_CLOSE_REASONS = new Set<SessionCloseReason>([
  'lock',
  'suspend',
  'startup_recovery',
]);

export const isMeaningfulSession = (
  session: Pick<FinalizableSession, 'durationSec' | 'note'>,
  reason: SessionCloseReason,
): boolean =>
  reason === 'terminal_state' ||
  (session.durationSec ?? 0) >= SESSION_EPILOGUE_MIN_DURATION_SEC ||
  Boolean(session.note?.trim());

export const buildSessionFinalized = (
  session: FinalizableSession,
  reason: SessionCloseReason,
  gameId: number | null,
): SessionFinalized => {
  if (session.endedAt === null) {
    throw new Error(`La sesión ${session.id} sigue abierta y no se puede finalizar`);
  }

  return {
    sessionId: session.id,
    gameId,
    iterationId: session.iterationId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSec: session.durationSec ?? 0,
    reason,
    meaningful: isMeaningfulSession(session, reason),
  };
};

export const getSessionFinalizationPolicy = (
  finalization: SessionFinalized,
): SessionFinalizationPolicy => ({
  createEpilogue: finalization.meaningful && !TECHNICAL_CLOSE_REASONS.has(finalization.reason),
  // Stop y cambio terminal ocurren dentro de la app. process_exit es el
  // único cierre que necesita toast/notificación nativa.
  notify: finalization.reason === 'process_exit',
  // Stop puede cerrar solo el tracking mientras el proceso sigue escribiendo.
  scheduleBackup:
    finalization.reason === 'process_exit' || finalization.reason === 'emulator_assignment',
});
