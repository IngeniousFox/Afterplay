import type { GameListItem, SessionWithGame, StateEventSummary } from '../../../shared/types';
import { DAY_MS } from './dateMath';
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
// prioridades. Un juego con mucha historia puede tener TREINTA cosas
// distintas que contarte, y así las va soltando.
//
// Y encima del sorteo, la ROTACIÓN: casi ningún hecho tiene una sola manera
// de decirse. `say(...)` elige una redacción según el día y el juego, así que
// el mismo hecho no suena igual hoy que mañana — variedad sin meter tickets
// de más en el sorteo (tres redacciones de las horas siguen siendo UNA
// entrada, no tres).

// Propio y no el daysBetween de dateMath: aquel devuelve el tramo exacto en
// decimales, y aquí siempre se va a redactar una frase ("hace 5 meses"), así
// que interesan días enteros ya truncados.
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
  // ── Su sitio entre los suyos ─────────────────────────────────────────────
  // Cuántos juegos comparten su género principal (este incluido), y su puesto
  // por horas entre ellos (1 = el más jugado del género; null sin horas).
  genrePeers: number;
  genreRank: number | null;
  // Otro juego añadido el MISMO día de calendario que este, si lo hay — los
  // juegos suelen llegar en tandas y eso también es memoria.
  addedSameDayTitle: string | null;
  // Cuántos juegos de la biblioteca salieron su mismo año.
  sameReleaseYearCount: number;
  // El juego más viejo de la biblioteca por año de lanzamiento.
  isOldestRelease: boolean;
  // El primer y el último 'completed' de TODA la biblioteca — dos frases que
  // solo puede decir un juego cada una.
  isFirstCompletion: boolean;
  isLatestCompletion: boolean;
  // Año en que arrancó la biblioteca (el addedAt más viejo) — para "más viejo
  // que esta biblioteca entera".
  libraryStartYear: number | null;
  // Curiosidades REALES del juego (generadas una vez con Wikipedia + Claude,
  // ver main/curiosities). La otra mitad del modo ambiente: las frases de
  // arriba hablan de TI con este juego; estas hablan del juego en sí.
  curiosities: string[];
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
    genrePeers,
    genreRank,
    addedSameDayTitle,
    sameReleaseYearCount,
    isOldestRelease,
    isFirstCompletion,
    isLatestCompletion,
    libraryStartYear,
  } = context;
  // Las manuales tienen fecha imprecisa (un "marzo de 2021" no tiene hora),
  // así que quedan fuera de todo lo que hable de horarios o duraciones.
  const tracked = sessions.filter((session) => !session.isManual && session.durationSec !== null);

  // La rotación de redacciones: mismo hecho, distinta voz según el día y el
  // juego. El contador desacopla las elecciones entre hechos (sin él, todos
  // los `say` del render caerían en el mismo índice y las variantes irían en
  // bloque). Determinista dentro del render: nada de Math.random.
  const flavorBase = Math.abs(game.id * 31 + Math.floor(now / DAY_MS));
  let flavorSalt = 0;
  const say = (...phrasings: string[]): string =>
    phrasings[(flavorBase + flavorSalt++) % phrasings.length];

  // ── Aniversarios: lo más bonito que puede decir, porque es lo único que no
  // sabrías tú solo ──────────────────────────────────────────────────────
  const addedYears = anniversaryYears(game.addedAt, now);
  if (addedYears !== null) {
    lines.push(
      addedYears === 1
        ? say(
            'a year ago today, this entered your library',
            'happy first anniversary: one year in your library today',
          )
        : say(
            `${addedYears} years ago today, this entered your library`,
            `today marks ${addedYears} years since this joined the shelf`,
          ),
    );
  }

  const completions = events
    .filter((event) => event.type === 'completed')
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const completedEvent = completions[0];
  if (completedEvent) {
    const years = anniversaryYears(completedEvent.occurredAt, now);
    if (years !== null) {
      lines.push(
        years === 1
          ? say(
              'you finished this a year ago today',
              'one year ago today, you rolled credits on this',
            )
          : say(
              `you finished this ${years} years ago today`,
              `${years} years ago today, the credits rolled on this one`,
            ),
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
  if (hours >= 200) {
    lines.push(
      say(
        `${Math.round(hours)} hours. this one took a piece of your life`,
        `${Math.round(hours)} hours and counting. some games are places you live in`,
        `${Math.round(hours)} hours. at some point this stopped being a game and became a habit`,
      ),
    );
  } else if (hours >= 100) {
    lines.push(
      say(
        `you gave this ${Math.round(hours)} hours`,
        `${Math.round(hours)} hours. into the hundreds with this one`,
        `three digits: ${Math.round(hours)} hours in here`,
      ),
    );
  } else if (hours >= 40) {
    lines.push(
      say(
        `${Math.round(hours)} hours in here`,
        `${Math.round(hours)} hours of you live inside this one`,
      ),
    );
  } else if (hours >= 8) {
    lines.push(
      say(
        `${Math.round(hours)} hours of your life are in this one`,
        `you and this game go back ${Math.round(hours)} hours`,
      ),
    );
  }

  // ── La sesión más larga: el dato que más recuerda la gente ─────────────
  const longest = tracked.reduce<SessionWithGame | null>(
    (best, session) =>
      best === null || (session.durationSec ?? 0) > (best.durationSec ?? 0) ? session : best,
    null,
  );
  if (longest && (longest.durationSec ?? 0) >= 2 * 3600) {
    const label = formatElapsed(longest.durationSec ?? 0);
    const when = longest.startedAt;
    lines.push(
      say(
        `your longest sitting here was ${label}`,
        `one session ran ${label}. you remember which one`,
      ),
    );
    lines.push(`${MONTHS[when.getMonth()]} ${when.getFullYear()}: ${label} without getting up`);
  }

  // ── Cuántas veces has vuelto ───────────────────────────────────────────
  if (tracked.length >= 30) {
    lines.push(
      say(
        `${tracked.length} separate times you sat down with this`,
        `${tracked.length} sessions. this door keeps getting opened`,
      ),
    );
  } else if (tracked.length >= 8) {
    lines.push(`${tracked.length} sessions with this one`);
  }

  // ── Cuándo lo juegas: patrones que no sabías de ti ─────────────────────
  if (tracked.length >= 6) {
    const byWeekday = dominant(
      tracked.map((session) => session.startedAt.getDay()),
      0.4,
    );
    if (byWeekday) {
      lines.push(
        say(
          `this is your ${WEEKDAYS[byWeekday.value]} game`,
          `somehow this became a ${WEEKDAYS[byWeekday.value]} thing`,
        ),
      );
    }

    // La franja tiene que salir en más de la mitad de las sesiones: si juegas
    // a todas horas no hay patrón que contar, y forzarlo sería inventárselo.
    const slot = dominant(
      tracked.map((session) => timeOfDayName(session.startedAt.getHours())),
      0.5,
    );
    if (slot) {
      lines.push(
        say(
          `you always come to this one in ${slot.value}`,
          `a creature of habit: this gets played in ${slot.value}`,
        ),
      );
    }

    // Fin de semana contra diario: otro patrón que no sabías de ti.
    const weekendShare =
      tracked.filter((session) => [0, 6].includes(session.startedAt.getDay())).length /
      tracked.length;
    if (weekendShare >= 0.75) {
      lines.push(say('strictly a weekend affair', 'this one waits for the weekend, and so do you'));
    } else if (weekendShare <= 0.15) {
      lines.push('a weeknight companion. weekends belong to something else');
    }
  }

  // ── Madrugadas y amaneceres ────────────────────────────────────────────
  const afterMidnight = tracked.filter((session) => session.startedAt.getHours() < 5).length;
  if (afterMidnight >= 3) {
    lines.push(
      say(
        `${afterMidnight} nights this kept you up past midnight`,
        `you have started this after midnight ${afterMidnight} different times`,
      ),
    );
  }
  const beforeBreakfast = tracked.filter((session) => {
    const hour = session.startedAt.getHours();
    return hour >= 5 && hour < 8;
  }).length;
  if (beforeBreakfast >= 2) {
    lines.push('you have played this before breakfast. more than once');
  }

  // ── Días señalados: nadie recuerda un martes, todos recuerdan navidad ──
  const onDate = (month: number, day: number): SessionWithGame | undefined =>
    tracked.find(
      (session) => session.startedAt.getMonth() === month && session.startedAt.getDate() === day,
    );
  const christmas = onDate(11, 25);
  if (christmas) {
    lines.push(`this kept you company on christmas day, ${christmas.startedAt.getFullYear()}`);
  }
  const newYearsEve = onDate(11, 31);
  if (newYearsEve) {
    lines.push(
      say(
        `you saw out ${newYearsEve.startedAt.getFullYear()} playing this`,
        `new year's eve ${newYearsEve.startedAt.getFullYear()}, and you were here`,
      ),
    );
  }
  const newYearsDay = onDate(0, 1);
  if (newYearsDay) {
    lines.push(`a january 1st was spent here. years start how they start`);
  }

  // ── Cuándo empezó todo ─────────────────────────────────────────────────
  if (firstSession) {
    const when = firstSession.startedAt;
    lines.push(
      say(
        `it all started in ${MONTHS[when.getMonth()]} ${when.getFullYear()}`,
        `day one was in ${MONTHS[when.getMonth()]} ${when.getFullYear()}`,
      ),
    );
    lines.push(`you opened this for the first time on a ${WEEKDAYS[when.getDay()]}`);

    // La primera sesión enana que acabó en algo grande: todo empieza pequeño.
    const firstMinutes = Math.round((firstSession.durationSec ?? 0) / 60);
    if (firstMinutes > 0 && firstMinutes <= 45 && hours >= 30) {
      lines.push(
        `your first session lasted ${firstMinutes} minutes. it grew into ${Math.round(hours)} hours`,
      );
    }

    // Cuánto se estiró en el calendario: un juego de 20h repartidas en dos
    // años no es la misma historia que 20h en un fin de semana, y esa
    // diferencia no la cuenta ninguna otra cifra.
    const lastSession = tracked.reduce((latest, session) =>
      session.startedAt.getTime() > latest.startedAt.getTime() ? session : latest,
    );
    const spanDays = daysBetween(firstSession.startedAt, lastSession.startedAt.getTime());
    if (spanDays >= 400) {
      lines.push(
        say(
          `you have been playing this on and off for ${Math.round(spanDays / 365)} years`,
          `${Math.round(spanDays / 365)} years between your first session and your latest. still going`,
        ),
      );
    } else if (spanDays >= 60) {
      lines.push(`this one stretched across ${Math.round(spanDays / 30)} months`);
    } else if (spanDays >= 2 && spanDays <= 9 && hours >= 10) {
      lines.push(
        say(
          `${Math.round(hours)} hours in barely ${spanDays} days. you devoured this`,
          `you barely came up for air: ${Math.round(hours)} hours inside ${spanDays} days`,
        ),
      );
    }
  }

  // ── Del primer arranque a los créditos ─────────────────────────────────
  if (firstSession && completedEvent) {
    const toCredits = daysBetween(firstSession.startedAt, completedEvent.occurredAt.getTime());
    if (toCredits >= 300) {
      lines.push(
        `from first boot to credits: ${Math.round(toCredits / 365) === 1 ? 'a year' : `${Math.round(toCredits / 365)} years`} of your calendar`,
      );
    } else if (toCredits >= 45) {
      lines.push(`first boot to credits took ${Math.round(toCredits / 30)} months`);
    } else if (toCredits >= 1 && toCredits <= 7 && hours >= 6) {
      lines.push(say('started and finished inside a week', 'a whole story in a single week'));
    }
    lines.push(`you rolled credits on a ${WEEKDAYS[completedEvent.occurredAt.getDay()]}`);
  }

  // ── En cuántas sentadas lo despachaste ─────────────────────────────────
  if (game.currentState === 'completed' && tracked.length >= 2 && tracked.length <= 6) {
    lines.push(`you finished this in just ${tracked.length} sittings`);
  }
  if (game.currentState === 'completed' && tracked.length === 1 && hours >= 3) {
    lines.push('one sitting. start to finish');
  }

  // ── Lo que llevas tiempo sin tocar: el "¿y qué fue de...?" ─────────────
  if (game.lastPlayedAt && game.currentState !== 'completed') {
    const ago = humanizeAgo(daysBetween(game.lastPlayedAt, now));
    if (ago) {
      lines.push(say(`you last played this ${ago}`, `it has been quiet here since ${ago}`));
      if (game.currentState === 'started') {
        lines.push(
          say(
            `still unfinished. you left it ${ago}`,
            `the story is still waiting where you left it, ${ago}`,
          ),
        );
      }
    }
  }

  // ── Estado actual, cada uno con su tono ────────────────────────────────
  if (game.currentState === 'completed' && hours > 0) {
    lines.push(
      say(
        `you finished this. ${formatHours(hours)} well spent`,
        `done and dusted. ${formatHours(hours)} from start to finish`,
      ),
    );
    lines.push(
      say('this one you saw through to the end', 'not every game gets an ending. this one did'),
    );
  }
  if (game.currentState === 'dropped') {
    lines.push(
      say(
        'you walked away from this one',
        'not every story needs finishing. you closed this one early',
      ),
    );
    if (hours >= 5) lines.push(`${Math.round(hours)} hours before you called it`);
  }
  if (game.currentState === 'on_hold') {
    lines.push(say('paused, not forgotten', 'on the shelf, mid-sentence'));
  }
  if (game.currentState === 'resting') {
    lines.push(
      say(
        'resting. it will be there when you want it',
        'taking a breather. endless games can afford to wait',
      ),
    );
  }

  // ── Rejugadas y redenciones ────────────────────────────────────────────
  const playthroughs = new Set(events.map((event) => event.iterationId)).size;
  if (playthroughs > 1) {
    lines.push(
      playthroughs === 2
        ? say(
            'you came back to this one a second time',
            'good enough to start over: round two happened',
          )
        : `${playthroughs} times you have started this from scratch`,
    );
  }
  if (completions.length >= 2) {
    lines.push(
      completions.length === 2
        ? 'you have rolled credits on this twice'
        : `${completions.length} separate endings. you keep coming back for the whole ride`,
    );
  }
  // La redención: lo dejaste una vez, y aun así acabó terminado.
  const droppedBefore = events.some(
    (event) =>
      event.type === 'dropped' &&
      completions.some(
        (completion) => completion.occurredAt.getTime() > event.occurredAt.getTime(),
      ),
  );
  if (droppedBefore) {
    lines.push(
      say(
        "you gave up on this once. then one day you didn't",
        'dropped once, finished later. some stories insist',
      ),
    );
  }
  const pauses = events.filter((event) => event.type === 'on_hold').length;
  if (pauses >= 2 && (game.currentState === 'started' || game.currentState === 'completed')) {
    lines.push('you shelved this twice. it kept pulling you back');
  }

  // ── Tú contra HowLongToBeat ────────────────────────────────────────────
  if (game.hltbMain !== null && hours > 0 && game.currentState === 'completed') {
    const ratio = hours / game.hltbMain;
    if (ratio >= 1.6)
      lines.push(
        say(
          `most people finish this in ${Math.round(game.hltbMain)} hours. you took ${Math.round(hours)}`,
          `${Math.round(hours)} hours on a ${Math.round(game.hltbMain)}-hour game. you were not in a hurry`,
        ),
      );
    else if (ratio <= 0.65) lines.push(`you got through this faster than most`);
  }
  if (game.hltbMain !== null && game.currentState === null && game.hltbMain >= 1) {
    lines.push(
      say(
        `about ${Math.round(game.hltbMain)} hours are waiting in here`,
        `an unopened ${Math.round(game.hltbMain)}-hour journey`,
      ),
    );
  }
  // Cerca del final, dicho con ternura y sin deberes.
  if (
    game.hltbMain !== null &&
    game.currentState === 'started' &&
    !game.endless &&
    hours / game.hltbMain >= 0.75 &&
    hours / game.hltbMain <= 1.3
  ) {
    lines.push(`by most people's count, the ending is near`);
  }

  // ── Su sitio en tu biblioteca ──────────────────────────────────────────
  if (rank !== null && rank <= 3 && hours > 0) {
    lines.push(
      rank === 1
        ? say(
            'the most played game in your library',
            'number one. nothing here has taken more of your time',
          )
        : `your #${rank} most played game`,
    );
  }
  if (rank !== null && rank >= 4 && rank <= 10 && hours > 0) {
    lines.push(`#${rank} on your all-time list`);
  }
  if (libraryHours > 0 && hours / libraryHours >= 0.08) {
    const share = hours / libraryHours;
    lines.push(
      share >= 0.125
        ? say(
            `${Math.round(share * 100)}% of everything you have ever played`,
            `one hour of every ${Math.round(1 / share)} you have ever played happened here`,
          )
        : `${Math.round(share * 100)}% of everything you have ever played`,
    );
  }

  // ── Entre los de su género ─────────────────────────────────────────────
  const genre = game.genres?.[0];
  if (genre && genreRank === 1 && genrePeers >= 3 && hours > 0) {
    lines.push(`your most played ${genre.toLowerCase()} game, by a distance or not`);
  } else if (genre && genrePeers >= 6 && hours >= 5) {
    lines.push(`one of ${genrePeers} ${genre.toLowerCase()} games you keep around`);
  } else if (genre && hours >= 10) {
    // El género se dice como pertenencia y no como "47 horas de platform", que
    // en inglés no se sostiene: los géneros de IGDB son sustantivos sueltos
    // ("Platform", "Shooter", "Role-playing (RPG)") y meterlos detrás de
    // "hours of" da frases rotas. Como "one of your X games" funciona con
    // todos.
    lines.push(`one of your ${genre.toLowerCase()} games. ${Math.round(hours)} hours deep`);
  }

  // ── El juego en sí: edad, género, rarezas ──────────────────────────────
  if (game.releaseYear !== null) {
    const age = new Date(now).getFullYear() - game.releaseYear;
    if (age >= 15) {
      lines.push(
        say(
          `from ${game.releaseYear}. older than a lot of people playing it`,
          `${game.releaseYear}. this game has been around longer than most friendships`,
        ),
      );
    } else if (age >= 6 && hours > 0) lines.push(`released in ${game.releaseYear}`);
  }
  if (
    libraryStartYear !== null &&
    game.releaseYear !== null &&
    game.releaseYear < libraryStartYear
  ) {
    lines.push('older than this entire library');
  }
  if (isOldestRelease && game.releaseYear !== null) {
    lines.push(`the oldest game on these shelves, class of ${game.releaseYear}`);
  }
  if (sameReleaseYearCount >= 4 && game.releaseYear !== null) {
    lines.push(`one of ${sameReleaseYearCount} games from ${game.releaseYear} you keep here`);
  }
  if (game.endless) {
    lines.push(
      say(
        'no ending here. that was always the point',
        'this one never ends. neither does the urge',
      ),
    );
  }
  if (game.isEmulated) {
    lines.push(say('kept alive through an emulator', 'its hardware is gone. the game is not'));
  }

  // ── Lo que costó, y lo que rindió ──────────────────────────────────────
  if (spend > 0) {
    if (hours >= 2) {
      const perHour = spend / hours;
      // Por debajo de 1€/h la frase se cuenta sola; por encima de 8 también,
      // pero al revés. En medio no dice gran cosa, así que se calla.
      if (perHour <= 1) {
        lines.push(
          say(
            `${formatMoney(spend)} for ${Math.round(hours)} hours. ${formatMoney(perHour)} an hour`,
            `best money you have spent in a while: ${formatMoney(perHour)} an hour`,
          ),
        );
      } else if (perHour >= 8) {
        lines.push(`this one worked out at ${formatMoney(perHour)} per hour`);
      }
    }
    if (hours === 0) lines.push(`${formatMoney(spend)} spent. not a single hour played yet`);
  } else if (hours >= 20) {
    lines.push(
      say(
        `${Math.round(hours)} hours, and it never cost you anything`,
        `free, and it still gave you ${Math.round(hours)} hours`,
      ),
    );
  }
  if (spend === 0 && rank !== null && rank <= 5 && hours > 0) {
    lines.push('top five most played, and it cost you nothing');
  }

  // ── El tiempo dicho en una unidad que se siente ────────────────────────
  // "96 horas" es una cifra; "cuatro días enteros" es una imagen.
  if (hours >= 72) {
    const days = hours / 24;
    lines.push(
      days >= 14
        ? say(
            `that is ${Math.round(days)} full days of your life`,
            `${Math.round(days)} days straight, if you had never slept`,
          )
        : say(
            `${Math.round(days)} full days, if you had played it without sleeping`,
            `${Math.round(hours / 40)} full working weeks went into this`,
          ),
    );
  }

  // ── Cuánto tardaste en llegar a él ─────────────────────────────────────
  if (game.releaseYear !== null && firstSession) {
    const gap = firstSession.startedAt.getFullYear() - game.releaseYear;
    if (gap >= 8) {
      lines.push(
        say(
          `it waited ${gap} years for you to finally play it`,
          `${gap} years late to this party, and it did not matter one bit`,
        ),
      );
    } else if (gap <= 0) lines.push('you were there the year it came out');
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
      lines.push(
        say(
          `you left this for ${Math.round(longestGap / 365)} years, and came back`,
          `${Math.round(longestGap / 365)} years of silence, then you picked it right back up`,
        ),
      );
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

    // La racha: días SEGUIDOS de calendario con sesión. El margen 23-25h
    // absorbe los cambios de hora sin dejar pasar días saltados.
    const uniqueDays = [...new Set(ordered.map((session) => session.startedAt.toDateString()))]
      .map((key) => new Date(key).getTime())
      .sort((a, b) => a - b);
    let streak = 1;
    let bestStreak = 1;
    for (let position = 1; position < uniqueDays.length; position++) {
      const diff = uniqueDays[position] - uniqueDays[position - 1];
      if (diff >= 23 * 3600 * 1000 && diff <= 25 * 3600 * 1000) {
        streak++;
        bestStreak = Math.max(bestStreak, streak);
      } else {
        streak = 1;
      }
    }
    if (bestStreak >= 4) {
      lines.push(
        say(
          `${bestStreak} days in a row, at one point`,
          `there was a week when this was daily: ${bestStreak} days straight`,
        ),
      );
    }

    // En cuántos meses distintos aparece: mide la constancia, no el total.
    const months = new Set(
      ordered.map(
        (session) => `${session.startedAt.getFullYear()}-${session.startedAt.getMonth()}`,
      ),
    ).size;
    if (months >= 6) lines.push(`this one shows up across ${months} different months`);

    // El mes que más le diste: la temporada alta de este juego.
    const hoursByMonth = new Map<string, { at: Date; hours: number }>();
    for (const session of ordered) {
      const key = `${session.startedAt.getFullYear()}-${session.startedAt.getMonth()}`;
      const entry = hoursByMonth.get(key) ?? { at: session.startedAt, hours: 0 };
      entry.hours += (session.durationSec ?? 0) / 3600;
      hoursByMonth.set(key, entry);
    }
    const peak = [...hoursByMonth.values()].sort((a, b) => b.hours - a.hours)[0];
    if (peak && peak.hours >= 12 && hoursByMonth.size >= 2) {
      lines.push(
        `${MONTHS[peak.at.getMonth()]} ${peak.at.getFullYear()} was the big month: ${Math.round(peak.hours)} hours`,
      );
    }

    // La tradición: el mismo mes del año, varios años seguidos.
    const yearsByMonth = new Map<number, Set<number>>();
    for (const session of ordered) {
      const month = session.startedAt.getMonth();
      const set = yearsByMonth.get(month) ?? new Set<number>();
      set.add(session.startedAt.getFullYear());
      yearsByMonth.set(month, set);
    }
    for (const [month, years] of yearsByMonth) {
      if (years.size >= 3) {
        lines.push(`a ${MONTHS[month]} tradition: ${years.size} different years now`);
        break;
      }
    }

    // Sesiones cortas o largas por costumbre: cómo se deja jugar este juego.
    const avgHours =
      ordered.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) / ordered.length / 3600;
    if (avgHours >= 2.5 && ordered.length >= 5) {
      lines.push(
        say(
          'when you sit down with this, you stay a while',
          `your average visit here runs ${formatHours(avgHours)}. no quick stops`,
        ),
      );
    } else if (avgHours > 0 && avgHours <= 0.45 && ordered.length >= 8) {
      lines.push('little sips: your visits here rarely pass half an hour');
    }
  }

  // ── Tus propias palabras ───────────────────────────────────────────────
  // El diario de sesión, devuelto: nada que la app pueda redactar suena tan
  // a ti como lo que escribiste tú. Solo notas cortas — una larga truncada a
  // mitad de frase es peor que no decir nada.
  const notes = tracked
    .filter((session) => {
      const note = session.note?.trim() ?? '';
      return note.length >= 3 && note.length <= 90;
    })
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  if (notes.length > 0) {
    const note = notes[0].note?.trim() ?? '';
    const when = notes[0].startedAt;
    lines.push(
      say(
        `your last note here: "${note}"`,
        `"${note}" — you, ${MONTHS[when.getMonth()]} ${when.getFullYear()}`,
      ),
    );
  }
  const noteCount = tracked.filter((session) => (session.note?.trim().length ?? 0) > 0).length;
  if (noteCount >= 5) {
    lines.push(`you have left yourself ${noteCount} notes in here`);
  }

  // ── Qué dejaste para jugar a esto ──────────────────────────────────────
  if (playedJustBefore) {
    lines.push(
      say(
        `you were playing ${playedJustBefore} right before you started this`,
        `before this, it was ${playedJustBefore}`,
      ),
    );
  }

  // ── Su lugar en la historia de la biblioteca ───────────────────────────
  if (isOldestInLibrary) lines.push('the very first game you ever added here');
  if (isNewestInLibrary) lines.push('the newest thing in your library');
  if (isFirstCompletion) lines.push('the first game this library ever saw you finish');
  if (isLatestCompletion) lines.push('your most recent finish. the ink is still fresh');
  if (addedSameDayTitle) {
    lines.push(`it arrived the same day as ${addedSameDayTitle}`);
  }
  if (completedSameYear >= 3 && completedEvent) {
    lines.push(
      `one of ${completedSameYear + 1} games you finished in ${completedEvent.occurredAt.getFullYear()}`,
    );
  }
  if (completedSameYear === 0 && completedEvent) {
    lines.push(`the only game you finished in ${completedEvent.occurredAt.getFullYear()}`);
  }
  if (libraryGames >= 50 && rank !== null && rank <= Math.ceil(libraryGames * 0.05) && rank > 3) {
    lines.push(`top 5% of everything in your library`);
  }

  // ── Horas de antes del tracker ─────────────────────────────────────────
  const manualHours = game.manualIterations.reduce((sum, manual) => sum + manual.hours, 0);
  if (manualHours >= 5) {
    lines.push(
      say(
        `${Math.round(manualHours)} of these hours predate the tracker. logged from memory`,
        `part of this story happened before afterplay existed: ${Math.round(manualHours)} hours on the honor system`,
      ),
    );
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
    if (season) {
      lines.push(
        say(
          `a ${season.value} game, apparently`,
          `for some reason, this belongs to ${season.value}`,
        ),
      );
    }
  }

  // ── Lo que nunca has tocado, sin culpa ─────────────────────────────────
  if (game.currentState === null && tracked.length === 0) {
    const waiting = humanizeAgo(daysBetween(game.addedAt, now));
    if (waiting) {
      lines.push(
        say(
          `this has been waiting since ${waiting}`,
          `patiently waiting its turn since ${waiting}`,
        ),
      );
      lines.push(say('still sealed. one of these days', 'unopened. the best part is still ahead'));
    } else {
      lines.push('brand new to the library');
    }
  }

  // ── Curiosidades del juego ─────────────────────────────────────────────
  // Al mismo pozo que el resto, una entrada cada una: el sorteo ya reparte
  // entre "tu historia con él" y "la historia del juego" sin más reglas. Un
  // juego sin historia personal pero con curiosidades deja de estar mudo.
  lines.push(...context.curiosities);

  return lines;
};
