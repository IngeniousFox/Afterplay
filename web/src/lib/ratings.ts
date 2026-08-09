import { BLUE, TEAL } from './status';

// Las TRES notas de un juego y las reglas para enseñarlas, portadas de
// src/renderer/src/lib/ratings.ts.
//
// Nunca se funden en una: son tres muestras de tres poblaciones distintas, y
// una media de las tres no dice de quién es la opinión.

// Umbrales mínimos de muestra. Distintos porque las tres pesan distinto: una
// reseña de crítica vale por varios votos sueltos de comunidad, y Steam juega
// en otra liga de volumen (cientos de miles frente a cientos).
export const MIN_CRITIC_COUNT = 3;
export const MIN_USER_COUNT = 10;
export const MIN_STEAM_REVIEWS = 30;

// Ni el verde de la casa (que es el acento de "en marcha") ni el azul de
// PLAYERS, del que hay que poder distinguirlo de un vistazo: el azul-acero de
// la propia marca de Steam.
export const STEAM_BLUE = '#66a3d2';
export const CRITICS_COLOR = TEAL;
export const PLAYERS_COLOR = BLUE;

export type GameRatingFields = {
  ratingCritics: number | null;
  ratingCriticsCount: number | null;
  ratingUsers: number | null;
  ratingUsersCount: number | null;
  steamPositive: number | null;
  steamNegative: number | null;
};

export type ResolvedRatings = {
  // Sobre 100 los tres, ya redondeados. null = sin muestra suficiente: por
  // debajo del umbral, un promedio de dos o tres votos miente más de lo que
  // informa, y un hueco honesto vale más que un número que parece fiable.
  critics: number | null;
  criticsCount: number;
  players: number | null;
  playersCount: number;
  steam: number | null;
  steamCount: number;
};

// UNA nota con la que ordenar el Plan. No es una media de las tres: es la
// MEJOR FUENTE disponible, por orden de autoridad — crítica agregada, si no la
// comunidad de IGDB, si no Steam. Mezclarlas daría un número que no es de
// nadie y castigaría a los juegos que solo tienen una.
export const bestRating = (game: GameRatingFields): number | null => {
  const { critics, players, steam } = resolveRatings(game);
  return critics ?? players ?? steam;
};

export const resolveRatings = (game: GameRatingFields): ResolvedRatings => {
  const criticsCount = game.ratingCriticsCount ?? 0;
  const playersCount = game.ratingUsersCount ?? 0;
  const steamCount = (game.steamPositive ?? 0) + (game.steamNegative ?? 0);

  return {
    critics:
      game.ratingCritics !== null && criticsCount >= MIN_CRITIC_COUNT
        ? Math.round(game.ratingCritics)
        : null,
    criticsCount,
    players:
      game.ratingUsers !== null && playersCount >= MIN_USER_COUNT
        ? Math.round(game.ratingUsers)
        : null,
    playersCount,
    steam:
      steamCount >= MIN_STEAM_REVIEWS
        ? Math.round(((game.steamPositive ?? 0) / steamCount) * 100)
        : null,
    steamCount,
  };
};
