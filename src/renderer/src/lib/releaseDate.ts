// Shared release rules accept the desktop Date and the JSON timestamp.
import type { GameRelease as SharedGameRelease } from '../../../shared/releaseDate';

export type GameRelease = SharedGameRelease<Date>;
export type { ReleaseCountdown } from '../../../shared/releaseDate';
export {
  formatRelease,
  isUnreleased,
  releaseSortKey,
  releaseCountdown,
  countdownLabel,
} from '../../../shared/releaseDate';
