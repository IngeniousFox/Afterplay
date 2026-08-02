import type { AchievementEntry } from '../../../shared/types';
import { AMBER, GREEN } from './colors';

// La gramática de RAREZA de los logros, compartida por la ficha de
// escritorio y la pestaña del modo TV (el aviso flotante del main tiene su
// copia propia: es otro proceso y no puede importar de aquí). Los cortes son
// los de la propia Steam: por debajo del 10% un logro ya es poco común, por
// debajo del 5% es de los que se presumen.
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
export const sortForDisplay = (entries: AchievementEntry[]): AchievementEntry[] => {
  const unlocked = entries
    .filter((entry) => entry.unlockedAt !== null)
    .sort((a, b) => {
      if (a.dateReliable !== b.dateReliable) return a.dateReliable ? -1 : 1;
      return (b.unlockedAt as Date).getTime() - (a.unlockedAt as Date).getTime();
    });
  const locked = entries.filter((entry) => entry.unlockedAt === null);
  return [...unlocked, ...locked];
};
