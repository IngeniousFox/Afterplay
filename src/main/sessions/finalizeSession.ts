import type { Session, SessionCloseReason, SessionFinalized } from '../../shared/types';
import { getIterationGameId } from '../db/queries/iterations/getIterationGameId';
import { createSessionEpilogue } from '../db/queries/sessionEpilogues/createSessionEpilogue';
import { closeSession } from '../db/queries/sessions/closeSession';
import { getSessionClosedInfo } from '../db/queries/sessions/getSessionClosedInfo';
import { scheduleSaveBackup } from '../saves/sessionHook';
import { notifySessionClosed } from '../watcher/notifySession';
import {
  buildSessionFinalized,
  getSessionFinalizationPolicy,
  type SessionFinalizationPolicy,
} from './finalizationPolicy';

export type SessionFinalizationResult = {
  session: Session;
  finalization: SessionFinalized;
  policy: SessionFinalizationPolicy;
};

const resolveGameId = async (session: Session, knownGameId?: number): Promise<number | null> => {
  if (knownGameId !== undefined) return knownGameId;
  if (session.iterationId === null) return null;
  return getIterationGameId(session.iterationId);
};

export const describeFinalizedSession = async (
  session: Session,
  reason: SessionCloseReason,
  knownGameId?: number,
): Promise<SessionFinalizationResult> => {
  const gameId = await resolveGameId(session, knownGameId);
  const finalization = buildSessionFinalized(session, reason, gameId);
  return {
    session,
    finalization,
    policy: getSessionFinalizationPolicy(finalization),
  };
};

export const finalizeSession = async (
  sessionId: number,
  endedAt: Date,
  reason: SessionCloseReason,
): Promise<SessionFinalizationResult | null> => {
  const session = await closeSession(sessionId, endedAt);
  if (!session) return null;
  return describeFinalizedSession(session, reason);
};

export const applySessionFinalizationEffects = async (
  result: SessionFinalizationResult,
): Promise<void> => {
  const { finalization, policy } = result;
  if (finalization.gameId === null) return;

  const epilogue = policy.createEpilogue ? await createSessionEpilogue(finalization) : null;

  if (policy.notify) {
    const info = await getSessionClosedInfo(
      finalization.sessionId,
      epilogue?.status === 'pending' ? epilogue.id : null,
    );
    if (info) notifySessionClosed(info);
  }

  if (policy.scheduleBackup) scheduleSaveBackup(finalization.gameId);
};
