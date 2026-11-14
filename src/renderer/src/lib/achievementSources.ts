import type { AchievementCatalogSource } from '../../../shared/types';

// El nombre de cada catálogo de logros en la interfaz. El completado va por
// fuente (decisión R-11): un juego con Steam y RetroAchievements al 100 % sale
// dos veces en el muro, y cada vez tiene que decir de cuál es.
export const ACHIEVEMENT_SOURCE_LABEL: Record<AchievementCatalogSource, string> = {
  steam: 'Steam',
  ra: 'RetroAchievements',
};
