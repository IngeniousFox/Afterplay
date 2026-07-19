import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { getDb } from '../..';
import { iterationsTable, sessionsTable, stateEventsTable } from '../../schema';

// Convertir un juego normal a ENDLESS sin perder nada medido: los
// playthroughs y sus sesiones trackeadas (y las horas manuales de cada
// iteración) se CONSERVAN — lo que se limpia es la noción de "partida
// discreta con desenlace", que un endless no tiene:
//
//   1. Los stateEvents de sus iteraciones (menos 'plan_to_play', que es
//      historial de intención, no de partida) — sin esto el juego seguía
//      saliendo como "Beaten" por un playthrough conceptualmente extinto.
//   2. Los marcadores de borde ("I played this before": milestone puesto,
//      duración 0) y las anclas start/endSessionId que apuntaban a ellos —
//      son la contabilidad de inicio/fin de una partida discreta; sin
//      partida, sobran. Las sesiones REALES (milestone null) no se tocan.
//
// El estado nuevo del endless (resting/playing/...) lo escribe el
// EditGameModal justo después, como evento fresco sobre el contenedor.
export const resetEndlessState = async (gameId: number): Promise<boolean> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const iterations = await tx
      .select({ id: iterationsTable.id })
      .from(iterationsTable)
      .where(eq(iterationsTable.gameId, gameId));
    if (iterations.length === 0) return true;
    const iterationIds = iterations.map((iteration) => iteration.id);

    // Anclas a null ANTES de borrar los marcadores: start/endSessionId
    // referencian sessions.id sin cascade — borrarlos primero dejaría
    // referencias colgando.
    await tx
      .update(iterationsTable)
      .set({ startSessionId: null, endSessionId: null })
      .where(inArray(iterationsTable.id, iterationIds));

    await tx
      .delete(sessionsTable)
      .where(
        and(inArray(sessionsTable.iterationId, iterationIds), isNotNull(sessionsTable.milestone)),
      );

    await tx
      .delete(stateEventsTable)
      .where(
        and(
          inArray(stateEventsTable.iterationId, iterationIds),
          ne(stateEventsTable.type, 'plan_to_play'),
        ),
      );

    return true;
  });
};
