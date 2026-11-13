import { count, desc, eq } from 'drizzle-orm';
import { gamesTable, iterationsTable, sessionsTable } from '../../../src/main/db/schema';
import type { SessionPage, SessionWithGame } from '../api-types';
import type { TenantDb } from '../db';

// Las sesiones, con su juego ya resuelto y más reciente primero.
//
// Paginadas EN EL SERVIDOR, que es la diferencia con el escritorio: allí
// getAllSessions trae la tabla entera y la pantalla pagina en local, porque la
// base está en el disco de al lado y el coste es cero. Aquí cada fila cruza
// internet hasta un móvil, así que la página se recorta antes de salir.
//
// QUÉ POBLACIÓN CUENTA, que no es la misma que la del resumen y conviene saber
// antes de "arreglarlo": aquí entran TODAS las sesiones, las de los juegos del
// Plan incluidas. No es un olvido del filtro `planned = false` que sí llevan las
// consultas de buildLibraryData (library.ts): es lo mismo que hace el escritorio
// —getAllSessions tampoco filtra— y la pantalla de Sesiones es un registro de lo
// que pasó, no un inventario de la biblioteca. Devolver un juego al Plan después
// de haberlo jugado deja sus sesiones donde estaban, y siguen siendo ratos que
// existieron.
//
// El precio es una asimetría real y visible, y es LA causa del 57 contra 54: el
// tile "Sessions" de la portada sale de StatsSummary.totalSessions, que suma el
// sessionCount de la biblioteca (deriveLibrary sobre los juegos con
// `planned = false`), mientras que este total cuenta todas las sesiones con
// playthrough. La diferencia son exactamente las sesiones de los juegos que hoy
// están en el Plan (devueltos al Plan después de jugarlos). No hay otra fuente:
// las dos consultas cuentan la sesión abierta y las dos excluyen las de
// emulador sin playthrough (iterationId null).
//
// NO es una divergencia con el escritorio, que tiene la MISMA asimetría: la
// píldora de "All Sessions" cuenta getAllSessions (con planeados) y el total de
// MiddleColumn suma sessionCount de getGames (sin ellos). Filtrar aquí las
// igualaría en el móvil a costa de que su lista enseñara menos filas que la del
// PC; cuadrarlas de verdad es decidir UNA población para los dos lados, y esa
// decisión toca al escritorio.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export const listSessions = async (
  db: TenantDb,
  options: { limit?: number; offset?: number; gameId?: number } = {},
): Promise<SessionPage> => {
  // El límite viene de la query string, o sea de fuera. Se sanea aquí y no en
  // el router para que no haya forma de llamar a esto sin pasar por el tope:
  // un `?limit=999999` no debe poder convertir una pantalla del móvil en un
  // volcado de la tabla entera.
  const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));

  // Las DOS en un solo viaje. El total va aparte de la página porque la página
  // no lo puede saber —hace falta para pintar "Page 2 of 7" sin traerse las
  // siete—, pero "aparte" no tiene por qué significar otra ida y vuelta a
  // Turso: `db.batch` las manda en una sola petición HTTP. Medido contra la
  // base real desde fuera del datacenter: 95 ms encadenadas contra 47 ms en
  // batch, y la mitad de esos 95 era esperar la red dos veces.
  const [rows, totals] = await db.batch([
    db
      .select({
        id: sessionsTable.id,
        gameId: iterationsTable.gameId,
        gameTitle: gamesTable.title,
        coverUrl: gamesTable.coverUrl,
        startedAt: sessionsTable.startedAt,
        endedAt: sessionsTable.endedAt,
        durationSec: sessionsTable.durationSec,
        note: sessionsTable.note,
      })
      .from(sessionsTable)
      .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
      .innerJoin(gamesTable, eq(iterationsTable.gameId, gamesTable.id))
      .where(options.gameId === undefined ? undefined : eq(iterationsTable.gameId, options.gameId))
      // Desempate por id: dos sesiones que arrancan en el mismo milisegundo
      // tendrían orden indefinido, y con paginación eso significa que una fila
      // puede salir en dos páginas y otra en ninguna.
      .orderBy(desc(sessionsTable.startedAt), desc(sessionsTable.id))
      .limit(limit)
      .offset(offset),

    db
      .select({ value: count() })
      .from(sessionsTable)
      .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
      .where(options.gameId === undefined ? undefined : eq(iterationsTable.gameId, options.gameId)),
  ]);

  const sessions: SessionWithGame[] = rows.map((row) => ({
    id: row.id,
    gameId: row.gameId,
    gameTitle: row.gameTitle,
    coverUrl: row.coverUrl,
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt ? row.endedAt.getTime() : null,
    durationSec: row.durationSec,
    note: row.note,
  }));

  return { sessions, total: totals[0]?.value ?? sessions.length, limit, offset };
};
