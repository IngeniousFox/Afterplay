import type { EventDatePrecision } from '../../../shared/types';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const startOfDayMs = (date: Date): number => startOfDay(date).getTime();

// Sumar días vía setDate (no sumando milisegundos): al cruzar un cambio de
// hora (DST) un día "dura" 23h o 25h, y la aritmética en ms iría dejando la
// medianoche calculada una hora corrida — con lo que los días de la rejilla
// (o de una racha) dejarían de casar con las claves reales (medianoche
// local) de las sesiones. setDate mantiene siempre las 00:00 locales.
export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export const daysBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / DAY_MS;

// "3 days" / "8 months" — un tramo de tiempo en la unidad que mejor se lee:
// días hasta ~2 meses, meses hasta ~2 años, años después. Vive aquí y no en
// format.ts porque es aritmética de calendario, no formato de presentación:
// lo usan la línea temporal de las stats de un juego, la tira de viaje del
// playthrough y el "llevas X en este estado" del Status.
export const humanizeSpan = (days: number): string => {
  if (days < 1) return 'less than a day';
  if (days < 60) return `${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
  if (days < 730) return `${Math.round(days / 30.44)} months`;
  return `${Math.round(days / 365.25)} years`;
};

// Un tramo entre dos fechas cuya precisión puede ser gruesa. Con precisión de
// AÑO o MES, la fecha guardada es el día 1 a medianoche: restarlas da un
// número de días que no significa nada — un juego empezado y terminado en
// 2021 salía como "less than a day". La unidad del resultado nunca puede ser
// más fina que la más gruesa de las dos precisiones, así que ahí se cuentan
// años o meses de calendario, y si caen en el mismo se dice justo eso en vez
// de inventar una duración.
export const humanizeSpanByPrecision = (
  from: Date,
  to: Date,
  fromPrecision: EventDatePrecision,
  toPrecision: EventDatePrecision,
): string => {
  const coarsest =
    fromPrecision === 'year' || toPrecision === 'year'
      ? 'year'
      : fromPrecision === 'month' || toPrecision === 'month'
        ? 'month'
        : 'day';

  if (coarsest === 'year') {
    const years = to.getFullYear() - from.getFullYear();
    if (years <= 0) return 'Same year';
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }

  if (coarsest === 'month') {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (months <= 0) return 'Same month';
    return `${months} ${months === 1 ? 'month' : 'months'}`;
  }

  return humanizeSpan(daysBetween(from, to));
};

// Clave de mes comparable y ordenable: año*12+mes. Un solo número por mes,
// que además se puede restar para saber cuántos meses hay entre dos — y sin
// el riesgo de confundir enero de 2025 con enero de 2024, que es lo que pasa
// agrupando por getMonth() a secas.
export const monthKey = (date: Date): number => date.getFullYear() * 12 + date.getMonth();

// Los 12 meses que cubre una gráfica mensual de Stats: con "All Time", los
// últimos doce terminando en el actual (actividad reciente, no toda la vida
// apelotonada en doce barras); con un año concreto, sus enero-diciembre.
//
// Compartido por Hours per month y Spend per month a propósito: van una
// encima de la otra en la misma pantalla, así que sus barras tienen que
// caer en el mismo mes. Con la ventana calculada por separado en cada una,
// bastaba tocar solo una para descuadrarlas sin que se notara.
export const twelveMonthWindow = (year: number | 'all'): Date[] => {
  const now = new Date();
  const first =
    year === 'all' ? new Date(now.getFullYear(), now.getMonth() - 11, 1) : new Date(year, 0, 1);
  return Array.from(
    { length: 12 },
    (_, index) => new Date(first.getFullYear(), first.getMonth() + index, 1),
  );
};

// Años (descendente) presentes en un conjunto de fechas — base del selector
// de año en Stats.tsx/GameStats.tsx.
export const yearsDesc = (dates: Date[]): number[] => {
  const set = new Set<number>();
  for (const date of dates) set.add(date.getFullYear());
  return [...set].sort((a, b) => b - a);
};
