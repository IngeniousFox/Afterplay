import { findBestTitleMatch } from '../lib/titleMatch';
import type { HltbGame } from './schemas';

// Elegir qué resultado de HowLongToBeat corresponde al juego que se está
// añadiendo. Toda la heurística real (parecido de título, desempate por año,
// umbral mínimo) vive en lib/titleMatch, compartida con SteamGridDB: esto
// solo dice de qué campos de un HltbGame se saca cada cosa.
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
