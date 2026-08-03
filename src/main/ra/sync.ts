import { eq } from 'drizzle-orm';
import { getDb, withDbAccess } from '../db';
import { achievementsTable, gamesTable } from '../db/schema';
import { maybeCelebrateCompletion } from '../steam/notifications/complete';
import { enqueueAchievementToasts } from '../steam/notifications/overlay';
import { notifyAchievementsActivity } from '../steam/notify';
import { storeUnlocks } from '../steam/syncAchievements';
import { getRaGameProgress, raBadgeLockedUrl, raBadgeUrl } from './api';

// Sincronizar los logros de RetroAchievements de UN juego ya emparejado
// (RETROACHIEVEMENTS.md §4): catálogo y desbloqueos vienen JUNTOS en una
// sola petición (GetGameInfoAndUserProgress), a diferencia de Steam que los
// pide por separado. Todo lo de aguas abajo es la tubería existente:
// mismo upsert de catálogo, mismo storeUnlocks (fuente 'ra'), mismo
// emparejado con sesiones, mismos avisos.

export const syncRaGame = async (
  game: { id: number; title: string; raGameId: number; heroUrl: string | null },
  // Solo los refrescos EN VIVO avisan en pantalla — la misma regla que
  // Steam: el primer volcado de un historial de años no es noticia de hoy.
  notify = false,
): Promise<{ catalogCount: number; unlockedCount: number }> => {
  const progress = await getRaGameProgress(game.raGameId);
  const syncedAt = new Date();

  await withDbAccess(async () =>
    getDb().transaction(async (tx) => {
      for (const definition of progress.achievements) {
        const values = {
          gameId: game.id,
          // El id numérico de RA como apiName: única por juego, estable, y
          // sin riesgo de pisarse con los apiName de Steam (que son
          // identificadores con letras).
          apiName: String(definition.raAchievementId),
          displayName: definition.title,
          description: definition.description,
          iconUrl: raBadgeUrl(definition.badgeName),
          iconGrayUrl: raBadgeLockedUrl(definition.badgeName),
          // RA no tiene logros ocultos al estilo Steam: la descripción es
          // pública siempre.
          hidden: false,
          globalPercent: definition.globalPercent,
          sortIndex: definition.sortIndex,
        };
        await tx
          .insert(achievementsTable)
          .values(values)
          .onConflictDoUpdate({
            target: [achievementsTable.gameId, achievementsTable.apiName],
            set: {
              displayName: values.displayName,
              description: values.description,
              iconUrl: values.iconUrl,
              iconGrayUrl: values.iconGrayUrl,
              hidden: values.hidden,
              globalPercent: values.globalPercent,
              sortIndex: values.sortIndex,
            },
          });
      }

      await tx
        .update(gamesTable)
        // Las dos marcas a la vez, porque aquí catálogo y desbloqueos llegan
        // juntos: la ficha necesita unlocksSyncedAt para enseñar porcentaje.
        .set({ achievementsSyncedAt: syncedAt, achievementsUnlocksSyncedAt: syncedAt })
        .where(eq(gamesTable.id, game.id));
    }),
  );

  const unlocks = progress.achievements
    .filter((definition) => definition.earnedAt !== null)
    .map((definition) => ({
      apiName: String(definition.raAchievementId),
      unlockedAt: definition.earnedAt,
    }));

  const fresh = await storeUnlocks(game.id, 'ra', unlocks, syncedAt);
  if (notify && fresh.length > 0) {
    enqueueAchievementToasts(
      fresh.map((toast) => ({ ...toast, gameTitle: game.title, gameHeroUrl: game.heroUrl })),
    );
    maybeCelebrateCompletion(game.id, game.title, game.heroUrl);
  }

  notifyAchievementsActivity({
    kind: 'synced',
    gameId: game.id,
    catalogCount: progress.achievements.length,
    unlockedCount: unlocks.length,
  });

  return { catalogCount: progress.achievements.length, unlockedCount: unlocks.length };
};
