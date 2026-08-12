import type { GameRow } from '../../shared/types';
import { withDbAccess } from '../db';
import { updateGame } from '../db/queries/games/updateGame';
import { getSteamGameData } from './steamData';
import { cacheImage } from '../images/cache';

// El "calentado" de un juego RECIÉN dado de alta: su carátula en la caché de
// imágenes y sus etiquetas y reseñas de Steam.
//
// Vivía suelto dentro de ipc/games.ts, y por eso solo lo corría el alta del
// ESCRITORIO. El alta desde el móvil (REMOTO.md §6.2) entra por el buzón, que
// llama a createPlannedGame directo sin pasar por la capa IPC — así que un
// juego añadido desde el teléfono se quedaba con su appid resuelto pero sin
// etiquetas, sin reseñas y sin imagen precargada. Lo destapó Ōkami HD, el
// único juego de una biblioteca de 952 con appid y sin pasada de SteamSpy.
//
// Sacarlo aquí es lo que hace que las dos vías no puedan volver a separarse.

// Fire-and-forget a propósito: crear/editar un juego no debe esperar a que
// termine de bajar la imagen de un CDN externo, eso haría el guardado lento
// sin necesidad (la propia cacheImage() es idempotente, y si esto falla la
// imagen se sigue mostrando bien vía getImageSrc en el momento de pintarla).
export const warmImageCache = (game: Pick<GameRow, 'coverUrl' | 'heroUrl'>): void => {
  if (game.coverUrl) {
    cacheImage(game.coverUrl, 'covers').catch((error) => {
      console.error('[images] fallo precacheando cover:', error);
    });
  }
  if (game.heroUrl) {
    cacheImage(game.heroUrl, 'heroes').catch((error) => {
      console.error('[images] fallo precacheando hero:', error);
    });
  }
};

// Etiquetas y reseñas de Steam del juego recién dado de alta (PLAN-TO-PLAY.md
// §6). Fire-and-forget por el mismo motivo que la caché de imágenes: guardar
// un juego no puede esperar a un tercero gratuito, y la ruta del botón "Add"
// ya se cuidó una vez de no alargarla. Si Steam no contesta, el refresco por
// lotes lo recogerá — y mientras tanto el juego se queda sin chips, que es
// exactamente lo mismo que le pasa a cualquier juego de consola.
export const warmSteamData = (game: Pick<GameRow, 'id' | 'steamAppId'>): void => {
  if (game.steamAppId === null) return;
  void getSteamGameData(game.steamAppId)
    .then(async (data) => {
      if (!data) return;
      await withDbAccess(async () =>
        updateGame(game.id, { ...data, steamSpyCheckedAt: new Date() }),
      );
    })
    .catch((error) => {
      console.error('[steam] fallo guardando etiquetas del alta:', error);
    });
};
