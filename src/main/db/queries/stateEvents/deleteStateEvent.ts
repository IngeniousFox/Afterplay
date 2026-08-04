import { eq } from 'drizzle-orm';
import { getDb } from '../..';
import { stateEventsTable } from '../../schema';

// Borrado real de un evento del log. Dos llamadores, los dos correcciones de
// erratas — el log sigue siendo append-only (SPEC 4.5) para los cambios de
// estado REALES, que se apilan desde Status y nunca se reescriben:
//
//   · La corrección de playthrough del Edit modal (Beaten/Dropped → "en
//     realidad sigo jugando"): ese desenlace nunca ocurrió.
//   · La papelera del History de la ficha: un evento apuntado por error (un
//     Playing que no fue, un Resting de un despiste) se quita de en medio.
//
// Es seguro sin más ceremonia por el modelo v2: el estado actual y las
// fechas del playthrough se DERIVAN del log al leer (getGameById/getGames),
// así que quitar un evento recoloca todo lo derivado solo — no hay anclas ni
// marcadores que reparar. La iteración dueña se queda aunque se vacíe: una
// iteración sin eventos es el estado legítimo de "recién creada sin tocar"
// (resolveIterationForPlay la reanuda), y quitarla es decisión del Edit
// modal, no de esta corrección.
export const deleteStateEvent = async (id: number): Promise<boolean> => {
  const db = getDb();
  const deleted = await db
    .delete(stateEventsTable)
    .where(eq(stateEventsTable.id, id))
    .returning({ id: stateEventsTable.id });
  return deleted.length > 0;
};
