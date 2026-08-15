import { findSteamAppIdCorrections } from '../igdb/api';

// LA CORRECCIÓN DEL APPID GUARDADO, EN UN SOLO SITIO.
//
// Las tres rutas de refresco —la pasada de biblioteca (refresh.ts), el botón
// "actualízalo todo" de la ficha (refreshGame.ts) y el ⟳ de la card Ratings
// (refreshRatings.ts)— tenían escrita la misma llamada, el mismo aviso por
// consola y el mismo criterio, cada una por su cuenta. Tres copias de una
// regla que decide QUÉ JUEGO es un juego acaban separándose: basta con que
// alguien afine el mensaje o el criterio en una sola.
//
// Qué corrige y qué no lo decide findSteamAppIdCorrections (igdb/api.ts): el
// appid que apunta al playtest del propio juego, a otro producto distinto o
// —en un juego con juego base— a cualquier cosa que no sea el appid del base;
// y uno bueno no se toca jamás.
//
// El AVISO por consola vive aquí y no en quien llama porque hoy es el único
// rastro visible de que a un juego le ha cambiado la identidad de Steam —y
// con ella sus etiquetas, sus reseñas y sus logros—: el parte que ve el
// usuario sigue diciendo 'had-it' (ver GameFullRefreshResult en igdb/types.ts).

export type AppIdCandidate = { igdbId: number; steamAppId: number; title: string };

// Por lotes, para la pasada de biblioteca. Devuelve igdbId -> appid bueno, y
// solo de los que hay que corregir.
//
// NO se traga los errores, al revés que su gemela de un juego: la pasada
// grande escribe todo o nada al final, y su try/catch ya convierte cualquier
// fallo de IGDB en el evento de "no se pudo" sin haber tocado una fila. Aquí
// tragárselo sería decidir por ella.
export const findSteamAppIdFixes = async (
  games: AppIdCandidate[],
): Promise<Map<number, number>> => {
  const fixes = await findSteamAppIdCorrections(
    games.map((game) => ({ igdbId: game.igdbId, steamAppId: game.steamAppId })),
  );
  for (const game of games) {
    const better = fixes.get(game.igdbId);
    // Solo ASCII en consola, convencion de la casa: la consola de Windows no
    // siempre usa UTF-8.
    // "no es el que debe usar" y no "no era el de este juego": desde el MOTIVO
    // 3 la correccion tambien alcanza al hijo que llevaba su PROPIO appid, que
    // si es suyo — lo que pasa es que sus logros viven en el del juego base.
    if (better !== undefined) {
      console.log(
        `[steam] ${game.title}: el appid ${game.steamAppId} no es el que este juego debe usar, se corrige a ${better}`,
      );
    }
  }
  return fixes;
};

// Para UN juego, que es como lo piden los dos botones de la ficha.
//
// Aquí SÍ se traga el error, y a propósito: en la ficha cada fuente se cae
// sola —que IGDB no conteste no puede llevarse por delante los tiempos, las
// reseñas ni los logros— y no poder revisar el appid solo significa dejarlo
// como estaba.
//
// undefined = no hay nada que corregir, o no se pudo mirar. Los dos casos se
// tratan igual en quien llama, que es justo lo que hace falta.
export const findSteamAppIdFix = async (game: AppIdCandidate): Promise<number | undefined> =>
  findSteamAppIdFixes([game])
    .then((fixes) => fixes.get(game.igdbId))
    .catch((error: unknown) => {
      console.warn('[refresh] no se pudo revisar el appid de Steam:', error);
      return undefined;
    });
