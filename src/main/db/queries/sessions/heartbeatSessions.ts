import { inArray } from 'drizzle-orm';
import { getDb } from '../..';
import { sessionsTable } from '../../schema';

// Refresca el "latido" de las sesiones que el watcher tiene abiertas ahora
// mismo. Se llama cada ciclo (~5s): así, si la app muere de golpe (corte de
// luz), al recuperar se sabe que la sesión seguía viva como muy tarde en este
// instante y se cierra ahí, con un margen de error de un ciclo como mucho.
export const heartbeatSessions = async (sessionIds: number[], at: Date): Promise<void> => {
  if (sessionIds.length === 0) return;

  const db = getDb();
  await db
    .update(sessionsTable)
    .set({ lastHeartbeatAt: at })
    .where(inArray(sessionsTable.id, sessionIds));
};
