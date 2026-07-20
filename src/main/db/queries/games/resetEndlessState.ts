import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from '../..';
import { iterationsTable, stateEventsTable } from '../../schema';

// Convertir un juego normal a ENDLESS sin perder nada medido: los
// playthroughs, sus sesiones trackeadas y las horas manuales se CONSERVAN —
// lo que se limpia es la noción de "partida discreta con desenlace", que un
// endless no tiene: sus stateEvents (menos 'plan_to_play', que es historial
// de intención, no de partida). Sin esto el juego seguía saliendo como
// "Beaten" por un playthrough conceptualmente extinto. Modelo v2: las
// fechas de playthrough se derivan del log, así que limpiar el log ya lo
// limpia todo — no quedan marcadores ni anclas aparte que tocar.
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
