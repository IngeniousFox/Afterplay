import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { gamesTable } from '../../schema';

// Proyección propia para las partidas guardadas. No se reutiliza getGames()
// a propósito: ese devuelve la lista de la biblioteca ya agregada (horas,
// estado, sesiones...), que aquí no sirve para nada y cuesta varios JOINs.
// Esto es lo mínimo que el módulo saves necesita para hablar con ludusavi y
// con R2.
export type SaveGame = {
  id: number;
  title: string;
  // La clave de R2 se indexa por igdbId, que ya es independiente de la
  // máquina y del título (PARTIDAS-GUARDADAS.md §9).
  igdbId: number;
  saveBackupEnabled: boolean;
  saveDetectionSource: 'auto' | 'manual' | null;
  saveLudusaviName: string | null;
  saveCustomPaths: string[] | null;
};

export const getSaveGames = async (): Promise<SaveGame[]> => {
  const db = getDb();
  return (
    db
      .select({
        id: gamesTable.id,
        title: gamesTable.title,
        igdbId: gamesTable.igdbId,
        saveBackupEnabled: gamesTable.saveBackupEnabled,
        saveDetectionSource: gamesTable.saveDetectionSource,
        saveLudusaviName: gamesTable.saveLudusaviName,
        saveCustomPaths: gamesTable.saveCustomPaths,
      })
      .from(gamesTable)
      // Los planeados no están instalados por definición: no tienen partida
      // que respaldar y solo serían ruido en los resultados del escaneo.
      .where(eq(gamesTable.planned, false))
  );
};
