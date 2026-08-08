import { eq, isNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { resolveSgdbId } from '../sgdb/api';

// EL ID DE STEAMGRIDDB DE LOS QUE NO LO TIENEN.
//
// Tiene exactamente el mismo agujero que tuvieron el appid de Steam y el id de
// IGDB: se resolvía UNA vez, en el alta, y un null se quedaba grabado para
// siempre. Y ese null CADUCA — SteamGridDB no tiene arte de un juego el día
// que se anuncia, la tiene semanas después, igual que IGDB no tiene su ficha.
// Un juego que se dio de alta demasiado pronto se quedaba sin candidatas en el
// CoverPicker sin ninguna forma de volver a preguntarlo.
//
// Por eso lo hacen los TRES refrescos, como con el id de IGDB: el de la ficha,
// el de Ajustes/Plan y el radar semanal.
//
// El coste es acotado y se agota solo: solo entran los que NO lo tienen, así
// que la primera pasada paga unas pocas peticiones y las siguientes ninguna.
// Medido sobre la biblioteca real (8-ago-2026): 15 juegos de 985, y los 15 con
// appid — o sea, todos por la vía exacta, sin matcher difuso de por medio.
//
// Los que YA lo tienen no se tocan nunca: puede ser el que TÚ elegiste a mano
// en el CoverPicker, y re-resolverlo te cambiaría la portada por otra.
export const fillMissingSgdbIds = async (): Promise<number> => {
  try {
    const pending = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          releaseYear: gamesTable.releaseYear,
          steamAppId: gamesTable.steamAppId,
        })
        .from(gamesTable)
        .where(isNull(gamesTable.steamGridDbId)),
    );
    if (pending.length === 0) return 0;

    let found = 0;
    for (const game of pending) {
      // En serie a propósito: son pocos y SteamGridDB no tiene endpoint de
      // lotes. Nada de paralelo contra un servicio gratuito.
      const sgdbId = await resolveSgdbId(game);
      if (sgdbId === null) continue;

      await withDbAccess(async () =>
        getDb().update(gamesTable).set({ steamGridDbId: sgdbId }).where(eq(gamesTable.id, game.id)),
      );
      found++;
    }

    if (found > 0) {
      // Solo ASCII, misma convención que el resto de logs del main.
      console.log(`[sgdb] ${found}/${pending.length} juegos ganaron su id de SteamGridDB`);
    }
    return found;
  } catch (error) {
    // Accesorio: que esto falle no puede tumbar el refresco que lo llamó.
    console.warn('[sgdb] fallo rellenando los ids que faltaban:', error);
    return 0;
  }
};
