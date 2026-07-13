import { HLTBClient } from 'hltb-client';
import { findBestMatch } from './match';
import { hltbSearchResultSchema } from './schemas';
import type { HltbTimes } from './types';

// Cliente singleton: cachea internamente el token anti-bot de HLTB (mismo
// espíritu que getValidToken de IGDB, pero aquí lo gestiona el paquete).
const client = new HLTBClient();

// Busca los tiempos de HLTB para un juego de IGDB. Recibe el año además del
// título porque el año es lo que desempata el juego base de sus ediciones/DLC
// (ver match.ts). Devuelve null si no hay match con confianza suficiente —
// entonces el widget del detalle simplemente no se muestra.
export const getHltbTimes = async (
  title: string,
  releaseYear: number | null,
): Promise<HltbTimes | null> => {
  const raw = await client.search(title, { limit: 10 });
  const candidates = hltbSearchResultSchema.parse(raw);

  const match = findBestMatch(candidates, title, releaseYear);
  if (!match) return null;

  return {
    hltbMain: match.completionTimes.main ?? null,
    hltbMainExtras: match.completionTimes.mainExtra ?? null,
    hltbCompletionist: match.completionTimes.completionist ?? null,
  };
};
