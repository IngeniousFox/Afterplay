import { diceCoefficient, normalizeTitle } from '../lib/titleMatch';

// Categorías de IGDB (games.category) que tiene sentido ofrecer como "un
// juego que añadir a la biblioteca": el juego principal, remakes/remasters/
// ports (misma obra, re-publicada) y bundles. Deliberadamente fuera quedan
// dlc_addon(1), expansion(2), mod(5), episode(6), season(7), fork(12),
// pack(13) y update(14) — son piezas colgando de un juego que YA tiene su
// propia entrada base, no un resultado que alguien busca para añadir suelto.
const ALLOWED_CATEGORIES = new Set([0, 3, 8, 9, 10, 11]);

// Forma mínima que necesita el ranking, independiente del schema Zod exacto
// de IGDB — así esta lógica se puede probar/leer sin arrastrar el resto del
// cliente HTTP.
export type RankableGame = {
  id: number;
  name: string;
  category: number;
  versionParent: number | null;
  parentGame: number | null;
  collection: number | null;
  hasCover: boolean;
  totalRatingCount: number | null;
  follows: number | null;
  hypes: number | null;
  firstReleaseYear: number | null;
};

const tokenize = (text: string): string[] => normalizeTitle(text).split(' ').filter(Boolean);

// Boost logarítmico: los contadores de popularidad de IGDB van de 0 a
// decenas de miles, así que la diferencia entre 50 y 500 debe pesar mucho
// más que entre 50 000 y 500 000. cap evita que un solo campo (ej. un juego
// viral con follows desorbitados) se coma toda la puntuación de calidad de
// coincidencia de nombre.
const logBoost = (value: number | null, cap: number, scale: number): number =>
  value !== null && value > 0 ? Math.min(cap, Math.log10(value + 1) * scale) : 0;

const findDominantCollection = (games: RankableGame[]): number | null => {
  const counts = new Map<number, number>();
  for (const game of games) {
    if (game.collection === null) continue;
    counts.set(game.collection, (counts.get(game.collection) ?? 0) + 1);
  }

  let dominant: number | null = null;
  let bestCount = 1; // hace falta más de un candidato en la misma saga para que cuente como "dominante"
  for (const [collection, count] of counts) {
    if (count > bestCount) {
      dominant = collection;
      bestCount = count;
    }
  }
  return dominant;
};

// Dos bloques deliberadamente separados en vez de un totum revolutum:
//
// 1) "¿Esto es plausiblemente lo que se buscó?" — coincidencia de texto.
//    Sirve para FILTRAR candidatas razonables, pero un match exacto de
//    texto NO debería poder enterrar a un juego masivamente más conocido
//    solo por tener un título más corto/casual — probado en vivo: buscar
//    "cyberpunk" sacaba un indie oscuro literalmente llamado "Cyberpunk"
//    por delante de Cyberpunk 2077, y "zelda" sacaba una versión de
//    Game & Watch de 1989 por delante de Ocarina of Time.
// 2) "de las plausibles, ¿cuál es la que se quiso decir de verdad?" —
//    popularidad real (nº de valoraciones, follows, hype). Este bloque
//    tiene el techo más alto a propósito, para que pueda decidir el
//    desempate cuando el de arriba dejó varias candidatas razonables.
const scoreGame = (
  game: RankableGame,
  normalizedQuery: string,
  queryTokens: string[],
  dominantCollection: number | null,
): number => {
  const normalizedName = normalizeTitle(game.name);
  const nameTokens = tokenize(game.name);

  let textScore = 0;
  if (normalizedName === normalizedQuery) textScore += 25;
  else if (normalizedName.startsWith(normalizedQuery)) textScore += 12;

  const matchedTokenCount = queryTokens.filter((token) => nameTokens.includes(token)).length;
  const matchesAllTokens = matchedTokenCount === queryTokens.length;
  if (matchesAllTokens) textScore += 12;
  textScore += matchedTokenCount * 3;

  // Señal continua además de los checks exactos de arriba — recoge erratas y
  // coincidencias parciales que el check de tokens completos se deja fuera.
  textScore += diceCoefficient(normalizedName, normalizedQuery) * 10;

  // Título bastante más largo que la query Y que no la contiene entera:
  // probablemente ruido tangencial (compilaciones, "... Collection Vol. 3"…).
  if (!matchesAllTokens && normalizedName.length > normalizedQuery.length + 12) {
    textScore -= 8;
  }

  let popularityScore = 0;
  popularityScore += logBoost(game.totalRatingCount, 55, 18);
  popularityScore += logBoost(game.follows, 25, 10);
  popularityScore += logBoost(game.hypes, 18, 8);
  if (dominantCollection !== null && game.collection === dominantCollection) {
    popularityScore += 15;
  }
  if (game.firstReleaseYear !== null) {
    popularityScore += Math.min(8, Math.max(0, (game.firstReleaseYear - 2000) / 6));
  }

  let score = textScore + popularityScore;
  if (game.category === 0) score += 8; // juego principal, no remake/port/bundle
  if (!game.hasCover) score -= 80; // sin carátula es casi invisible en la UI — mejor que no encabece la lista

  return score;
};

// Filtra "morralla" (DLC/mods/ediciones sueltas) y ordena el resto por
// relevancia real: coincidencia de nombre con la búsqueda, si pertenece a la
// saga dominante entre los candidatos, y popularidad como desempate — no solo
// el orden de texto libre que devuelve IGDB tal cual.
export const filterAndRankGames = <T extends RankableGame>(games: T[], query: string): T[] => {
  // Sin exigir parentGame === null: IGDB lo usa también para spin-offs
  // standalone de pleno derecho (Dead Rising 2: Off the Record, Dishonored:
  // Death of the Outsider…) — juegos completos y jugables sin el original,
  // solo enlazados por compartir universo/motor. Esos SÍ son category 0
  // (main_game, se comprobó en vivo contra la API) y por eso ya pasan el
  // filtro de categoría de abajo; exigir además parentGame null los tiraba
  // fuera igualmente. versionParent sigue filtrando (eso es reediciones
  // literales del mismo producto, un caso distinto).
  const eligible = games.filter(
    (game) => ALLOWED_CATEGORIES.has(game.category) && game.versionParent === null,
  );
  if (eligible.length === 0) return [];

  const dominantCollection = findDominantCollection(eligible);
  const normalizedQuery = normalizeTitle(query);
  const queryTokens = tokenize(query);

  return eligible
    .map((game) => ({
      game,
      score: scoreGame(game, normalizedQuery, queryTokens, dominantCollection),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.game.totalRatingCount ?? 0) - (a.game.totalRatingCount ?? 0),
    )
    .map((entry) => entry.game);
};
