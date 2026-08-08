import type { SteamTag } from '../igdb/types';
import type { SteamReviewCounts } from '../steam/reviews';
import { getSteamReviewCounts } from '../steam/reviews';
import { getSteamTagsForApp } from '../steam/tags';

// Todo lo que la app le pide a Steam sobre un juego, en una sola llamada —
// para que los tres sitios que lo necesitan (el alta, el barrido de
// biblioteca y el botón de la ficha) pidan LO MISMO y no haya que acordarse
// de sumar una fuente nueva en tres archivos.
//
// Las dos salen ya de la propia Steam, cada una por su endpoint —
// las etiquetas por la API de la tienda (steam/tags.ts) y las reseñas por el
// resumen de reseñas (steam/reviews.ts). SteamSpy, que era de donde venían
// las dos, está fuera de la app: el recibo con los números medidos está en la
// cabecera de esos dos archivos.
//
// Van en PARALELO: son dos peticiones independientes y pedirlas en fila
// sumaría dos esperas por juego.

export type SteamGamePatch = {
  steamTags?: SteamTag[] | null;
  steamPositive?: number | null;
  steamNegative?: number | null;
};

// Devuelve SOLO los campos que se han podido averiguar, no un objeto con
// huecos a null. La diferencia importa: quien llama esparce esto sobre la
// fila del juego, así que un null aquí BORRARÍA el dato bueno de la última
// vez. Es la regla de siempre de las fuentes externas — que hoy Steam no
// conteste no invalida las etiquetas de ayer.
//
// null = ninguna de las dos supo nada; no hay nada que escribir.
//
// Vive aparte de getSteamGameData porque el barrido de biblioteca NO puede
// usar esa función: allí las etiquetas se piden por lotes de 50 para toda la
// biblioteca de golpe y solo las reseñas van de una en una, así que las dos
// mitades llegan por caminos distintos y se juntan aquí igualmente. Una sola
// regla de mezcla, y no dos copias que se separen con el tiempo.
export const mergeSteamPatch = (
  tags: SteamTag[] | null,
  reviews: SteamReviewCounts | null,
): SteamGamePatch | null => {
  const patch: SteamGamePatch = {};
  if (tags !== null) patch.steamTags = tags;
  if (reviews !== null) {
    patch.steamPositive = reviews.steamPositive;
    patch.steamNegative = reviews.steamNegative;
  }
  return Object.keys(patch).length > 0 ? patch : null;
};

// Lo de UN juego, para el alta y el botón de la ficha.
export const getSteamGameData = async (appId: number): Promise<SteamGamePatch | null> => {
  const [tags, reviews] = await Promise.all([
    getSteamTagsForApp(appId),
    getSteamReviewCounts(appId),
  ]);
  return mergeSteamPatch(tags, reviews);
};
