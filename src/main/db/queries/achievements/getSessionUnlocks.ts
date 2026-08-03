import { isNotNull } from 'drizzle-orm';
import { getDb } from '../..';
import { eq } from 'drizzle-orm';
import type { SessionUnlock } from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable } from '../../schema';

// Todos los desbloqueos COLGADOS de una sesión, para la pantalla global de
// Sesiones (LOGROS-IDEAS.md §2.1): cada fila de sesión enseña sus trofeos
// sin que la vista tenga que pedir los logros de cada juego. Solo viajan los
// que tienen sessionId — los huérfanos del pasado no pertenecen a ninguna
// fila (regla 3 del documento).
export const getSessionUnlocks = async (): Promise<SessionUnlock[]> => {
  const rows = await getDb()
    .select({
      sessionId: achievementUnlocksTable.sessionId,
      achievementId: achievementUnlocksTable.achievementId,
      displayName: achievementsTable.displayName,
      iconUrl: achievementsTable.iconUrl,
      globalPercent: achievementsTable.globalPercent,
    })
    .from(achievementUnlocksTable)
    .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id))
    .where(isNotNull(achievementUnlocksTable.sessionId));

  // Dedupe por (sesión, logro): el mismo logro puede constar por dos fuentes
  // colocadas en la misma sesión, y en pantalla es UN trofeo, no dos.
  const seen = new Set<string>();
  const result: SessionUnlock[] = [];
  for (const row of rows) {
    if (row.sessionId === null) continue;
    const key = `${row.sessionId}:${row.achievementId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      sessionId: row.sessionId,
      achievementId: row.achievementId,
      displayName: row.displayName,
      iconUrl: row.iconUrl,
      globalPercent: row.globalPercent,
    });
  }
  return result;
};
