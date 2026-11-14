import { appCtx } from '../db/v2/appDb';
import { storeRaProgress } from '../db/v2/queries/achievements';
import { maybeCelebrateCompletion } from '../steam/notifications/complete';
import { enqueueAchievementToasts } from '../steam/notifications/overlay';
import { notifyAchievementsActivity } from '../steam/notify';
import { getRaGameProgress, raBadgeLockedUrl, raBadgeUrl } from './api';
import type { GameId } from '../../shared/entityIds';

// Sincronizar los logros de RetroAchievements de UN juego ya emparejado
// (RETROACHIEVEMENTS.md §4): catálogo y desbloqueos vienen JUNTOS en una
// sola petición (GetGameInfoAndUserProgress), a diferencia de Steam que los
// pide por separado. Todo lo de aguas abajo es la tubería existente:
// mismo upsert de catálogo, mismo storeUnlocks (fuente 'ra'), mismo
// emparejado con sesiones, mismos avisos.

export const syncRaGame = async (
  game: { id: GameId; title: string; raGameId: number; heroUrl: string | null },
  // Solo los refrescos EN VIVO avisan en pantalla — la misma regla que
  // Steam: el primer volcado de un historial de años no es noticia de hoy.
  notify = false,
): Promise<{ catalogCount: number; unlockedCount: number }> => {
  const progress = await getRaGameProgress(game.raGameId);
  // Catálogo y desbloqueos en UNA transacción que relee el juego: si se
  // re-emparejó con otro set durante la red, no se escribe nada.
  const stored = storeRaProgress(appCtx(), {
    gameId: game.id,
    raGameId: game.raGameId,
    definitions: progress.achievements.map((definition) => ({
      // El id numérico de RA como apiName: único por juego y estable.
      apiName: String(definition.raAchievementId),
      displayName: definition.title,
      description: definition.description,
      iconUrl: raBadgeUrl(definition.badgeName),
      iconGrayUrl: raBadgeLockedUrl(definition.badgeName),
      globalPercent: definition.globalPercent,
      sortIndex: definition.sortIndex,
      earnedAt: definition.earnedAt,
    })),
  });
  if (stored.status === 'stale') return { catalogCount: 0, unlockedCount: 0 };

  if (notify && stored.fresh.length > 0) {
    enqueueAchievementToasts(
      stored.fresh.map((toast) => ({ ...toast, gameTitle: game.title, gameHeroUrl: game.heroUrl })),
    );
    maybeCelebrateCompletion(game.id, game.title, game.heroUrl);
  }

  notifyAchievementsActivity({
    kind: 'synced',
    gameId: game.id,
    catalogCount: stored.catalogCount,
    unlockedCount: stored.unlockedCount,
  });

  return { catalogCount: stored.catalogCount, unlockedCount: stored.unlockedCount };
};
