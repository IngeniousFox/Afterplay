import { findBestTitleMatch, unixSecondsToUtcYear } from '../lib/titleMatch';
import type { SgdbGame } from './schemas';

const toYear = (candidate: SgdbGame): number | undefined =>
  candidate.release_date ? unixSecondsToUtcYear(candidate.release_date) : undefined;

export const findBestMatch = (
  candidates: SgdbGame[],
  targetName: string,
  targetYear: number | null,
): SgdbGame | null =>
  findBestTitleMatch(candidates, (candidate) => candidate.name, toYear, targetName, targetYear);
