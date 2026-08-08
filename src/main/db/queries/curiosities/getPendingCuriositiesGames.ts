import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { CuriositiesStatus } from '../../../../shared/types';
import { gamesTable } from '../../schema';

// Lo mínimo que la generación necesita saber de un juego. El developer va
// en el prompt como contexto de desambiguación (dos juegos pueden llamarse
// igual; "Prey (2017) by Arkane" no deja dudas).
export type PendingCuriositiesGame = {
  id: number;
  igdbId: number | null;
  title: string;
  releaseYear: number | null;
  developer: string | null;
};

// Juegos que todavía no han pasado por la generación — EXCLUYE los que
// siguen en Plan to Play (games:promote los encola en cuanto pasan a la
// biblioteca, ver ipc/games.ts). No se adelanta aquí por el mismo motivo:
// muchos son juegos que ni han salido, y una generación "no lo sé" quedaría
// marcada como hecha para siempre.
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
    .where(and(isNull(gamesTable.curiositiesGeneratedAt), eq(gamesTable.planned, false)));
};

// Contadores para la tarjeta de Ajustes ("212 of 331 games have trivia").
// `running` lo añade el que llama (es estado del proceso, no de la DB).
//
// Los dos cuentan sobre la biblioteca, sin los Plan to Play, porque es la
// población que la generación de arriba puede tocar: contándolos, los que
// nunca van a generarse dejaban un pendiente residual que no bajaba de ahí
// —el botón se quedaba encendido para siempre y no encolaba nada—.
export const getCuriositiesCounts = async (): Promise<Omit<CuriositiesStatus, 'running'>> => {
  const db = getDb();
  const [totalRow] = await db
    .select({ value: count() })
    .from(gamesTable)
    .where(eq(gamesTable.planned, false));
  const [generatedRow] = await db
    .select({ value: count() })
    .from(gamesTable)
    .where(and(isNotNull(gamesTable.curiositiesGeneratedAt), eq(gamesTable.planned, false)));
  return { totalGames: totalRow?.value ?? 0, generatedGames: generatedRow?.value ?? 0 };
};
