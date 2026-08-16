import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../..';
import { sessionsTable } from '../../schema';

// Descartar una sesión de emulador sin asignar (abriste el emulador solo
// para configurarlo, no para jugar) — el guard `isNull(iterationId)` es a
// propósito: por esta vía SOLO se puede borrar una pendiente, nunca una ya
// asignada a un juego (eso sería tiempo jugado real, borrarlo es una
// decisión distinta que esta función no cubre).
//
// Y `isNotNull(endedAt)`: tampoco una que siga EN MARCHA. Faltaba, y era el
// mismo caso que deleteSession rechaza con una excepción — con el emulador
// todavía abierto, borrar la fila deja al watcher siguiendo un id que ya no
// existe: los latidos escriben en el vacío, closeSessionIfOpen devuelve null
// al morir el proceso, y se pierde el resto de la sesión sin que salte
// siquiera el aviso de cierre. La única guarda viva era de interfaz (la
// bandeja esconde el botón mientras la card está LIVE), o sea que el backend
// no decía que no.
//
// Devuelve false en vez de lanzar, como ya hacía para una sesión ya asignada:
// quien llama solo necesita saber que no se borró.
export const deletePendingSession = async (id: number): Promise<boolean> => {
  const db = getDb();
  const deleted = await db
    .delete(sessionsTable)
    .where(
      and(
        eq(sessionsTable.id, id),
        isNull(sessionsTable.iterationId),
        isNotNull(sessionsTable.endedAt),
      ),
    )
    .returning({ id: sessionsTable.id });
  return deleted.length > 0;
};
