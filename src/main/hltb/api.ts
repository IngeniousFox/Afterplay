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
//
// "Match" no basta: HLTB puede tener FICHA para el juego (título y año
// encajan) sin que nadie haya enviado tiempos todavía — típico de un juego
// recién salido o de nicho. Ese candidato pasa findBestMatch con los tres
// campos de completionTimes ausentes, y el llamante (hltb:refreshGame) lo
// trataba como éxito: guardaba tres null (sin cambio real) y avisaba "times
// found" de un juego que se quedaba exactamente como estaba. Se trata igual
// que "sin match": ni guarda nada nuevo ni finge un hallazgo que no lo es.
export const getHltbTimes = async (
  title: string,
  releaseYear: number | null,
): Promise<HltbTimes | null> => {
  const raw = await client.search(title, { limit: 10 });
  const candidates = hltbSearchResultSchema.parse(raw);

  const match = findBestMatch(candidates, title, releaseYear);
  if (!match) return null;

  const times: HltbTimes = {
    hltbMain: match.completionTimes.main ?? null,
    hltbMainExtras: match.completionTimes.mainExtra ?? null,
    hltbCompletionist: match.completionTimes.completionist ?? null,
  };
  if (
    times.hltbMain === null &&
    times.hltbMainExtras === null &&
    times.hltbCompletionist === null
  ) {
    return null;
  }
  return times;
};
