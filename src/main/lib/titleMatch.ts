// Coincidencia de títulos genérica, compartida entre HLTB y SteamGridDB —
// los dos son buscadores por texto libre que devuelven ediciones/DLC/mods
// sueltos junto al juego base, y en los dos el año de IGDB es el desempate
// que los separa.

// Año UTC a partir de un unix timestamp en segundos — igdb/api.ts (fecha de
// lanzamiento) y sgdb/match.ts (fecha de lanzamiento del candidato) parten
// del mismo dato crudo y solo difieren en cómo envuelven la nulabilidad.
export const unixSecondsToUtcYear = (unixSeconds: number): number =>
  new Date(unixSeconds * 1000).getUTCFullYear();

// Minúsculas, fuera apóstrofos, los separadores (: - –) pasan a espacio, el
// resto de puntuación se quita y los espacios se colapsan. Los números
// (romanos o no) se dejan tal cual — las fuentes suelen coincidir ahí, y
// tocarlos daría más falsos positivos que otra cosa.
//
// Exportada: también la usa igdb/rank.ts para puntuar resultados de
// búsqueda — mismo problema de fondo (comparar títulos de forma tolerante),
// no tiene sentido reimplementarlo ahí.
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[:\-–—/]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Bigramas de una cadena, para el coeficiente de Dice.
const bigrams = (value: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const gram = value.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
};

// Similitud de Dice (0..1) sobre bigramas: robusta a palabras extra y a
// pequeñas variaciones, mejor que "igual o no" para títulos con sufijos.
export const diceCoefficient = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  let overlap = 0;
  for (const [gram, countA] of gramsA) {
    const countB = gramsB.get(gram);
    if (countB) overlap += Math.min(countA, countB);
  }

  const total = a.length - 1 + (b.length - 1);
  return (2 * overlap) / total;
};

// Umbral mínimo de similitud de NOMBRE (antes del bonus de año) para aceptar
// un match. Por debajo preferimos "sin datos" a colar un juego equivocado.
const MIN_NAME_SIMILARITY = 0.5;

// getName/getYear son funciones porque cada fuente (HLTB, SteamGridDB...)
// tiene su propia forma de candidato — esto no sabe nada de ninguna en
// concreto, solo sabe puntuar nombre+año.
export const findBestTitleMatch = <T>(
  candidates: T[],
  getName: (candidate: T) => string,
  getYear: (candidate: T) => number | undefined,
  targetName: string,
  targetYear: number | null,
): T | null => {
  const normalizedTarget = normalizeTitle(targetName);
  let best: T | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const nameSimilarity = diceCoefficient(normalizeTitle(getName(candidate)), normalizedTarget);
    if (nameSimilarity < MIN_NAME_SIMILARITY) continue;

    // El año es el desempate fuerte: separa el juego base de sus
    // ediciones/DLC, que comparten casi todo el nombre pero salieron otro año.
    const candidateYear = getYear(candidate);
    let yearBonus = 0;
    if (targetYear !== null && candidateYear !== undefined) {
      const diff = Math.abs(candidateYear - targetYear);
      yearBonus = diff === 0 ? 0.15 : diff === 1 ? 0.05 : -0.2 * Math.min(diff, 5);
    }

    const score = nameSimilarity + yearBonus;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
};
