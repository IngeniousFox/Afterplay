import type { GameExternalData } from '../igdb/types';
import type { UpdateGamePatch } from '../../shared/types';

// EL LOTE DE IGDB, APLICADO A UNA FILA, EN UN SOLO SITIO.
//
// Lo escribían DOS pasadas con la lista de columnas copiada a mano: la de
// biblioteca (external/refresh.ts) y la fase 1 del radar semanal
// (radar/pass.ts). Y no son alternativas: el radar, al terminar, lanza la otra
// sobre la biblioteca ENTERA, así que la misma semana se pide
// getGameExternalBatch dos veces para los mismos ids y se reescriben las
// mismas columnas dos veces. Dos copias de "qué trae el lote de IGDB" se
// separan solas — una columna nueva añadida a una de ellas llegaría por la
// otra vía solo cuando el candado del refresco externo estuviera libre.
//
// releaseYear va condicional y no en el bloque, que es la única regla no
// obvia de aquí: NUNCA se pone a null. De él dependen las stats (el donut de
// edad) y el matching de HowLongToBeat, así que un juego al que IGDB haya
// dejado de ponerle fecha no puede perder el año que ya tenía.
//
// Lo que NO entra aquí a propósito: lo de Steam y los tiempos de HLTB de la
// pasada grande, que no vienen de este lote y solo los escribe ella; y el
// `ratingsCheckedAt` de los juegos que IGDB ya NO devuelve, que cada pasada
// resuelve a su manera (refresh.ts lo estampa igual para no re-preguntarlos
// cada vez; el radar los salta, porque su mitad externa pasa justo después y
// ya lo hace).
export const buildIgdbBatchPatch = (data: GameExternalData, checkedAt: Date): UpdateGamePatch => ({
  ratingCritics: data.ratingCritics,
  ratingCriticsCount: data.ratingCriticsCount,
  ratingUsers: data.ratingUsers,
  ratingUsersCount: data.ratingUsersCount,
  summary: data.summary,
  igdbCollections: data.igdbCollections,
  releaseDate: data.releaseDate,
  releaseDatePrecision: data.releaseDatePrecision,
  ...(data.releaseYear !== null ? { releaseYear: data.releaseYear } : {}),
  ratingsCheckedAt: checkedAt,
});
