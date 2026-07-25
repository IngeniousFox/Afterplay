import { diceCoefficient, normalizeTitle } from '../lib/titleMatch';

// Del nombre de una CARPETA al título con el que buscar en el catálogo.
//
// Una carpeta de juego casi nunca se llama como el juego: lleva la edición
// pegada ("Horizon Forbidden West Complete Edition"), el nombre del repack,
// la versión, el idioma… IGDB busca por texto y con esa cola no encuentra
// nada — caso real: esa carpeta daba CERO resultados y el juego aparecía
// como "no encontrado" teniéndolo ya en la biblioteca.

// Sufijos de EDICIÓN: no cambian de qué juego se trata, así que quitarlos es
// seguro. Ojo con lo que NO está en esta lista y podría parecer que debería:
// "Remastered", "Remake", "Definitive" y "Enhanced" se quedan FUERA a
// propósito — ahí sí suele haber una ficha distinta en el catálogo (Horizon
// Zero Dawn vs Horizon Zero Dawn Remastered son dos juegos con años y notas
// propias), y quitarlos casaría con el juego equivocado.
const EDITION_WORDS = [
  'complete edition',
  'complete',
  'goty edition',
  'goty',
  'game of the year edition',
  'game of the year',
  'deluxe edition',
  'deluxe',
  'ultimate edition',
  'ultimate',
  'gold edition',
  'gold',
  'premium edition',
  'premium',
  'standard edition',
  'anniversary edition',
  'collectors edition',
  'collector s edition',
  'digital edition',
  'special edition',
  'legacy edition',
  'edition',
];

// Ruido de repacks y descargas: releases de scene, versiones, idiomas.
const NOISE_PATTERNS: RegExp[] = [
  /\[[^\]]*\]/g, // [FitGirl Repack], [MULTi12]
  /\([^)]*\)/g, // (v1.2.3), (GOG)
  /\bv?\d+(\.\d+)+[a-z]?\b/gi, // v1.2.3, 1.0.4b
  /\bbuild\s*\d+\b/gi,
  /\brepack\b/gi,
  /\bfitgirl\b/gi,
  /\bdodi\b/gi,
  /\bcodex\b/gi,
  /\bplaza\b/gi,
  /\bskidrow\b/gi,
  /\bempress\b/gi,
  /\brune\b/gi,
  /\btenoke\b/gi,
  /\brazor1911\b/gi,
  /\bmulti\d*\b/gi,
  /\bpc\s*game\b/gi,
  /\bwin(dows)?\s*(32|64)\b/gi,
  /\bgog\b/gi,
  /\bearly\s*access\b/gi,
];

// "BomberCrew" -> "Bomber Crew", "ForzaHorizon6" -> "Forza Horizon 6".
export const humanizeFolderName = (name: string): string =>
  name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

const stripEdition = (value: string): string => {
  let result = ` ${normalizeTitle(value)} `;
  // De la más larga a la más corta: si no, "edition" se comería el "complete"
  // de "complete edition" y dejaría un "complete" suelto colgando.
  for (const word of EDITION_WORDS) {
    result = result.replace(new RegExp(`\\s${word}\\s`, 'g'), ' ');
  }
  return result.trim();
};

const stripNoise = (value: string): string => {
  let result = value;
  for (const pattern of NOISE_PATTERNS) result = result.replace(pattern, ' ');
  return result.replace(/\s+/g, ' ').trim();
};

// Las consultas a probar con el catálogo, de la más fiel a la más agresiva.
// El orden importa: se para en la primera que devuelva algo, así una carpeta
// limpia nunca paga el coste (ni el riesgo) de las variantes recortadas.
export const buildSearchQueries = (folderName: string): string[] => {
  const queries: string[] = [folderName];

  const push = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return;
    if (queries.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
    queries.push(trimmed);
  };

  push(humanizeFolderName(folderName));

  // El ruido se quita ANTES de deshacer el camelCase, no después: al revés,
  // "v2.1" se convertía en "v 2.1" y el patrón de versión ya no lo
  // reconocía, dejando una "v" huérfana en la consulta.
  const withoutNoise = humanizeFolderName(stripNoise(folderName));
  push(withoutNoise);

  const withoutEdition = stripEdition(withoutNoise);
  push(withoutEdition);

  // Último recurso: ir soltando la última palabra. "Horizon Forbidden West
  // Complete Edition" ya habrá casado antes, pero esto rescata las colas que
  // no están en ninguna lista ("… Bundle Pack Remake Deluxe").
  const words = withoutEdition.split(' ');
  for (let count = words.length - 1; count >= 2 && queries.length < 6; count--) {
    push(words.slice(0, count).join(' '));
  }

  return queries;
};

// ¿Este candidato ya está en la biblioteca? Por SIMILITUD, no por igualdad.
//
// La comparación exacta fallaba justo en el caso que importa: con "Horizon
// Forbidden West" ya añadido, la carpeta "Horizon Forbidden West Complete
// Edition" se daba por nueva y salía a la lista pidiendo que la añadieras
// otra vez. Se compara el nombre YA limpio de edición y ruido, y se acepta
// desde 0,82 de similitud de Dice — suficiente para absorber una edición o
// un subtítulo suelto, y lejos de confundir dos juegos de la misma saga
// (Horizon Zero Dawn vs Horizon Forbidden West se quedan en 0,63).
const LIBRARY_MATCH_THRESHOLD = 0.82;

export const findInLibrary = (
  candidateTitles: string[],
  libraryTitles: string[],
): string | null => {
  const normalizedLibrary = libraryTitles.map((title) => ({
    title,
    normalized: normalizeTitle(title),
  }));

  for (const candidate of candidateTitles) {
    // Mismo orden que en buildSearchQueries: ruido primero, camelCase después.
    const normalized = stripEdition(humanizeFolderName(stripNoise(candidate)));
    if (!normalized) continue;

    for (const entry of normalizedLibrary) {
      const entryClean = stripEdition(entry.normalized);
      if (
        normalized === entryClean ||
        diceCoefficient(normalized, entryClean) >= LIBRARY_MATCH_THRESHOLD
      ) {
        return entry.title;
      }
    }
  }
  return null;
};
