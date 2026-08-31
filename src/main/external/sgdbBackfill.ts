import { and, eq, isNull } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { gamesTable } from '../db/schema';
import { resolveSgdbId } from '../sgdb/api';
import type { RefreshScope } from './refresh';

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
//
// ── Y por qué esto va endurecido como la repesca de HLTB ────────────────────
//
// El régimen normal (15 de 985) no es el único que existe. El día que alguien
// configura la clave de SteamGridDB DESPUÉS de haber montado su biblioteca,
// `pending` son casi los 985: sin clave, resolveSgdbId devuelve null para
// todos y la biblioteca entera nace con el id a null. Ese día esto era un
// bucle en serie, sin pausa y sin freno, con hasta diez segundos de espera por
// juego si SGDB está caído o lento (su timeout, ver sgdb/api.ts) — y todo eso
// ANTES de que la pasada externa le pida nada a IGDB, con la tarjeta de
// Ajustes ya cantando "Refreshing… 0/N" sin moverse. La repesca de HLTB del
// mismo pase (external/refresh.ts) ya tenía las tres defensas que faltaban
// aquí: pausa entre peticiones, abandono tras unos pocos fallos seguidos y
// respeto del alcance.
const SGDB_DELAY_MS = 300;

// Fallos SEGUIDOS que se aguantan antes de rendirse. Mismo número y mismo
// motivo que la repesca de HLTB: uno suelto no dice nada del servicio, tres
// seguidos sí.
const SGDB_ABORT_AFTER = 3;

// Qué cuenta como "fallo" aquí, que no es evidente: resolveSgdbId NUNCA lanza
// —se traga sus errores y devuelve null— así que un null no distingue "SGDB no
// conoce este juego" de "SGDB no contesta", y rendirse por nulls dejaría sin
// mirar para siempre a los que van detrás de unos cuantos desconocidos de
// verdad (la lista se lee en el mismo orden en cada pasada). Lo que sí separa
// los dos casos es el RELOJ: una respuesta de SGDB, incluida la de "no lo
// tengo", vuelve en décimas; una llamada que se acerca a su timeout de diez
// segundos es el servicio ahogado o caído.
const SGDB_SLOW_CALL_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// El alcance viaja desde quien llama, igual que en el resto de la pasada: la
// puerta del Plan promete que "lo único que cambia es a qué juegos alcanza"
// (ver la cabecera de external/refresh.ts) y esto recorría la biblioteca
// entera aunque hubieras pulsado el botón de los planeados. Por defecto 'all',
// que es lo que quiere el radar semanal.
export const fillMissingSgdbIds = async (scope: RefreshScope = 'all'): Promise<number> => {
  try {
    // Sin clave no hay a quién preguntar: cada llamada fallaría igual (el
    // cliente de SGDB lanza sin ella) y con la pausa de por medio serían
    // minutos de espera por nada, más un aviso por consola por cada juego.
    // Misma puerta que hasSteamKey() en la pasada de logros; SGDB no tiene su
    // propio helper, así que se mira la variable que lee sgdb/client.ts.
    if (!process.env.STEAMGRIDDB_API_KEY) return 0;

    const missing = isNull(gamesTable.steamGridDbId);
    const pending = await withDbAccess(async () =>
      getDb()
        .select({
          id: gamesTable.id,
          title: gamesTable.title,
          releaseYear: gamesTable.releaseYear,
          steamAppId: gamesTable.steamAppId,
        })
        .from(gamesTable)
        .where(scope === 'plan' ? and(eq(gamesTable.planned, true), missing) : missing),
    );
    if (pending.length === 0) return 0;

    let found = 0;
    let slowStreak = 0;
    for (const [index, game] of pending.entries()) {
      // En serie a propósito: son pocos y SteamGridDB no tiene endpoint de
      // lotes. Nada de paralelo contra un servicio gratuito — y con pausa,
      // que en el caso degradado esto son cientos de juegos seguidos.
      if (index > 0) await sleep(SGDB_DELAY_MS);

      const startedAt = Date.now();
      const sgdbId = await resolveSgdbId(game);
      slowStreak = Date.now() - startedAt >= SGDB_SLOW_CALL_MS ? slowStreak + 1 : 0;

      if (sgdbId !== null) {
        await withDbAccess(async () =>
          getDb()
            .update(gamesTable)
            .set({ steamGridDbId: sgdbId })
            .where(eq(gamesTable.id, game.id)),
        );
        found++;
      }

      if (slowStreak >= SGDB_ABORT_AFTER) {
        // Nada de topes silenciosos: se dice cuántos se quedan sin mirar (los
        // recoge la próxima pasada, que es de lo que va este backfill).
        console.warn(
          `[sgdb] ${SGDB_ABORT_AFTER} llamadas seguidas al limite de espera - SteamGridDB parece caido, dejo ${pending.length - index - 1} juegos sin mirar`,
        );
        break;
      }
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
