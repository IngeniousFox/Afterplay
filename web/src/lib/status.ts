import { Bookmark, Circle, Moon, Pause, Play, Trophy, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { StateType } from '../api';
import {
  createStatusMeta,
  STATE_TO_STATUS_KEY,
  type StatusMeta as SharedStatusMeta,
} from '../../../src/shared/gameStatus';

export type StatusMeta = SharedStatusMeta<LucideIcon>;

const STATUS_META = createStatusMeta({ Bookmark, Circle, Moon, Pause, Play, Trophy, XCircle });

// The PWA reads database state names; desktop additionally edits UI names.
export const statusOf = (state: StateType | null): StatusMeta =>
  STATUS_META[state === null ? 'unplayed' : STATE_TO_STATUS_KEY[state]];

export { GREEN, AMBER, BLUE, TEAL, VIOLET } from '../../../src/shared/colors';
