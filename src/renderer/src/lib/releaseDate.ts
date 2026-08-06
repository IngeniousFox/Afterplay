import type { ReleaseDatePrecision } from '../../../shared/types';
import { DAY_MS, startOfDayMs } from './dateMath';
import { formatDateOnly } from './format';

// La fecha de salida de un juego, pintada con la HONESTIDAD de siempre
// (PLAN-TO-PLAY.md §7bis): IGDB devuelve un timestamp concreto incluso cuando
// solo conoce el año, así que sin la precisión al lado un juego "1994" a
// secas se convertiría en un "December 31, 1994" que miente. Con ella, cada
// juego dice lo que de verdad se sabe de él: "March 17, 2017", "March 1995" o
// "1995".
//
// La misma pieza sirve para RELEASED en la ficha y para "On the horizon" en
// el Plan — un solo sitio donde vive la regla.

export type GameRelease = {
  releaseDate: Date | null;
  releaseDatePrecision: ReleaseDatePrecision | null;
  // El año de toda la vida, que sigue existiendo y no se toca: es el respaldo
  // cuando IGDB no da fecha usable (un TBD, un formato nuevo que no sabemos
  // leer) y lo que siguen usando las stats y el matching de HowLongToBeat.
  releaseYear: number | null;
};

// El texto de RELEASED. null si no se sabe nada de nada.
export const formatRelease = (game: GameRelease): string | null => {
  if (game.releaseDate && game.releaseDatePrecision) {
    return formatDateOnly(game.releaseDate, game.releaseDatePrecision);
  }
  return game.releaseYear === null ? null : String(game.releaseYear);
};

// ¿Este juego todavía NO ha salido? La comparación se hace con el grano de la
// precisión, no con el timestamp pelado: un juego "March 2026" no ha salido
// en febrero de 2026 aunque su timestamp (día 1) ya haya pasado… y sí ha
// salido en abril. Comparar días ahí daría las dos respuestas al revés.
//
// Sin fecha ninguna (un TBD de IGDB) devuelve false a propósito: "no se sabe
// cuándo sale" no es lo mismo que "sale más adelante", y mandarlo al
// horizonte lo escondería en una sección plegada sin ninguna certeza detrás.
// Se queda en la cola normal, a la vista.
export const isUnreleased = (game: GameRelease, now: Date = new Date()): boolean => {
  if (game.releaseDate && game.releaseDatePrecision) {
    const date = game.releaseDate;
    if (game.releaseDatePrecision === 'year') return date.getFullYear() > now.getFullYear();
    if (game.releaseDatePrecision === 'month') {
      const releaseMonths = date.getFullYear() * 12 + date.getMonth();
      return releaseMonths > now.getFullYear() * 12 + now.getMonth();
    }
    // >= y no >: el DÍA del lanzamiento el juego sigue siendo espera — sale a
    // una hora que no se sabe, y hasta medianoche su sitio es el horizonte con
    // su "Out today!". Con > caía en un hueco real (bug cazado con un juego
    // que salía "hoy en 7 horas"): ya no era "sin salir" (su día es hoy) pero
    // tampoco "recién salido" (el countdown pide días NEGATIVOS para el OUT
    // NOW) — así que iba a la cola normal sin ningún badge, como un juego
    // cualquiera. Mañana, con days < 0, pasa a la cola con su OUT NOW.
    return startOfDayMs(date) >= startOfDayMs(now);
  }
  return game.releaseYear !== null && game.releaseYear > now.getFullYear();
};

// Para ordenar el horizonte por cercanía: lo inminente arriba. Los de
// precisión gruesa caen donde cae su día 1, que es lo más cerca que se puede
// afinar sin inventar.
export const releaseSortKey = (game: GameRelease): number =>
  game.releaseDate?.getTime() ?? (game.releaseYear !== null ? Date.UTC(game.releaseYear, 0, 1) : 0);

// Ventana de la cuenta atrás. Más allá de un mes, un "en 143 días" no es
// información: es ruido con pinta de dato.
const COUNTDOWN_WINDOW_DAYS = 30;
// Y dentro de la ventana, la última semana se pinta con color de acento —
// es cuando la espera deja de ser abstracta.
const IMMINENT_DAYS = 7;
// Y hacia atrás: cuánto tiempo sigue siendo noticia que un juego ya salió.
// Sin este tope, CUALQUIER juego planeado con fecha de día llevaría un "OUT
// NOW" perpetuo — Chrono Trigger salió en 1995 y eso no es una novedad.
const JUST_OUT_DAYS = 21;

export type ReleaseCountdown =
  // Salió hace nada y sigue en el Plan sin promocionar. Cubre el hueco entre
  // que un juego sale y te enteras: en vez de irse del horizonte a la cola en
  // silencio, durante unas semanas te grita que ya está aquí — que es
  // exactamente el empujón a bajártelo y pasarlo a la biblioteca.
  | { kind: 'out-now' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'soon'; days: number; imminent: boolean };

// SOLO con precisión de día (§11.18): no se cuentan días que no se saben. Un
// juego de "March 2026" enseña su mes y ya — inventarle una cuenta atrás
// desde el día 1 sería precisión falsa, justo lo que estas dos columnas
// existen para evitar.
export const releaseCountdown = (
  game: GameRelease,
  now: Date = new Date(),
): ReleaseCountdown | null => {
  if (!game.releaseDate || game.releaseDatePrecision !== 'day') return null;

  // Días de CALENDARIO (medianoche local), no tramos de 24h: un juego que
  // sale mañana a las 09:00 son "1 día" aunque falten 17 horas — que es como
  // lo cuenta cualquiera, y la misma regla que ya usan las cards de la
  // biblioteca y los cubos de la pantalla de Sesiones.
  const days = Math.round((startOfDayMs(game.releaseDate) - startOfDayMs(now)) / DAY_MS);

  if (days < 0) return days >= -JUST_OUT_DAYS ? { kind: 'out-now' } : null;
  if (days === 0) return { kind: 'today' };
  if (days === 1) return { kind: 'tomorrow' };
  if (days > COUNTDOWN_WINDOW_DAYS) return null;
  return { kind: 'soon', days, imminent: days <= IMMINENT_DAYS };
};

// El texto de la cuenta atrás, en el mismo inglés que el resto de la UI.
export const countdownLabel = (countdown: ReleaseCountdown): string => {
  if (countdown.kind === 'out-now') return 'OUT NOW';
  if (countdown.kind === 'today') return 'Out today!';
  if (countdown.kind === 'tomorrow') return 'Out tomorrow';
  return `Out in ${countdown.days} days`;
};
