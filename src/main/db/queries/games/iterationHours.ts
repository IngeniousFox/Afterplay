import { sql } from 'drizzle-orm';
import { sessionsTable } from '../../schema';

// La regla de las horas de una iteración vive en src/shared/domain/hours.ts
// (AFTERPLAY-2.0.md §15.2): la usan el escritorio y el Worker. Se reexporta
// aquí para los que ya la importaban de este fichero (getSessionClosedInfo,
// worker/src/queries/saga.ts).
export { resolveIterationHours } from '../../../../shared/domain/hours';

// LOS AGREGADOS DE SESIONES POR ITERACIÓN, escritos UNA vez para las dos
// consultas de la biblioteca: getGames (escritorio) y buildLibraryData
// (worker/src/queries/library.ts). Van con `group by iterations.id` sobre un
// `iterations LEFT JOIN sessions`, y deriveLibrary (src/shared/domain/
// library.ts) es quien los convierte en lo que enseña la lista.
//
// Se quedan en SQL a propósito y no se suman en JS: lo que cuesta en getGames
// no es el SQL sino las filas que cruzan el driver, y así crecen con los
// playthroughs y no con las sesiones (medido: 37,4 -> 16,8 ms sobre una copia
// de la base real con 5.098 sesiones). Por eso la REGLA de qué cuenta está
// aquí y no en shared: shared no puede depender de drizzle. Las dos consultas
// importan ESTE objeto; si cambia lo que cuenta, cambia para las dos.
//
//  · sessionCount — COUNT(sessions.id) y no COUNT(*): con el LEFT JOIN, un
//    playthrough sin sesiones es una fila de NULLs y COUNT(*) le inventaría
//    una. Cuenta TODAS, la abierta incluida.
//  · trackedSeconds — `sum` ignora los NULL (la sesión abierta todavía no
//    tiene duración); el coalesce es para la iteración sin ninguna.
//  · liveSince — el arranque más reciente entre las ABIERTAS de la iteración.
//    Solo lo usa el escritorio: el Worker necesita además quién la abrió y
//    cuándo latió por última vez para juzgar su frescura, y eso no cabe en un
//    max().
//  · lastSessionAt — cuándo se DEJÓ la última sesión, la base de "Last
//    played": endedAt y no startedAt, para que una partida larga cuente por
//    cuándo se soltó; en una abierta el arranque es lo más reciente que hay.
//  · firstSessionAt — el arranque más temprano del PLAYTHROUGH, último recurso
//    para fechar sus horas manuales (manualHoursAnchor se queda con el mínimo).
//
// Tipados como number | bigint porque los enteros de una agregación no pasan
// por el mapeo de columna de drizzle y cada driver los devuelve a su manera;
// deriveLibrary los normaliza.
export const iterationSessionTotals = {
  sessionCount: sql<number | bigint>`count(${sessionsTable.id})`,
  trackedSeconds: sql<number | bigint>`coalesce(sum(${sessionsTable.durationSec}), 0)`,
  liveSince: sql<
    number | bigint | null
  >`max(case when ${sessionsTable.endedAt} is null then ${sessionsTable.startedAt} end)`,
  lastSessionAt: sql<
    number | bigint | null
  >`max(coalesce(${sessionsTable.endedAt}, ${sessionsTable.startedAt}))`,
  firstSessionAt: sql<number | bigint | null>`min(${sessionsTable.startedAt})`,
};
