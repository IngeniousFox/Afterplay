import { findBestTitleMatch } from '../lib/titleMatch';
import type { HltbGame } from './schemas';

export const findBestMatch = (
  candidates: HltbGame[],
  targetName: string,
  targetYear: number | null,
): HltbGame | null =>
  findBestTitleMatch(
    candidates,
    (candidate) => candidate.name,
    (candidate) => candidate.releaseYear,
    targetName,
    targetYear,
  );
