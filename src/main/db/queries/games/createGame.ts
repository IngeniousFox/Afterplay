import { getDb } from '../..';
import type { CreateGameInput, GameRow } from '../../../../shared/types';
import { gameColumns } from '../../projections';
import { gamesTable } from '../../schema';

// Si el igdbId ya existe, el unique de la tabla lo rechaza y la promesa del
// invoke revienta en el renderer, ahí es donde se decide qué contarle al
// usuario, aquí no se traga el error.
export const createGame = async (input: CreateGameInput): Promise<GameRow> => {
  const db = getDb();
  const [game] = await db.insert(gamesTable).values(input).returning(gameColumns);
  return game;
};
