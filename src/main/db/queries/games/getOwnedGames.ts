import { getDb } from '../..';
import { gamesTable } from '../../schema';

// Lo que el escaneo de carpetas necesita saber de tu colección: qué juegos
// existen ya —biblioteca Y plan— para repartir cada carpeta encontrada entre
// "añadible", "ya lo tienes" y "estaba en tu plan".
//
// Consulta propia a propósito. Antes el escaneo reutilizaba getSaveGames()
// (módulo de partidas guardadas) porque era la forma más barata de pedir
// "títulos de mi biblioteca" — pero esa consulta excluye los planeados con
// razón (un planeado no tiene partida que respaldar), y el escaneo heredó el
// filtro sin quererlo: un juego de tu plan ya instalado salía como nuevo.
export type OwnedGameRef = {
  id: number;
  igdbId: number | null;
  title: string;
  planned: boolean;
};

export const getOwnedGames = async (): Promise<OwnedGameRef[]> => {
  const db = getDb();
  return db
    .select({
      id: gamesTable.id,
      igdbId: gamesTable.igdbId,
      title: gamesTable.title,
      planned: gamesTable.planned,
    })
    .from(gamesTable);
};
