// La honestidad de las fechas de salida, portada de
// src/renderer/src/lib/releaseDate.ts.
//
// IGDB devuelve un timestamp concreto incluso cuando solo conoce el año, así
// que la precisión viaja siempre al lado: sin ella un juego "1994" se
// convierte en un "December 31, 1994" que miente.

export type GameRelease = {
  releaseDate: number | null;
  releaseDatePrecision: 'year' | 'month' | 'day' | null;
  releaseYear: number | null;
};

const DAY_MS = 86_400_000;

const startOfDayMs = (value: Date | number): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

// ¿Este juego todavía NO ha salido? La comparación se hace con el GRANO de la
// precisión, no con el timestamp pelado: un juego "March 2026" no ha salido en
// febrero de 2026 aunque su timestamp (día 1) ya haya pasado… y sí ha salido
// en abril. Comparar días ahí daría las dos respuestas al revés.
//
// Sin fecha ninguna (un TBD de IGDB) devuelve false a propósito: "no se sabe
// cuándo sale" no es lo mismo que "sale más adelante", y mandarlo al horizonte
// lo escondería en una sección plegada sin ninguna certeza detrás.
export const isUnreleased = (game: GameRelease, now: Date = new Date()): boolean => {
  if (game.releaseDate !== null && game.releaseDatePrecision) {
    const date = new Date(game.releaseDate);
    if (game.releaseDatePrecision === 'year') return date.getFullYear() > now.getFullYear();
    if (game.releaseDatePrecision === 'month') {
      const releaseMonths = date.getFullYear() * 12 + date.getMonth();
      return releaseMonths > now.getFullYear() * 12 + now.getMonth();
    }
    // >= y no >: el DÍA del lanzamiento el juego sigue siendo espera — sale a
    // una hora que no se sabe, y hasta medianoche su sitio es el horizonte con
    // su "Out today!".
    return startOfDayMs(date) >= startOfDayMs(now);
  }
  return game.releaseYear !== null && game.releaseYear > now.getFullYear();
};

// Para ordenar el horizonte por cercanía: lo inminente arriba. Los de
// precisión gruesa caen donde cae su día 1, que es lo más cerca que se puede
// afinar sin inventar.
export const releaseSortKey = (game: GameRelease): number =>
  game.releaseDate ?? (game.releaseYear !== null ? Date.UTC(game.releaseYear, 0, 1) : 0);

// Más allá de un mes, un "en 143 días" no es información: es ruido con pinta
// de dato.
const COUNTDOWN_WINDOW_DAYS = 30;
// Dentro de la ventana, la última semana se pinta con color de acento: es
// cuando la espera deja de ser abstracta.
const IMMINENT_DAYS = 7;
// Y hacia atrás: cuánto sigue siendo noticia que un juego ya salió. Sin este
// tope, cualquier planeado con fecha de día llevaría un "OUT NOW" perpetuo.
const JUST_OUT_DAYS = 21;

export type ReleaseCountdown =
  | { kind: 'out-now' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'soon'; days: number; imminent: boolean };

// SOLO con precisión de día: no se cuentan días que no se saben. Un juego de
// "March 2026" enseña su mes y ya — inventarle una cuenta atrás desde el día 1
// sería precisión falsa, justo lo que esto existe para evitar.
export const releaseCountdown = (
  game: GameRelease,
  now: Date = new Date(),
): ReleaseCountdown | null => {
  if (game.releaseDate === null || game.releaseDatePrecision !== 'day') return null;

  // Días de CALENDARIO (medianoche local), no tramos de 24h: un juego que sale
  // mañana a las 09:00 es "1 día" aunque falten 17 horas.
  const days = Math.round((startOfDayMs(game.releaseDate) - startOfDayMs(now)) / DAY_MS);

  if (days < 0) return days >= -JUST_OUT_DAYS ? { kind: 'out-now' } : null;
  if (days === 0) return { kind: 'today' };
  if (days === 1) return { kind: 'tomorrow' };
  if (days > COUNTDOWN_WINDOW_DAYS) return null;
  return { kind: 'soon', days, imminent: days <= IMMINENT_DAYS };
};

export const countdownLabel = (countdown: ReleaseCountdown): string => {
  if (countdown.kind === 'out-now') return 'OUT NOW';
  if (countdown.kind === 'today') return 'Out today!';
  if (countdown.kind === 'tomorrow') return 'Out tomorrow';
  return `Out in ${countdown.days} days`;
};
