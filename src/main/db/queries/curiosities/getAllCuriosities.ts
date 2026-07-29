import { getDb } from '../..';
import type { CuriositySummary } from '../../../../shared/types';
import { curiositiesTable } from '../../schema';

// Todas las curiosidades de la biblioteca de una vez, para el modo ambiente:
// son unas pocas frases por juego, y el ambiente necesita las del juego que
// toque en cada diapositiva — un mapa gameId→frases en el renderer sale más
// barato que una query por diapositiva cada 26 segundos.
export const getAllCuriosities = async (): Promise<CuriositySummary[]> => {
  const db = getDb();
  return db
    .select({
      gameId: curiositiesTable.gameId,
      text: curiositiesTable.text,
    })
    .from(curiositiesTable);
};
