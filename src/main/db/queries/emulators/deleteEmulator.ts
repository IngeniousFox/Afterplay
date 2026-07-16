import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import { emulatorsTable, sessionsTable } from '../../schema';

// Borrar un emulador registrado. Sus sesiones PENDIENTES (sin asignar) se
// van con él — sin emulador de origen ni juego destino no son más que filas
// huérfanas imposibles de mostrar o asignar. Las ya asignadas a un juego se
// conservan (son tiempo jugado real de ese juego); su emulatorId queda a
// null vía el ON DELETE SET NULL del schema.
export const deleteEmulator = async (id: number): Promise<boolean> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    await tx
      .delete(sessionsTable)
      .where(and(eq(sessionsTable.emulatorId, id), isNull(sessionsTable.iterationId)));

    const deleted = await tx.delete(emulatorsTable).where(eq(emulatorsTable.id, id)).returning({
      id: emulatorsTable.id,
    });
    return deleted.length > 0;
  });
};
