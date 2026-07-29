import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { curiositiesTable, gamesTable } from '../../schema';

// Guarda el resultado de UNA generación (main/curiosities/generate) y marca
// el juego como hecho — también con cero frases: "una llamada por juego en la
// vida" incluye el caso de que el modelo no tuviera nada seguro que contar.
// El DELETE previo deja la operación re-ejecutable a propósito (si algún día
// hay un botón de "regenerar", esto ya lo soporta sin duplicar filas).
export const storeCuriosities = async (gameId: number, texts: string[]): Promise<void> => {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(curiositiesTable).where(eq(curiositiesTable.gameId, gameId));
    if (texts.length > 0) {
      await tx.insert(curiositiesTable).values(texts.map((text) => ({ gameId, text })));
    }
    await tx
      .update(gamesTable)
      .set({ curiositiesGeneratedAt: new Date() })
      .where(eq(gamesTable.id, gameId));
  });
};
