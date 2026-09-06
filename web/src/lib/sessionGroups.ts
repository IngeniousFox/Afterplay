import type { SessionWithGame } from '../api';
import {
  getSessionGroup as getBucket,
  groupPageByDate as groupSharedPage,
} from '../../../src/shared/sessionGroups';

// The PWA needs the same labels but has no desktop diary recap to attach.
export const getSessionGroup = (date: Date, now: Date): string => getBucket(date, now).label;

export type SessionGroup = { label: string; sessions: SessionWithGame[] };

export const groupPageByDate = (sessions: SessionWithGame[], now: Date): SessionGroup[] =>
  groupSharedPage(sessions, now).map(({ label, sessions }) => ({ label, sessions }));
