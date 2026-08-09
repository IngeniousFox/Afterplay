import type { AchievementEntry } from '../api';
import { AMBER, GREEN } from './status';

// Umbrales de rareza, portados de src/renderer/src/lib/achievements.ts.
export const RARE = 10;
export const ULTRA_RARE = 5;

// El violeta de ultra raro — el mismo que usa el aviso flotante del escritorio.
export const ULTRA_VIOLET = '#e0a3ff';

// El color de un logro CONSEGUIDO según su rareza: verde de la casa por
// defecto, ámbar si es raro, violeta si casi nadie lo tiene.
export const rarityAccent = (percent: number | null): string => {
  if (percent === null || percent >= RARE) return GREEN;
  return percent < ULTRA_RARE ? ULTRA_VIOLET : AMBER;
};

export const isRare = (percent: number | null): percent is number =>
  percent !== null && percent < RARE;

// Un decimal solo cuando aporta: "48%" se lee mejor que "47.6%", pero en un
// logro del 0.4% el decimal ES la noticia.
export const percentLabel = (percent: number): string =>
  percent >= 10 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;

// EL orden canónico de una lista de logros, el mismo que en el escritorio:
// conseguidos primero (lo que acabas de sacar es lo que quieres ver al abrir),
// más recientes arriba; los de fecha NO fiable detrás de todos los fechados —
// su fecha es la del rescate, no la de la hazaña. Los pendientes al final, en
// el orden de Steam.
export const sortAchievements = (entries: AchievementEntry[]): AchievementEntry[] =>
  [...entries].sort((a, b) => {
    const aUnlocked = a.unlockedAt !== null;
    const bUnlocked = b.unlockedAt !== null;
    if (aUnlocked !== bUnlocked) return aUnlocked ? -1 : 1;
    if (!aUnlocked) return 0;
    if (a.dateReliable !== b.dateReliable) return a.dateReliable ? -1 : 1;
    return (b.unlockedAt as number) - (a.unlockedAt as number);
  });
