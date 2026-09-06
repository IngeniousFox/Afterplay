import { timestamp, type DateValue } from './dateTypes';
import { AMBER, GREEN } from './colors';

// Shared rarity thresholds for desktop, TV and mobile achievement lists.
export const RARE = 10;
export const ULTRA_RARE = 5;

// El violeta de ultra raro — el mismo que usa el aviso flotante.
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

// EL orden canónico de una lista de logros, el mismo en escritorio y en TV:
// conseguidos primero (lo que acabas de sacar es lo que quieres ver al
// abrir), más recientes arriba; los de fecha NO fiable detrás de todos los
// fechados — su fecha es la del rescate, no la de la hazaña, y dejarlos
// arriba desplazaría a los que sí tienen un momento real detrás. Los
// pendientes al final, en el orden de Steam.
export type AchievementDisplayEntry = {
  unlockedAt: DateValue | null;
  dateReliable: boolean;
};

export const sortAchievements = <T extends AchievementDisplayEntry>(entries: readonly T[]): T[] => {
  // Partition once and sort only unlocked entries. A large locked catalog
  // keeps Steam's order without being visited by the sort comparator.
  const unlocked: T[] = [];
  const locked: T[] = [];
  for (const entry of entries) {
    (entry.unlockedAt === null ? locked : unlocked).push(entry);
  }
  unlocked.sort((a, b) => {
    if (a.dateReliable !== b.dateReliable) return a.dateReliable ? -1 : 1;
    return timestamp(b.unlockedAt!) - timestamp(a.unlockedAt!);
  });
  return [...unlocked, ...locked];
};
