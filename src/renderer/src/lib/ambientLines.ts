import type { GameListItem, SessionWithGame, StateEventSummary } from '../../../shared/types';
import { formatElapsed, formatHours, formatMoney } from './format';

// Lo que el modo ambiente susurra debajo del título.
//
// La regla que manda sobre todo lo demás: esto NO es un panel de estadísticas
// con fondo bonito. Una cifra suelta ("47.3h · 12 sesiones") convierte el
// momento en un informe. Lo que se busca es un recuerdo, dicho como se lo
// dirías a alguien: "te tiraste 47 horas aquí dentro".
//
// Por eso cada frase:
//   · va en minúsculas y en segunda persona,
//   · redondea sin pudor (46.8h -> "47 horas"; nadie recuerda decimales),
//   · y solo existe si de verdad tiene algo que contar. Un juego sin historia
//     se queda sin frase y se ve la carátula sola. Mejor el silencio que
//     rellenar con "0 horas jugadas".
//
// El objetivo declarado es que NO se repita: se generan todas las frases que
// ese juego puede decir hoy y se elige una por sorteo (con la semilla que da
// quien llama), en vez de coger siempre la primera de una lista de
// prioridades. Un juego con mucha historia puede tener quince cosas distintas
// que contarte, y así las va soltando.

const DAY_MS = 24 * 60 * 60 * 1000;

const daysBetween = (from: Date, to: number): number => Math.floor((to - from.getTime()) / DAY_MS);

// "hace 3 años" / "hace 5 meses" / "la semana pasada". Nunca "hace 1096 días".
const humanizeAgo = (days: number): string | null => {
  if (days < 6) return null;
  if (days < 14) return 'last week';
  if (days < 45) return `${Math.round(days / 7)} weeks ago`;
  if (days < 340) return `${Math.round(days / 30)} months ago`;
  const years = days / 365;
  if (years < 1.75) return 'a year ago';
  return `${Math.round(years)} years ago`;
};

// Aniversarios: ±3 días de margen porque la gracia es que salte "hoy hace un
// año", no exigir que abras la app el día exacto.
const anniversaryYears = (date: Date, now: number): number | null => {
  const days = daysBetween(date, now);
  if (days < 300) return null;
  const years = days / 365.25;
  const nearest = Math.round(years);
  if (nearest < 1) return null;
  return Math.abs(years - nearest) * 365.25 <= 3 ? nearest : null;
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

// La franja del día en la que sueles jugarlo, solo si hay un patrón CLARO
// (más de la mitad de las sesiones). Si juegas a todas horas no hay nada
// interesante que decir, y forzarlo sería inventarse un patrón.
const dominant = <T extends string | number>(
  values: T[],
  minShare: number,
): { value: T; share: number } | null => {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T = values[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  const share = bestCount / values.length;
  return share >= minShare ? { value: best, share } : null;
};

const timeOfDayName = (hour: number): string => {
  if (hour < 5) return 'the middle of the night';
  if (hour < 12) return 'the morning';
  if (hour < 18) return 'the afternoon';
  if (hour < 22) return 'the evening';
  return 'late at night';
};

export type AmbientContext = {
  // Sesiones DE ESTE juego, ya filtradas por quien llama.
  sessions: SessionWithGame[];
  // Eventos de estado de este juego.
  events: StateEventSummary[];
  // Puesto del juego en el ranking de horas de toda la biblioteca (1 = el más
  // jugado). null si no tiene horas.
  rank: number | null;
  // Horas totales de la biblioteca entera, para el "esto es un X% de todo lo
  // que has jugado".
  libraryHours: number;
  // Lo que te costó este juego (compra + gasto dentro). 0 si nada.
  spend: number;
  // Cuántos juegos hay en la biblioteca, para situarlo en el conjunto.
  libraryGames: number;
  // El primero que añadiste nunca, y el último. Dos frases que solo puede
  // decir un juego de toda la biblioteca cada una.
  isOldestInLibrary: boolean;
  isNewestInLibrary: boolean;
  // Cuántos juegos MÁS terminaste el mismo año que este.
  completedSameYear: number;
  // Qué estabas jugando justo antes de empezar este. El detalle que convierte
  // una ficha en un recuerdo: "lo dejaste por esto".
  playedJustBefore: string | null;
};

export const ambientLines = (
  game: GameListItem,
  context: AmbientContext,
  now: number,
): string[] => {
  const lines: string[] = [];
  const hours = game.totalHours;
  const {
    sessions,
    events,
    rank,
    libraryHours,
    spend,
    libraryGames,
    isOldestInLibrary,
    isNewestInLibrary,
    completedSameYear,
    playedJustBefore,
  } = context;
  // Las manuales tienen fecha imprecisa (un "marzo de 2021" no tiene hora),
  // así que quedan fuera de todo lo que hable de horarios o duraciones.
  const tracked = sessions.filter((session) => !session.isManual && session.durationSec !== null);

  // ── Aniversarios: lo más bonito que puede decir, porque es lo único que no
  // sabrías tú solo ──────────────────────────────────────────────────────
  const addedYears = anniversaryYears(game.addedAt, now);
  if (addedYears !== null) {
    lines.push(
      addedYears === 1
        ? 'a year ago today, this entered your library'
        : `${addedYears} years ago today, this entered your library`,
    );
  }

  const completedEvent = events
    .filter((event) => event.type === 'completed')
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (completedEvent) {
    const years = anniversaryYears(completedEvent.occurredAt, now);
    if (years !== null) {
      lines.push(
        years === 1
          ? 'you finished this a year ago today'
          : `you finished this ${years} years ago today`,
      );
    }
  }

  const firstSession = tracked
    .slice()
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0];
  if (firstSession) {
    const years = anniversaryYears(firstSession.startedAt, now);
    if (years !== null) {
      lines.push(
        years === 1
          ? 'one year ago today, you played this for the first time'
          : `${years} years ago today, you played this for the first time`,
      );
    }
  }

  // ── Horas: la cifra dicha como recuerdo, nunca como dato ───────────────
  if (hours >= 200) lines.push(`${Math.round(hours)} hours. this one took a piece of your life`);
  else if (hours >= 100) lines.push(`you gave this ${Math.round(hours)} hours`);
  else if (hours >= 40) lines.push(`${Math.round(hours)} hours in here`);
  else if (hours >= 8) lines.push(`${Math.round(hours)} hours of your life are in this one`);

  // ── La sesión más larga: el dato que más recuerda la gente ─────────────
  const longest = tracked.reduce<SessionWithGame | null>(
    (best, session) =>
      best === null || (session.durationSec ?? 0) > (best.durationSec ?? 0) ? session : best,
    null,
  );
  if (longest && (longest.durationSec ?? 0) >= 2 * 3600) {
    const label = formatElapsed(longest.durationSec ?? 0);
    lines.push(`your longest sitting here was ${label}`);
    const when = longest.startedAt;
    lines.push(`${MONTHS[when.getMonth()]} ${when.getFullYear()}: ${label} without getting up`);
  }

  // ── Cuántas veces has vuelto ───────────────────────────────────────────
  if (tracked.length >= 30) lines.push(`${tracked.length} separate times you sat down with this`);
  else if (tracked.length >= 8) lines.push(`${tracked.length} sessions with this one`);

  // ── Cuándo lo juegas: patrones que no sabías de ti ─────────────────────
  if (tracked.length >= 6) {
    const byWeekday = dominant(
      tracked.map((session) => session.startedAt.getDay()),
      0.4,
    );
    if (byWeekday) lines.push(`this is your ${WEEKDAYS[byWeekday.value]} game`);

    // La franja tiene que salir en más de la mitad de las sesiones: si juegas
    // a todas horas no hay patrón que contar, y forzarlo sería inventárselo.
    const slot = dominant(
      tracked.map((session) => timeOfDayName(session.startedAt.getHours())),
      0.5,
    );
    if (slot) lines.push(`you always come to this one in ${slot.value}`);
  }

  // ── Cuándo empezó todo ─────────────────────────────────────────────────
  if (firstSession) {
    const when = firstSession.startedAt;
    lines.push(`it all started in ${MONTHS[when.getMonth()]} ${when.getFullYear()}`);
    lines.push(`you opened this for the first time on a ${WEEKDAYS[when.getDay()]}`);

    // Cuánto se estiró en el calendario: un juego de 20h repartidas en dos
    // años no es la misma historia que 20h en un fin de semana, y esa
    // diferencia no la cuenta ninguna otra cifra.
    const lastSession = tracked.reduce((latest, session) =>
      session.startedAt.getTime() > latest.startedAt.getTime() ? session : latest,
    );
    const spanDays = daysBetween(firstSession.startedAt, lastSession.startedAt.getTime());
    if (spanDays >= 400) {
      lines.push(`you have been playing this on and off for ${Math.round(spanDays / 365)} years`);
    } else if (spanDays >= 60) {
      lines.push(`this one stretched across ${Math.round(spanDays / 30)} months`);
    } else if (spanDays >= 2 && spanDays <= 9 && hours >= 10) {
      lines.push(`${Math.round(hours)} hours in barely ${spanDays} days. you devoured this`);
    }
  }

  // ── En cuántas sentadas lo despachaste ─────────────────────────────────
  if (game.currentState === 'completed' && tracked.length >= 2 && tracked.length <= 6) {
    lines.push(`you finished this in just ${tracked.length} sittings`);
  }

  // ── Lo que llevas tiempo sin tocar: el "¿y qué fue de...?" ─────────────
  if (game.lastPlayedAt && game.currentState !== 'completed') {
    const ago = humanizeAgo(daysBetween(game.lastPlayedAt, now));
    if (ago) {
      lines.push(`you last played this ${ago}`);
      if (game.currentState === 'started') lines.push(`still unfinished. you left it ${ago}`);
    }
  }

  // ── Estado actual, cada uno con su tono ────────────────────────────────
  if (game.currentState === 'completed' && hours > 0) {
    lines.push(`you finished this. ${formatHours(hours)} well spent`);
    lines.push('this one you saw through to the end');
  }
  if (game.currentState === 'dropped') {
    lines.push('you walked away from this one');
    if (hours >= 5) lines.push(`${Math.round(hours)} hours before you called it`);
  }
  if (game.currentState === 'on_hold') lines.push('paused, not forgotten');
  if (game.currentState === 'resting') lines.push('resting. it will be there when you want it');

  // ── Rejugadas ──────────────────────────────────────────────────────────
  const playthroughs = new Set(events.map((event) => event.iterationId)).size;
  if (playthroughs > 1) {
    lines.push(
      playthroughs === 2
        ? 'you came back to this one a second time'
        : `${playthroughs} times you have started this from scratch`,
    );
  }

  // ── Tú contra HowLongToBeat ────────────────────────────────────────────
  if (game.hltbMain !== null && hours > 0 && game.currentState === 'completed') {
    const ratio = hours / game.hltbMain;
    if (ratio >= 1.6)
      lines.push(
        `most people finish this in ${Math.round(game.hltbMain)} hours. you took ${Math.round(hours)}`,
      );
    else if (ratio <= 0.65) lines.push(`you got through this faster than most`);
  }
  if (game.hltbMain !== null && game.currentState === null && game.hltbMain >= 1) {
    lines.push(`about ${Math.round(game.hltbMain)} hours are waiting in here`);
  }

  // ── Su sitio en tu biblioteca ──────────────────────────────────────────
  if (rank !== null && rank <= 3 && hours > 0) {
    lines.push(
      rank === 1 ? 'the most played game in your library' : `your #${rank} most played game`,
    );
  }
  if (libraryHours > 0 && hours / libraryHours >= 0.08) {
    lines.push(`${Math.round((hours / libraryHours) * 100)}% of everything you have ever played`);
  }

  // ── El juego en sí: edad, género, rarezas ──────────────────────────────
  if (game.releaseYear !== null) {
    const age = new Date(now).getFullYear() - game.releaseYear;
    if (age >= 15) lines.push(`from ${game.releaseYear}. older than a lot of people playing it`);
    else if (age >= 6 && hours > 0) lines.push(`released in ${game.releaseYear}`);
  }
  if (game.endless) lines.push('no ending here. that was always the point');
  if (game.isEmulated) lines.push('kept alive through an emulator');
  // El género se dice como pertenencia y no como "47 horas de platform", que
  // en inglés no se sostiene: los géneros de IGDB son sustantivos sueltos
  // ("Platform", "Shooter", "Role-playing (RPG)") y meterlos detrás de "hours
  // of" da frases rotas. Como "one of your X games" funciona con todos.
  const genre = game.genres?.[0];
  if (genre && hours >= 10) {
    lines.push(`one of your ${genre.toLowerCase()} games. ${Math.round(hours)} hours deep`);
  }

  // ── Lo que costó, y lo que rindió ──────────────────────────────────────
  if (spend > 0) {
    if (hours >= 2) {
      const perHour = spend / hours;
      // Por debajo de 1€/h la frase se cuenta sola; por encima de 8 también,
      // pero al revés. En medio no dice gran cosa, así que se calla.
      if (perHour <= 1) {
        lines.push(
          `${formatMoney(spend)} for ${Math.round(hours)} hours. ${formatMoney(perHour)} an hour`,
        );
      } else if (perHour >= 8) {
        lines.push(`this one worked out at ${formatMoney(perHour)} per hour`);
      }
    }
    if (hours === 0) lines.push(`${formatMoney(spend)} spent. not a single hour played yet`);
  } else if (hours >= 20) {
    lines.push(`${Math.round(hours)} hours, and it never cost you anything`);
  }

  // ── El tiempo dicho en una unidad que se siente ────────────────────────
  // "96 horas" es una cifra; "cuatro días enteros" es una imagen.
  if (hours >= 72) {
    const days = hours / 24;
    lines.push(
      days >= 14
        ? `that is ${Math.round(days)} full days of your life`
        : `${Math.round(days)} full days, if you had played it without sleeping`,
    );
  }

  // ── Cuánto tardaste en llegar a él ─────────────────────────────────────
  if (game.releaseYear !== null && firstSession) {
    const gap = firstSession.startedAt.getFullYear() - game.releaseYear;
    if (gap >= 8) lines.push(`it waited ${gap} years for you to finally play it`);
    else if (gap <= 0) lines.push('you were there the year it came out');
  }

  // ── Volver después de mucho tiempo ─────────────────────────────────────
  if (tracked.length >= 3) {
    const ordered = tracked.slice().sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    let longestGap = 0;
    for (let position = 1; position < ordered.length; position++) {
      const gap = daysBetween(
        ordered[position - 1].startedAt,
        ordered[position].startedAt.getTime(),
      );
      if (gap > longestGap) longestGap = gap;
    }
    if (longestGap >= 200) {
      lines.push(`you left this for ${Math.round(longestGap / 365)} years, and came back`);
    } else if (longestGap >= 45) {
      lines.push(
        `you dropped it for ${Math.round(longestGap / 30)} months, then picked it up again`,
      );
    }

    // La maratón: el día que más veces volviste a abrirlo.
    const byDay = new Map<string, number>();
    for (const session of ordered) {
      const key = session.startedAt.toDateString();
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const busiest = Math.max(...byDay.values());
    if (busiest >= 4) lines.push(`one day you opened this ${busiest} separate times`);

    // En cuántos meses distintos aparece: mide la constancia, no el total.
    const months = new Set(
      ordered.map(
        (session) => `${session.startedAt.getFullYear()}-${session.startedAt.getMonth()}`,
      ),
    ).size;
    if (months >= 6) lines.push(`this one shows up across ${months} different months`);
  }

  // ── Qué dejaste para jugar a esto ──────────────────────────────────────
  if (playedJustBefore) {
    lines.push(`you were playing ${playedJustBefore} right before you started this`);
  }

  // ── Su lugar en la historia de la biblioteca ───────────────────────────
  if (isOldestInLibrary) lines.push('the very first game you ever added here');
  if (isNewestInLibrary) lines.push('the newest thing in your library');
  if (completedSameYear >= 3 && completedEvent) {
    lines.push(
      `one of ${completedSameYear + 1} games you finished in ${completedEvent.occurredAt.getFullYear()}`,
    );
  }
  if (libraryGames >= 50 && rank !== null && rank <= Math.ceil(libraryGames * 0.05) && rank > 3) {
    lines.push(`top 5% of everything in your library`);
  }

  // ── La estación en la que lo juegas ────────────────────────────────────
  if (tracked.length >= 8) {
    const season = dominant(
      tracked.map((session) => {
        const month = session.startedAt.getMonth();
        if (month <= 1 || month === 11) return 'winter';
        if (month <= 4) return 'spring';
        if (month <= 7) return 'summer';
        return 'autumn';
      }),
      0.55,
    );
    if (season) lines.push(`a ${season.value} game, apparently`);
  }

  // ── Lo que nunca has tocado, sin culpa ─────────────────────────────────
  if (game.currentState === null && tracked.length === 0) {
    const waiting = humanizeAgo(daysBetween(game.addedAt, now));
    if (waiting) {
      lines.push(`this has been waiting since ${waiting}`);
      lines.push('still sealed. one of these days');
    } else {
      lines.push('brand new to the library');
    }
  }

  return lines;
};
