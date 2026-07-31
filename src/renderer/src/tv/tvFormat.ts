import { DAY_MS, humanizeSpan, startOfDayMs } from '../lib/dateMath';

// "Played today" / "Yesterday" / "3 weeks ago" — el último contacto con un
// juego, contado en días de CALENDARIO (medianoche local), la misma regla
// que GameCard y Sessions: una sesión de ayer a las 20:00 es "yesterday"
// aunque no hayan pasado 24 horas.
export const humanizeAgoDays = (date: Date): string => {
  const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(date)) / DAY_MS);
  if (days <= 0) return 'Played today';
  if (days === 1) return 'Yesterday';
  return `${humanizeSpan(days)} ago`;
};
