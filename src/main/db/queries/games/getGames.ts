import { eq, sql } from 'drizzle-orm';
import { getDb } from '../..';
import { gamesTable, iterationsTable, sessionsTable, stateEventsTable } from '../../schema';
import type { Game, StateEvent } from '../../../../shared/types';

// Forma de una fila candidata a "evento de estado más reciente de este
// juego". La nombro explícitamente en vez de inferirla del array para no
// tener que ir a buscar la query cada vez que quiera saber qué trae.
type StateEventCandidate = {
  gameId: number;
  type: StateEvent['type'];
  occurredAt: Date;
  id: number;
};

export const getGames = async (): Promise<Game[]> => {
  const db = getDb();

  const games = await db.select().from(gamesTable);

  // Horas manuales por juego (ya vienen en horas, se suman directas). Agrupo
  // solo sobre iterations sin tocar sessions todavía — si mezclo las dos
  // tablas en un JOIN, esto se duplica una vez por cada sesión de la iteración.
  const manualHoursByGame = await db
    .select({
      gameId: iterationsTable.gameId,
      totalManualHours: sql<number>`coalesce(sum(${iterationsTable.manualTotalPlayed}), 0)`,
    })
    .from(iterationsTable)
    .groupBy(iterationsTable.gameId);

  // Segundos trackeados por juego, sumando todas las sesiones de todas sus
  // iteraciones. Va en consulta aparte por el mismo motivo de arriba.
  const trackedSecondsByGame = await db
    .select({
      gameId: iterationsTable.gameId,
      totalSeconds: sql<number>`coalesce(sum(${sessionsTable.durationSec}), 0)`,
    })
    .from(sessionsTable)
    .innerJoin(iterationsTable, eq(sessionsTable.iterationId, iterationsTable.id))
    .groupBy(iterationsTable.gameId);

  const manualHoursMap = new Map(
    manualHoursByGame.map((row) => [row.gameId, row.totalManualHours]),
  );
  const trackedSecondsMap = new Map(
    trackedSecondsByGame.map((row) => [row.gameId, row.totalSeconds]),
  );

  // Todos los stateEvents del juego (vía sus iteraciones), sin agregar
  // todavía. El "estado actual" es otro caso de 1-fila-por-grupo (la más
  // reciente por gameId), así que lo resuelvo igual que las horas: traigo las
  // candidatas y me quedo con la mejor en JS. Nada de JOIN plano (repite
  // filas) ni ROW_NUMBER — para esto es matar moscas a cañonazos.
  const stateEventRows: StateEventCandidate[] = await db
    .select({
      gameId: iterationsTable.gameId,
      type: stateEventsTable.type,
      occurredAt: stateEventsTable.occurredAt,
      id: stateEventsTable.id,
    })
    .from(stateEventsTable)
    .innerJoin(iterationsTable, eq(stateEventsTable.iterationId, iterationsTable.id));

  // Recorro todas las candidatas y me quedo, por cada gameId, con la más
  // reciente vista hasta ese momento. El Map empieza vacío pero se va
  // llenando según avanza el bucle: la primera fila de un juego gana por
  // defecto (no hay nada con qué compararla), y las siguientes del MISMO
  // juego se comparan contra lo que dejó guardado una vuelta anterior.
  const latestStateEventByGame = new Map<number, StateEventCandidate>();

  for (const row of stateEventRows) {
    const previousLatest = latestStateEventByGame.get(row.gameId);

    if (!previousLatest) {
      // Nada guardado todavía para este juego, así que esta fila gana directa.
      latestStateEventByGame.set(row.gameId, row);
      continue;
    }

    const rowIsNewer = row.occurredAt.getTime() > previousLatest.occurredAt.getTime();
    const rowIsSameDateButHigherId =
      row.occurredAt.getTime() === previousLatest.occurredAt.getTime() &&
      row.id > previousLatest.id;

    if (rowIsNewer || rowIsSameDateButHigherId) {
      latestStateEventByGame.set(row.gameId, row);
    }
  }

  return games.map((game) => {
    const manualHours = manualHoursMap.get(game.id) ?? 0;
    const trackedSeconds = trackedSecondsMap.get(game.id) ?? 0;
    const trackedHours = trackedSeconds / 3600;

    const latestStateEvent = latestStateEventByGame.get(game.id);

    return {
      ...game,
      totalHours: manualHours + trackedHours,
      currentState: latestStateEvent?.type ?? null,
    };
  });
};
