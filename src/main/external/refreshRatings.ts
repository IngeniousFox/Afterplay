import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { updateGame } from '../db/queries/games/updateGame';
import { gamesTable } from '../db/schema';
import { getGameDetails, resolveAchievementsSteamAppId } from '../igdb/api';
import type { GameRatings, RatingsRefreshResult } from '../igdb/types';
import type { UpdateGamePatch } from '../../shared/types';
import { getSteamReviewCounts } from '../steam/reviews';
import { findSteamAppIdFix } from './steamAppIdFix';

// El ⟳ de la card "Ratings" de la ficha — las TRES notas que esa card enseña.
//
// Nació preguntándole solo a IGDB (se llamaba igdb:refreshRatings) porque
// entonces la card tenía dos tiles y los dos eran suyos. Al entrar el tile de
// STEAM quedó un botón de refrescar que dejaba fuera a un tercio de lo que
// tenía debajo: pulsabas, la crítica y los jugadores se movían, y el % de
// Steam se quedaba clavado sin decir por qué. Un botón de refrescar refresca
// lo que se ve encima, o miente.
//
// Sigue SIN ser el botón de "actualiza este juego entero" (ese está en la
// barra de acciones, ver refreshGame.ts): aquí no entran ni HowLongToBeat ni
// los logros, que no son notas y no salen en esta card.
//
// De paso guarda todo lo que el detalle de IGDB ya trae en la MISMA respuesta
// —sinopsis, sagas, fecha completa con su precisión— porque pedirlo cuesta
// cero y dejarlo sin guardar sería tirar el viaje a medias. Lo que se DEVUELVE
// siguen siendo solo las notas, que es lo único que la card necesita.
//
// Los tramos que tocan la DB van cada uno en su withDbAccess, con la red
// FUERA: retener el candado durante una llamada a internet bloquearía un swap
// de conexión en caliente por una espera que no tiene nada que ver con la
// base de datos.
//
// null = ese juego ya no está en la biblioteca.
export const refreshGameRatings = async (gameId: number): Promise<RatingsRefreshResult | null> => {
  const [game] = await withDbAccess(async () =>
    getDb()
      .select({
        title: gamesTable.title,
        igdbId: gamesTable.igdbId,
        steamAppId: gamesTable.steamAppId,
      })
      .from(gamesTable)
      .where(eq(gamesTable.id, gameId))
      .limit(1),
  );
  if (!game) return null;

  const patch: UpdateGamePatch = {};
  const now = new Date();

  // igdbId null = no está en el catálogo de IGDB (existe en Steam y ellos aún
  // no lo tienen). Sin id no hay nada que pedir; la pata de Steam de más abajo
  // sigue igual, que es justo la gracia de que sean fuentes independientes.
  const detail = game.igdbId === null ? null : await getGameDetails(game.igdbId);

  let ratings: GameRatings | null = null;
  if (detail) {
    ratings = {
      ratingCritics: detail.ratingCritics,
      ratingCriticsCount: detail.ratingCriticsCount,
      ratingUsers: detail.ratingUsers,
      ratingUsersCount: detail.ratingUsersCount,
    };
    Object.assign(patch, ratings, {
      summary: detail.summary,
      igdbCollections: detail.igdbCollections,
      releaseDate: detail.release?.date ?? null,
      releaseDatePrecision: detail.release?.precision ?? null,
      ratingsCheckedAt: now,
    } satisfies UpdateGamePatch);
    // releaseYear se refresca pero NUNCA se pone a null: de él dependen las
    // stats y el matching de HowLongToBeat (misma regla que en refresh.ts).
    if (detail.releaseYear !== null) patch.releaseYear = detail.releaseYear;
  }
  // detail === null: el juego ya no está en el catálogo de IGDB (rarísimo,
  // pero pasa). No se borra lo que había —un dato viejo sigue siendo mejor que
  // ninguno— y la pata de Steam sigue adelante igual: son fuentes distintas y
  // que una se caiga no es motivo para renunciar a la otra.

  // El appid, con dos preguntas distintas según el juego lo tenga o no.
  //
  // Si FALTA y el detalle de IGDB lo trae: es gratis (ya viajó dentro de esa
  // misma respuesta) y es la única forma de que el tile de STEAM llegue a
  // existir para un juego que aún no lo tenía.
  //
  // Si lo TIENE ya no vale el viejo "es identidad del juego, no se re-resuelve
  // por gusto": hay un tercer estado, "tiene uno y es el equivocado" — el del
  // playtest del propio juego, o el de OTRO producto (los dos motivos están en
  // findSteamAppIdCorrections, igdb/api.ts).
  //
  // Y aquí no es teoría, porque el % de ESTA card sale de ese appid: se le pide
  // a la propia Steam, al resumen de reseñas de su tienda (steam/reviews.ts).
  // El caso que la falseaba es el segundo motivo, el appid ajeno: "Trails in
  // the Sky 2nd Chapter" —el remake, sin salir— llevaba el appid del original
  // de 2015, así que esta card enseñaba tres mil reseñas de un juego que no ha
  // salido. Sin esta comprobación, pulsar el ⟳ volvía a escribir esos mismos
  // números una y otra vez mientras el botón de al lado (ActionBar ->
  // refreshGame.ts) sí corregía el appid: dos botones sobre el mismo dato y
  // resultados opuestos. Un botón de refrescar refresca lo que se ve encima, o
  // miente — la misma regla de la cabecera.
  //
  // El appid de un playtest no llegaba a falsear ESTE número (una beta cerrada
  // no tiene página de tienda, así que el resumen de reseñas no contesta y la
  // card se queda sin %), pero se corrige igual: de ese mismo appid cuelgan las
  // etiquetas y los logros que sí se ven en las otras cards.
  //
  // No se re-resuelve nada más: el guardado solo se comprueba contra las
  // entradas de Steam de su propia ficha, que es lo mismo que hacen las otras
  // dos rutas de refresco (refresh.ts y refreshGame.ts, con el mismo helper).
  let appId = game.steamAppId;
  let correctedAppId = false;
  if (detail) {
    const igdbId = detail.igdbId;
    if (appId === null) {
      appId = await resolveAchievementsSteamAppId(
        igdbId,
        detail.parentIgdbId,
        detail.directSteamAppId,
      ).catch(() => null);
    } else {
      // El aviso por consola lo da el helper, igual en las tres rutas.
      const better = await findSteamAppIdFix({ igdbId, steamAppId: appId, title: game.title });
      if (better !== undefined) {
        appId = better;
        correctedAppId = true;
      }
    }
    if (appId !== null && appId !== game.steamAppId) {
      patch.steamAppId = appId;
      patch.steamAppIdCheckedAt = now;
    }
  }

  let steam: RatingsRefreshResult['steam'] = 'skipped';
  if (appId !== null) {
    const reviews = await getSteamReviewCounts(appId);
    steam = reviews ? 'updated' : 'no-data';
    if (reviews) {
      patch.steamPositive = reviews.steamPositive;
      patch.steamNegative = reviews.steamNegative;
      patch.steamSpyCheckedAt = now;
    } else if (correctedAppId) {
      // El appid era de otro producto y el bueno todavía no tiene reseñas
      // —justo el caso Trails in the Sky, un remake sin salir—: los números
      // guardados no son un dato viejo de este juego que convenga conservar,
      // son los de OTRO juego. Dejarlos sería corregir el appid para seguir
      // enseñando la misma mentira, ahora colgada del appid bueno.
      patch.steamPositive = null;
      patch.steamNegative = null;
    }
  }

  // Las ETIQUETAS no se piden aquí a propósito: no salen en esta card (viven
  // en Details) y esto es el botón de las notas. Quien las quiera tiene el de
  // "actualizar el juego entero" al lado — que es también el que arregla las
  // de un appid recién corregido aquí: este botón no las pide, así que hasta
  // entonces la card de Details sigue enseñando las del producto viejo.

  if (Object.keys(patch).length > 0) {
    await withDbAccess(async () => updateGame(gameId, patch));
  }

  return { ratings, steam };
};
