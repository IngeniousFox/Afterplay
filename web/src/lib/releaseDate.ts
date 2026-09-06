// Shared release rules accept the desktop Date and the JSON timestamp.
import type { GameRelease as SharedGameRelease } from '../../../src/shared/releaseDate';

export type GameRelease = SharedGameRelease<number>;
export type { ReleaseCountdown } from '../../../src/shared/releaseDate';
export {
  formatRelease,
  isUnreleased,
  releaseSortKey,
  releaseCountdown,
  countdownLabel,
} from '../../../src/shared/releaseDate';
