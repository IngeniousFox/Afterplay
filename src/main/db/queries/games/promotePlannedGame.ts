import { asc, eq } from 'drizzle-orm';
import { getDb } from '../..';
import type { GameRow, PromotePlannedGameInput } from '../../../../shared/types';
import { gameColumns } from '../../projections';
import { gamesTable, iterationsTable } from '../../schema';
import { writeInitialPlaythrough } from './writeInitialPlaythrough';

// Pasar un Plan to Play a la biblioteca de verdad. Espejo del tramo de
// escritura de createGameWithDetails, pero sobre el juego YA existente:
// se ACTUALIZA (planned=false + los campos del modal) en vez de borrar y
// recrear — así el id no cambia y el historial se conserva entero, incluida
// la entrada 'plan_to_play' de cuando lo planeaste. No hay nada externo que
// resolver (IGDB/HLTB/SGDB ya se trajeron al planearlo), así que toda la
// función es una única transacción.
export const promotePlannedGame = async (input: PromotePlannedGameInput): Promise<GameRow> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [planned] = await tx
      .select({ id: gamesTable.id, planned: gamesTable.planned })
      .from(gamesTable)
      .where(eq(gamesTable.id, input.gameId))
      .limit(1);
    if (!planned) throw new Error(`No existe el juego ${input.gameId}`);
    if (!planned.planned) throw new Error(`El juego ${input.gameId} no está en Plan to Play`);

    const [game] = await tx
      .update(gamesTable)
      .set({
        planned: false,
        endless: input.endless,
        isEmulated: input.isEmulated,
        notes: input.gameNotes,
        executablePath: input.executablePath,
        installDirectory: input.installDirectory,
        installSizeBytes: input.installSizeBytes,
        // null = "sin elección propia en el picker" — se conserva la que el
        // juego ya tenía de cuando se planeó, no se pisa con null.
        ...(input.coverUrl ? { coverUrl: input.coverUrl } : {}),
        ...(input.heroUrl ? { heroUrl: input.heroUrl } : {}),
      })
      .where(eq(gamesTable.id, input.gameId))
      .returning(gameColumns);

    // La iteración por defecto que createPlannedGame dejó creada (la primera
    // — y única — del juego): ahora se rellena con el playthrough real que
    // el modal acaba de preguntar.
    const [iteration] = await tx
      .select({ id: iterationsTable.id })
      .from(iterationsTable)
      .where(eq(iterationsTable.gameId, input.gameId))
      .orderBy(asc(iterationsTable.id))
      .limit(1);
    if (!iteration) throw new Error(`El juego ${input.gameId} no tiene ninguna iteración`);

    await tx
      .update(iterationsTable)
      .set({
        playedPlatform: input.iteration.playedPlatform,
        origin: input.iteration.origin,
        format: input.iteration.format,
        manualTotalPlayed: input.hoursPlayed,
      })
      .where(eq(iterationsTable.id, iteration.id));

    // De aquí para abajo: mismo guion que createGameWithDetails — sesiones
    // marcadoras de borde para las fechas, gasto inicial y el log de estados
    // (con 'started' por delante de un estado terminal, SPEC 4.5).
    await writeInitialPlaythrough(tx, game.id, iteration.id, input);

    return game;
  });
};
