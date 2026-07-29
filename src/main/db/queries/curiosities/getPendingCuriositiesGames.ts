import { count, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { CuriositiesStatus } from '../../../../shared/types';
import { gamesTable } from '../../schema';

// Lo mínimo que la generación necesita saber de un juego. El developer va
// en el prompt como contexto de desambiguación (dos juegos pueden llamarse
// igual; "Prey (2017) by Arkane" no deja dudas).
export type PendingCuriositiesGame = {
  id: number;
  igdbId: number;
  title: string;
  releaseYear: number | null;
  developer: string | null;
};

// Juegos que todavía no han pasado por la generación — incluye los del Plan:
// generar ahí también es una miseria de coste y así al pasarlos a la
// biblioteca ya llegan con sus curiosidades puestas.
export const getPendingCuriositiesGames = async (): Promise<PendingCuriositiesGame[]> => {
  const db = getDb();
  return db
    .select({
      id: gamesTable.id,
      igdbId: gamesTable.igdbId,
      title: gamesTable.title,
      releaseYear: gamesTable.releaseYear,
      developer: gamesTable.developer,
    })
    .from(gamesTable)
    .where(isNull(gamesTable.curiositiesGeneratedAt));
};

// Contadores para la tarjeta de Ajustes ("212 of 331 games have trivia").
// `running` lo añade el que llama (es estado del proceso, no de la DB).
export const getCuriositiesCounts = async (): Promise<Omit<CuriositiesStatus, 'running'>> => {
  const db = getDb();
  const [totalRow] = await db.select({ value: count() }).from(gamesTable);
  const [generatedRow] = await db
    .select({ value: count() })
    .from(gamesTable)
    .where(isNotNull(gamesTable.curiositiesGeneratedAt));
  return { totalGames: totalRow?.value ?? 0, generatedGames: generatedRow?.value ?? 0 };
};
