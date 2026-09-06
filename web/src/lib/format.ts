import type { EventDatePrecision, DatePrecision } from '../../../src/shared/dateTypes';
import { DAY_MS, startOfDayMs } from '../../../src/shared/dateMath';
import { pluralize } from '../../../src/shared/format';
import {
  formatTime as formatDateTime,
  formatDateOnly as formatDateOnlyValue,
  formatByPrecision as formatDateByPrecision,
} from '../../../src/shared/format';

export {
  formatHours,
  formatElapsed,
  pluralize,
  formatMoney,
  formatCount,
  formatBytes,
} from '../../../src/shared/format';
export { daysBetween, humanizeSpan, humanizeSpanByPrecision } from '../../../src/shared/dateMath';
export { formatRelease } from './releaseDate';

// The API transports milliseconds. Only these adapters differ from desktop.
export const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

// 24h is deliberate: the desktop clock preference belongs to electron-store
// on that PC and is not synchronized to the PWA. Match its default here.
export const formatTime = (ms: number): string => formatDateTime(new Date(ms), '24h');

export const formatDateOnly = (ms: number, precision: DatePrecision): string =>
  formatDateOnlyValue(new Date(ms), precision);

export const formatByPrecision = (ms: number, precision: EventDatePrecision): string =>
  formatDateByPrecision(new Date(ms), precision, '24h');

// Escala corta para "hace cuánto" en frases sueltas: redondear sin vergüenza,
// porque a partir de una semana nadie cuenta los días.
const humanizeShort = (days: number): string => {
  if (days < 7) return pluralize(days, 'day');
  if (days < 31) return pluralize(Math.round(days / 7), 'week');
  if (days < 365) return pluralize(Math.round(days / 30), 'month');
  const years = days / 365;
  return years < 1.5 ? 'a year' : pluralize(Math.round(years), 'year');
};

// Días de CALENDARIO, no tramos de 24 h: una sesión de ayer a las 20:00 es
// "yesterday" aunque no hayan pasado 24 horas — que es como lo cuenta
// cualquiera. Medir horas transcurridas hacía decir "today" a lo de anoche.
export const relativeDay = (ms: number): string => {
  const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(new Date(ms))) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${humanizeShort(days)} ago`;
};
