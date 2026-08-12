import { eq, inArray, isNotNull } from 'drizzle-orm';
import { getDb } from '../..';
import type { SessionUnlock } from '../../../../shared/types';
import { achievementsTable, achievementUnlocksTable } from '../../schema';
import { mergeUnlocksByAchievement } from './mergeUnlocks';

// Todos los desbloqueos COLGADOS de una sesión, para la pantalla global de
// Sesiones (LOGROS-IDEAS.md §2.1): cada fila de sesión enseña sus trofeos
// sin que la vista tenga que pedir los logros de cada juego. Solo viajan los
// que tienen sessionId — los huérfanos del pasado no pertenecen a ninguna
// fila (regla 3 del documento).
export const getSessionUnlocks = async (): Promise<SessionUnlock[]> => {
  const db = getDb();

  // La fila NO se filtra por sessionId, pero el LOGRO sí: el fundido de abajo
  // necesita ver todas las filas de un logro para elegir bien —quedándose solo
  // con las que ya tienen sesión, una perdedora representaba al trofeo por el
  // mero hecho de tenerla y la ganadora ni se miraba, otra vez una respuesta
  // distinta a la de la ficha—, pero un logro del que NINGUNA fuente cayó en
  // una sesión no puede ganar nada aquí, gane quien gane.
  //
  // El acotado no es cosmético: sin él esto era un escaneo de
  // achievement_unlocks entera (39.602 filas en producción) con su join,
  // materializando nombre, icono y rareza de cada una — y esta consulta la
  // piden la pantalla de Sesiones y el HUD del overlay EN PLENA PARTIDA. Con
  // la subconsulta, el join solo paga por los logros que de verdad tienen
  // sesión, y el IN entra por achievement_unlocks_source_unique, que lleva
  // achievementId de primera columna.
  const achievementsWithSession = db
    .select({ achievementId: achievementUnlocksTable.achievementId })
    .from(achievementUnlocksTable)
    .where(isNotNull(achievementUnlocksTable.sessionId));

  const rows = await db
    .select({
      sessionId: achievementUnlocksTable.sessionId,
      achievementId: achievementUnlocksTable.achievementId,
      unlockedAt: achievementUnlocksTable.unlockedAt,
      dateReliable: achievementUnlocksTable.dateReliable,
      displayName: achievementsTable.displayName,
      iconUrl: achievementsTable.iconUrl,
      globalPercent: achievementsTable.globalPercent,
    })
    .from(achievementUnlocksTable)
    .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id))
    .where(inArray(achievementUnlocksTable.achievementId, achievementsWithSession));

  // Un trofeo, UNA sesión: manda la fuente ganadora del fundido de la casa
  // (mergeUnlocks.ts) y con ella viaja SU sesión, exactamente igual que en la
  // ficha del juego (getGameAchievements → SessionHistoryList). Aquí antes se
  // deduplicaba por (sesión, logro), que junta las dos fuentes solo si
  // cayeron en la MISMA sesión: un logro sacado con el crack en 2025 y otra
  // vez en Steam en 2026 salía en las dos filas de sesión —dos trofeos donde
  // hay uno— y la suma de la pantalla ya no cuadraba con los logros del juego.
  const result: SessionUnlock[] = [];
  for (const { winner } of mergeUnlocksByAchievement(rows).values()) {
    if (winner.sessionId === null) continue;
    result.push({
      sessionId: winner.sessionId,
      achievementId: winner.achievementId,
      displayName: winner.displayName,
      iconUrl: winner.iconUrl,
      globalPercent: winner.globalPercent,
    });
  }
  return result;
};
