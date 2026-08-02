import { and, isNotNull, isNull, sql } from 'drizzle-orm';
import { getDb } from '../..';
import type { PendingAchievementsGame } from '../../../steam/queue';
import { gamesTable } from '../../schema';

// A qué juegos les toca sincronizar logros. Solo con appid de Steam: sin él
// no hay nada que preguntar. Incluye los PLANEADOS a propósito — el catálogo
// de un juego que aún no has jugado es información válida ("esto tiene 34
// logros") y no cuesta nada de más.
//
// Dos modos, y la diferencia importa:
//
//   · full = false -> solo los que NUNCA han traído catálogo. Es la pasada
//     del arranque: barata, y suficiente para que las fichas tengan algo.
//   · full = true  -> TODOS. Es el botón "Sync now" de Ajustes, y hace lo que
//     dice: un botón explícito que se salta la mitad de la biblioteca porque
//     "ya estaba bastante al día" es un botón que miente. Además es lo único
//     que arrastra mejoras del catálogo (textos nuevos, iconos, las
//     descripciones ocultas del schema local) a juegos ya sincronizados.
//
// Sin TTL: la API de Steam es gratis y admite 100.000 peticiones al día, así
// que temporizar el refresco solo servía para que el botón no funcionara.
export const getPendingAchievementsGames = async (
  full: boolean,
): Promise<PendingAchievementsGame[]> => {
  const rows = await getDb()
    .select({
      id: gamesTable.id,
      title: gamesTable.title,
      steamAppId: gamesTable.steamAppId,
      executablePath: gamesTable.executablePath,
      installDirectory: gamesTable.installDirectory,
    })
    .from(gamesTable)
    .where(
      full
        ? isNotNull(gamesTable.steamAppId)
        : and(isNotNull(gamesTable.steamAppId), isNull(gamesTable.achievementsSyncedAt)),
    )
    .orderBy(sql`${gamesTable.title} collate nocase`);

  // El filtro de arriba ya garantiza el notNull; el flatMap lo estrecha para
  // el tipo de la cola sin un cast.
  return rows.flatMap((row) =>
    row.steamAppId === null
      ? []
      : [
          {
            id: row.id,
            title: row.title,
            steamAppId: row.steamAppId,
            executablePath: row.executablePath,
            installDirectory: row.installDirectory,
          },
        ],
  );
};
