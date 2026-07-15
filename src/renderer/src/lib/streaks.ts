// Rachas de días jugados (estilo Steam/Duolingo). Un día cuenta si ese día
// se ABRIÓ al menos una sesión trackeada de verdad — isManual false, mismo
// criterio que el Activity heatmap: las sesiones manuales de "registrar el
// pasado" pueden llevar precisión de solo mes/año, no representan un día
// concreto jugado.

type StreakSession = { startedAt: Date; isManual: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

// setDate y no aritmética de milisegundos — al cruzar un cambio de hora un
// día "dura" 23h/25h y la medianoche calculada se correría una hora (mismo
// cuidado que ActivityHeatmap.tsx).
const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Días jugados como claves de medianoche local (ms) — la base de las dos
// funciones de abajo. Cuentan también las sesiones aún abiertas (abrir la
// sesión ya suma el día, no hace falta que termine).
export const playedDayKeys = (sessions: StreakSession[]): Set<number> => {
  const keys = new Set<number>();
  for (const session of sessions) {
    if (session.isManual) continue;
    keys.add(startOfDay(session.startedAt).getTime());
  }
  return keys;
};

// La racha más larga de días CONSECUTIVOS. Con `year`, solo cuentan los días
// de ese año — una racha que cruza Nochevieja se corta en el borde: "la más
// larga de ese año" es de días de ese año, no un arrastre de otros.
export const longestStreak = (dayKeys: Set<number>, year?: number): number => {
  const days = [...dayKeys]
    .filter((ms) => year === undefined || new Date(ms).getFullYear() === year)
    .sort((a, b) => a - b);

  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of days) {
    // Redondeo por los cambios de hora — un salto de "un día" puede ser de
    // 23h o 25h en ms y aun así ser consecutivo.
    run = previous !== null && Math.round((day - previous) / DAY_MS) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
};

// La racha actual: días consecutivos hasta hoy. Si hoy todavía no se ha
// jugado pero ayer sí, la racha sigue VIVA (aún puede extenderse jugando
// hoy) — solo se pierde cuando pasa un día entero sin jugar.
export const currentStreak = (dayKeys: Set<number>): number => {
  const today = startOfDay(new Date());
  let cursor = dayKeys.has(today.getTime()) ? today : addDays(today, -1);
  if (!dayKeys.has(cursor.getTime())) return 0;

  let streak = 0;
  while (dayKeys.has(cursor.getTime())) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
};
