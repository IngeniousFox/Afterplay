import { BLUE, TEAL } from './colors';

// Las TRES notas de un juego y las reglas para enseñarlas — un solo sitio,
// porque las pintan dos pantallas distintas (la card del sidebar de la ficha
// y los chips de cada fila del Plan) y con los umbrales copiados en las dos
// bastaría tocar uno para que la ficha y la lista dijeran cosas distintas del
// mismo juego.
//
// Nunca se funden en una (PLAN-TO-PLAY.md §9, y el mismo criterio con el que
// nacieron las dos de IGDB): son tres muestras distintas de tres poblaciones
// distintas, y una media de las tres no dice de quién es la opinión.

// Umbrales mínimos de muestra. Distintos porque las tres pesan distinto: una
// reseña de crítica vale por varios votos sueltos de comunidad, y Steam juega
// en otra liga de volumen (cientos de miles frente a cientos).
export const MIN_CRITIC_COUNT = 3;
export const MIN_USER_COUNT = 10;
export const MIN_STEAM_REVIEWS = 30;

// El color de Steam. Ni el verde de la casa (que es el acento de "en marcha")
// ni el azul de PLAYERS, del que hay que poder distinguirlo de un vistazo:
// el azul-acero de la propia marca, que además es el que el ojo ya asocia a
// "esto viene de Steam".
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
    // El % de reseñas positivas de Steam: la nota de usuarios con la muestra
    // más grande que existe (Hollow Knight ronda las 415.000 frente a los
    // ~1.400 votos que tiene en IGDB).
    steam:
      steamCount >= MIN_STEAM_REVIEWS
        ? Math.round(((game.steamPositive ?? 0) / steamCount) * 100)
        : null,
    steamCount,
  };
};

// UNA nota con la que poder ordenar el Plan por "mejor valorado" (§2.4). No
// es una media de las tres: es la MEJOR FUENTE disponible de cada juego, por
// orden de autoridad — crítica agregada, si no la comunidad de IGDB, si no
// Steam. Mezclarlas daría un número que no es de nadie y que además
// castigaría a los juegos que solo tienen una: un clásico de SNES con 88 de
// comunidad quedaría por debajo de un juego moderno con 85 de crítica y 85 de
// comunidad, sin que eso signifique nada.
//
// null = este juego no tiene ninguna nota con muestra suficiente; la lente lo
// manda al final en vez de fingirle un cero.
export const bestRating = (game: GameRatingFields): number | null => {
  const { critics, players, steam } = resolveRatings(game);
  return critics ?? players ?? steam;
};
