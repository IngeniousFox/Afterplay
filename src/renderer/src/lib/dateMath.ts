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

// Años (descendente) presentes en un conjunto de fechas — base del selector
// de año en Stats.tsx/GameStats.tsx.
export const yearsDesc = (dates: Date[]): number[] => {
  const set = new Set<number>();
  for (const date of dates) set.add(date.getFullYear());
  return [...set].sort((a, b) => b - a);
};
