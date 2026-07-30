import { findBestTitleMatch, unixSecondsToUtcYear } from '../lib/titleMatch';
import type { SgdbGame } from './schemas';

// SteamGridDB fecha sus juegos en segundos Unix, no en un año suelto como
// IGDB o HLTB — de ahí la conversión antes de poder desempatar por año.
const toYear = (candidate: SgdbGame): number | undefined =>
  candidate.release_date ? unixSecondsToUtcYear(candidate.release_date) : undefined;

// El gemelo de hltb/match.ts para SteamGridDB: misma heurística compartida
// (lib/titleMatch), solo cambia de dónde salen título y año.
export const findBestMatch = (
  candidates: SgdbGame[],
  targetName: string,
  targetYear: number | null,
): SgdbGame | null =>
  findBestTitleMatch(candidates, (candidate) => candidate.name, toYear, targetName, targetYear);
