/**
 * [SEED] Datos de desarrollo — simula una biblioteca real con historia.
 *
 * Para QUITAR el seed de la app: borra este archivo y el bloque marcado
 * con [SEED] en src/main/index.ts (un import + un if). Nada más depende de él.
 *
 * Es idempotente por juego: antes de insertar cada juego comprueba si su
 * igdbId ya existe y lo salta si es así, para no duplicar nada aunque se
 * lance varias veces o convivan con juegos añadidos a mano.
 *
 * Cobertura de casos del SPEC (sección 4 / 4.5 / 5):
 *  1. The Witcher 3 ......... rejugada: pasado manual en PS4 (física, month) +
 *                             NG+ presente trackeado CON SESIÓN ABIERTA (playing)
 *                             y doble compra (física 2019 + Steam rebajas).
 *  2. Hades ................. completado trackeado que se SIGUE jugando después
 *                             de los créditos (sesiones post-completed).
 *  3. Stardew Valley ........ endless + on_hold ("en reposo entre updates").
 *  4. Factorio .............. endless + playing, sesiones nocturnas larguísimas.
 *  5. Minecraft ............. endless + dropped en el pasado (precision year,
 *                             regalo, format desconocido/null).
 *  6. Elden Ring ............ dropped a mitad del presente trackeado (rage quit).
 *  7. Baldur's Gate 3 ....... on_hold del presente trackeado.
 *  8. Cyberpunk 2077 ........ híbrido: base completada en 2021 (manual) + vuelta
 *                             SOLO por el DLC (extraContent=true) + ingame_spend.
 *  9. Hollow Knight ......... comprado en rebajas y NUNCA tocado (gasto sin
 *                             iteración: el caso "comprar antes de jugar").
 * 10. Persona 5 ............. pasado pirata/emulado, 97h manuales, sin gasto.
 * 11. Persona 5 Royal ....... recién añadido, sin nada (unplayed puro, sin cover).
 * 12. Forza Horizon 5 ....... subscription (Game Pass) + microtransacción.
 * 13. Balatro ............... endless + playing en Steam Deck, runs a las 3AM.
 * 14. Zelda: TotK .......... pasado manual en Switch física, precision day.
 */
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import {
  gamesTable,
  iterationsTable,
  sessionsTable,
  spendEventsTable,
  stateEventsTable,
} from './schema';

type NewGame = typeof gamesTable.$inferInsert;
type NewSpend = Omit<typeof spendEventsTable.$inferInsert, 'gameId'>;
type NewStateEvent = Omit<typeof stateEventsTable.$inferInsert, 'iterationId'>;
type SeedSession = Omit<
  typeof sessionsTable.$inferInsert,
  'iterationId' | 'startedAt' | 'endedAt'
> & {
  startedAt: Date;
  endedAt: Date | null;
};
type SeedIteration = Omit<
  typeof iterationsTable.$inferInsert,
  'gameId' | 'startSessionId' | 'endSessionId'
> & {
  sessions: SeedSession[];
  /** Índice (en sessions) de la sesión de inicio → iterations.startSessionId */
  startSessionIndex: number | null;
  /** Índice de la sesión de cierre (completed/dropped) → iterations.endSessionId */
  endSessionIndex: number | null;
  stateEvents: NewStateEvent[];
};
interface SeedGameDef {
  game: NewGame;
  iterations: SeedIteration[];
  spends: NewSpend[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PRNG determinista (mulberry32): mismos datos en cada máquina/ejecución. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Fecha con mes 1-based para poder leerla como humano: d(2019, 6, 20) = 20 jun 2019. */
const d = (year: number, month: number, day: number, hour = 12, minute = 0): Date =>
  new Date(year, month - 1, day, hour, minute);

const daysAgo = (days: number, hour = 20, minute = 0): Date => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
};

/**
 * Sesiones del watcher (isManual=false, precision datetime): `count` sesiones
 * repartidas entre `from` y `to`, empezando por la tarde-noche (o de madrugada
 * si nightOwl), con duración entre minMinutes y maxMinutes. durationSec cuadra
 * exacto con endedAt - startedAt, como haría el watcher real.
 */
const trackedSessions = (
  seed: number,
  from: Date,
  to: Date,
  count: number,
  minMinutes: number,
  maxMinutes: number,
  nightOwl = false,
): SeedSession[] => {
  const rand = mulberry32(seed);
  const step = (to.getTime() - from.getTime()) / count;
  const sessions: SeedSession[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(from.getTime() + step * i + rand() * step * 0.5);
    day.setHours(0, 0, 0, 0);
    const startHour = nightOwl ? 21 + rand() * 5 : 17 + rand() * 6;
    const startedAt = new Date(day.getTime() + startHour * 3_600_000);
    const durationSec = Math.round((minMinutes + rand() * (maxMinutes - minMinutes)) * 60);
    sessions.push({
      isManual: false,
      startedAt,
      endedAt: new Date(startedAt.getTime() + durationSec * 1000),
      durationSec,
      datePrecision: 'datetime',
      milestone: null,
    });
  }
  return sessions.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
};

/**
 * Sesión manual "de borde" del pasado (SPEC 4): marca una fecha (imprecisa),
 * no aporta horas — endedAt = startedAt y durationSec null. Las horas de esas
 * iteraciones viven en manualTotalPlayed.
 */
const borderSession = (
  startedAt: Date,
  datePrecision: 'year' | 'month' | 'day',
  milestone: 'started' | 'completed' | 'dropped',
): SeedSession => ({
  isManual: true,
  startedAt,
  endedAt: startedAt,
  durationSec: null,
  datePrecision,
  milestone,
});

/** Sesión EN CURSO ahora mismo (endedAt null): la card debe mostrar PLAYING + contador. */
const openSessionStartedMinutesAgo = (minutes: number): SeedSession => ({
  isManual: false,
  startedAt: new Date(Date.now() - minutes * 60_000),
  endedAt: null,
  durationSec: null,
  datePrecision: 'datetime',
  milestone: null,
});

const markMilestone = (
  sessions: SeedSession[],
  index: number,
  milestone: 'completed' | 'dropped',
): SeedSession[] => {
  sessions[index].milestone = milestone;
  return sessions;
};

const ev = (
  type: 'started' | 'completed' | 'dropped' | 'on_hold',
  occurredAt: Date,
  datePrecision: 'year' | 'month' | 'day' | 'datetime',
  note: string | null = null,
): NewStateEvent => ({ type, occurredAt, datePrecision, note });

const daysAfter = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);

// ---------------------------------------------------------------------------
// Sesiones generadas con seed fijo (= igdbId), así que siempre salen igual
// ---------------------------------------------------------------------------

// The Witcher 3 — NG+ en curso: 9 sesiones las últimas ~2 semanas + una ABIERTA.
const witcherNgSessions = [
  ...trackedSessions(1942, daysAgo(16), daysAgo(1), 9, 60, 180),
  openSessionStartedMinutesAgo(44),
];

// Hades — 45 runs cortas; créditos en la sesión 35 y se sigue jugando después.
const hadesSessions = markMilestone(
  trackedSessions(113112, d(2026, 1, 10), d(2026, 4, 20), 45, 25, 75),
  34,
  'completed',
);

// Stardew Valley — 48 tardes de granja a lo largo de 9 meses.
const stardewSessions = trackedSessions(17000, d(2025, 9, 5), d(2026, 5, 28), 48, 45, 160);

// Factorio — 15 sesiones-agujero-negro (2 a 5 horas), muchas de madrugada.
const factorioSessions = trackedSessions(7046, d(2026, 4, 1), daysAgo(1), 15, 120, 320, true);

// Elden Ring — 14 sesiones y rage quit en la última.
const eldenSessions = markMilestone(
  trackedSessions(119133, d(2026, 2, 1), d(2026, 3, 25), 14, 70, 170),
  13,
  'dropped',
);

// Baldur's Gate 3 — 18 sesiones largas, pausado en el acto 2.
const bg3Sessions = trackedSessions(119171, d(2026, 3, 1), d(2026, 6, 5), 18, 90, 210);

// Cyberpunk 2077 — vuelta solo por Phantom Liberty, completado al final.
const phantomLibertySessions = markMilestone(
  trackedSessions(1877, d(2026, 1, 5), d(2026, 2, 10), 9, 90, 200),
  8,
  'completed',
);

// Forza Horizon 5 — 10 sesiones arcade cortas vía Game Pass.
const forzaSessions = trackedSessions(134585, d(2025, 11, 2), d(2026, 1, 15), 10, 40, 90);

// Balatro — 26 "solo una run más" en la Steam Deck, hasta las tantas.
const balatroSessions = trackedSessions(252647, d(2026, 6, 1), daysAgo(2), 26, 20, 70, true);

// ---------------------------------------------------------------------------
// El reparto
// ---------------------------------------------------------------------------

const SEED_GAMES: SeedGameDef[] = [
  {
    game: {
      title: 'The Witcher 3: Wild Hunt',
      igdbId: 1942,
      steamGridDbId: 5254,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar5jb.webp',
      officialPlatforms: ['PC', 'PS4', 'PS5', 'Xbox One', 'Xbox Series X|S', 'Switch'],
      hltbMain: 51.5,
      hltbMainExtras: 103,
      hltbCompletionist: 172,
      notes:
        'Review antiguo (PS4) + notas de la rejugada actual.\n\n## Partida original (PS4, 2019)\n**Una de mis RPGs favoritas de siempre.** La historia principal tarda en arrancar pero en cuanto llegas a *Novigrad* engancha del todo.\n\n- *Blood and Wine* es la mejor expansión que he jugado en mi vida\n- Gwent se comió un número vergonzoso de horas\n- Rating: **9.5/10**\n\n## NG+ Death March (en curso)\nRejugando en Death March directamente. Esta vez sí voy a aceitar las espadas desde el minuto uno.',
      endless: false,
      addedAt: d(2025, 9, 2),
    },
    iterations: [
      {
        label: 'Partida original (PS4)',
        playedPlatform: 'PS4',
        origin: 'purchased',
        format: 'physical',
        manualTotalPlayed: 80,
        rating: 5,
        sessions: [
          borderSession(d(2019, 2, 15), 'month', 'started'),
          borderSession(d(2019, 6, 20), 'month', 'completed'),
        ],
        startSessionIndex: 0,
        endSessionIndex: 1,
        stateEvents: [
          ev('started', d(2019, 2, 15), 'month'),
          ev(
            'completed',
            d(2019, 6, 20),
            'month',
            'Main story + Blood and Wine. De lo mejor que he jugado nunca.',
          ),
        ],
      },
      {
        label: 'NG+ Death March',
        playedPlatform: 'Steam',
        origin: 'purchased',
        format: 'digital',
        rating: null,
        sessions: witcherNgSessions,
        startSessionIndex: 0,
        endSessionIndex: null,
        stateEvents: [
          ev(
            'started',
            witcherNgSessions[0].startedAt,
            'datetime',
            'NG+ en Death March. A sufrir.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 39.99,
        occurredAt: d(2019, 2, 15),
        datePrecision: 'month',
        note: 'Edición GOTY física para PS4',
      },
      {
        type: 'purchase',
        amount: 14.99,
        occurredAt: d(2025, 12, 19),
        datePrecision: 'day',
        note: 'Rebajas de invierno de Steam. Recomprado para el NG+ en PC.',
      },
    ],
  },
  {
    game: {
      title: 'Hades',
      igdbId: 113112,
      steamGridDbId: 10646,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co2i2f.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar9j4.webp',
      officialPlatforms: ['PC', 'Switch', 'PS4', 'PS5', 'Xbox One', 'Xbox Series X|S'],
      hltbMain: 22.5,
      hltbMainExtras: 40,
      hltbCompletionist: 96,
      notes:
        '**El mejor rogue-like que he tocado**, sin discusión. Que la historia avance *a través* de la muerte en vez de a pesar de ella es una genialidad.\n\n- Créditos en el intento 34\n- Sigo jugando después de los créditos, claro\n- Build favorito: escudo con el *Aspect of Zeus*\n\nRating: **9/10**',
      endless: false,
      addedAt: d(2026, 1, 9),
    },
    iterations: [
      {
        label: 'Primera partida',
        playedPlatform: 'Steam',
        origin: 'purchased',
        format: 'digital',
        rating: 5,
        sessions: hadesSessions,
        startSessionIndex: 0,
        endSessionIndex: 34,
        stateEvents: [
          ev('started', hadesSessions[0].startedAt, 'datetime'),
          ev(
            'completed',
            hadesSessions[34].endedAt!,
            'datetime',
            'Créditos al intento 34. Zagreus por fin en casa. Y sigo jugando.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 20.99,
        occurredAt: d(2026, 1, 9),
        datePrecision: 'day',
        note: 'Cayó tras años en la lista de deseados',
      },
    ],
  },
  {
    game: {
      title: 'Stardew Valley',
      igdbId: 17000,
      steamGridDbId: 2210,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1u9z.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar5l7.webp',
      officialPlatforms: ['PC', 'Switch', 'PS4', 'Xbox One', 'iOS', 'Android'],
      hltbMain: 52.5,
      hltbMainExtras: 95,
      hltbCompletionist: 156,
      notes:
        'Mi juego de manta. **Endless** por diseño — entro cada temporada un rato y ya.\n\n- Terminé el invierno del año 3 y lo dejé reposar\n- Volveré cuando salga la 1.7\n- Rating: `cozy/10`',
      endless: true,
      addedAt: d(2025, 9, 1),
    },
    iterations: [
      {
        label: 'La granja Esperanza',
        playedPlatform: 'GOG',
        origin: 'purchased',
        format: 'digital',
        rating: 5,
        sessions: stardewSessions,
        startSessionIndex: 0,
        endSessionIndex: null,
        stateEvents: [
          ev('started', stardewSessions[0].startedAt, 'datetime'),
          ev(
            'on_hold',
            daysAfter(stardewSessions[stardewSessions.length - 1].endedAt!, 3),
            'datetime',
            'Invierno del año 3 terminado. Volveré cuando salga la 1.7.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 13.99,
        occurredAt: d(2025, 8, 30),
        datePrecision: 'day',
        note: 'En GOG, sin DRM',
      },
    ],
  },
  {
    game: {
      title: 'Factorio',
      igdbId: 7046,
      steamGridDbId: 3136,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1tfy.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar8k2.webp',
      officialPlatforms: ['PC', 'Switch'],
      hltbMain: 22,
      hltbMainExtras: 40,
      hltbCompletionist: 160,
      notes:
        '**La fábrica debe crecer.** Endless por naturaleza — me digo "una línea de producción más" y se me van tres horas.\n\n- Objetivo actual: megabase a 1k SPM\n- Los trenes lo cambiaron todo\n- Sesiones sobre todo de madrugada, para qué mentir',
      endless: true,
      addedAt: d(2026, 3, 28),
    },
    iterations: [
      {
        label: 'La fábrica crece',
        playedPlatform: 'Steam',
        origin: 'purchased',
        format: 'digital',
        rating: null,
        sessions: factorioSessions,
        startSessionIndex: 0,
        endSessionIndex: null,
        stateEvents: [
          ev('started', factorioSessions[0].startedAt, 'datetime', 'La fábrica debe crecer.'),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 35,
        occurredAt: d(2026, 3, 28),
        datePrecision: 'day',
        note: 'Nunca está de rebajas. Nunca.',
      },
    ],
  },
  {
    game: {
      title: 'Minecraft',
      igdbId: 121,
      steamGridDbId: 5153,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co8fu6.webp',
      heroUrl: null,
      officialPlatforms: ['PC', 'PS4', 'Xbox One', 'Switch', 'iOS', 'Android'],
      hltbMain: null,
      hltbMainExtras: null,
      hltbCompletionist: null,
      notes:
        'Le di una oportunidad de verdad en 2015. Demasiada libertad, cero objetivos — no es un problema del juego, es mío.\n\n*Puede que algún día vuelva con algún modpack con más estructura.*',
      endless: true,
      addedAt: d(2025, 9, 2),
    },
    iterations: [
      {
        label: 'Intento de 2015',
        playedPlatform: 'PC',
        origin: 'gift',
        format: null,
        manualTotalPlayed: 8,
        rating: 2,
        sessions: [
          borderSession(d(2015, 6, 1), 'year', 'started'),
          borderSession(d(2015, 9, 1), 'year', 'dropped'),
        ],
        startSessionIndex: 0,
        endSessionIndex: 1,
        stateEvents: [
          ev('started', d(2015, 6, 1), 'year'),
          ev(
            'dropped',
            d(2015, 9, 1),
            'year',
            'Le di una oportunidad de verdad. Demasiada libertad, cero objetivos.',
          ),
        ],
      },
    ],
    spends: [],
  },
  {
    game: {
      title: 'Elden Ring',
      igdbId: 119133,
      steamGridDbId: 5265304,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar12g4.webp',
      officialPlatforms: ['PC', 'PS4', 'PS5', 'Xbox One', 'Xbox Series X|S'],
      hltbMain: 59,
      hltbMainExtras: 103,
      hltbCompletionist: 138,
      notes:
        '## Impresiones\nEl mundo abierto tiene justo ese *misterio* que los Souls siempre insinuaban. Rating: **9/10** mientras duró.\n\n## Por qué lo dejé\nMalenia me rompió. 47 intentos y me di cuenta de que no lo estaba disfrutando, solo sufriendo.\n\n- Build: bleed/katana\n- Puede que vuelva cuando salga *Shadow of the Erdtree* en oferta',
      endless: false,
      addedAt: d(2026, 1, 30),
    },
    iterations: [
      {
        label: 'Sinluz de fin de semana',
        playedPlatform: 'Steam',
        origin: 'purchased',
        format: 'digital',
        rating: 3,
        sessions: eldenSessions,
        startSessionIndex: 0,
        endSessionIndex: 13,
        stateEvents: [
          ev('started', eldenSessions[0].startedAt, 'datetime'),
          ev(
            'dropped',
            eldenSessions[13].endedAt!,
            'datetime',
            'Malenia me rompió. 47 intentos. Hasta aquí llegó mi honor de Sinluz.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 59.99,
        occurredAt: d(2026, 1, 30),
        datePrecision: 'day',
        note: null,
      },
    ],
  },
  {
    game: {
      title: "Baldur's Gate 3",
      igdbId: 119171,
      steamGridDbId: 5252350,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co670h.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar27u2.webp',
      officialPlatforms: ['PC', 'PS5', 'Xbox Series X|S', 'macOS'],
      hltbMain: 68,
      hltbMainExtras: 106,
      hltbCompletionist: 174,
      notes:
        'Mi ranger semielfa, parada a mitad del acto 2. La reactividad es una locura — sigo descubriendo cosas que no sabía que eran posibles.\n\n- Esperando los parches gordos antes de la recta final\n- Guardo partida obsesivamente\n- Rating (hasta ahora): **8/10**',
      endless: false,
      addedAt: d(2026, 2, 27),
    },
    iterations: [
      {
        label: 'Mi ranger semielfa',
        playedPlatform: 'Steam',
        origin: 'purchased',
        format: 'digital',
        rating: 4,
        sessions: bg3Sessions,
        startSessionIndex: 0,
        endSessionIndex: null,
        stateEvents: [
          ev('started', bg3Sessions[0].startedAt, 'datetime'),
          ev(
            'on_hold',
            daysAfter(bg3Sessions[bg3Sessions.length - 1].endedAt!, 5),
            'datetime',
            'Mitad del acto 2. Esperando los parches gordos para la recta final.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 59.99,
        occurredAt: d(2026, 2, 27),
        datePrecision: 'day',
        note: null,
      },
    ],
  },
  {
    game: {
      title: 'Cyberpunk 2077',
      igdbId: 1877,
      steamGridDbId: 4919,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co7497.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar7m0.webp',
      officialPlatforms: ['PC', 'PS4', 'PS5', 'Xbox One', 'Xbox Series X|S', 'Stadia'],
      hltbMain: 25.5,
      hltbMainExtras: 62,
      hltbCompletionist: 107,
      notes:
        '## Lanzamiento (2021)\nTerminado entre bugs y crasheos. El potencial estaba ahí pero costaba verlo.\n\n## Phantom Liberty\nVolví solo por el DLC y **es lo que el juego base debió ser desde el principio.** Redimido.\n\nRating final: **8/10** (el DLC solo se lleva un 9)',
      endless: false,
      addedAt: d(2025, 9, 3),
    },
    iterations: [
      {
        label: 'Lanzamiento (v1.2)',
        playedPlatform: 'GOG',
        origin: 'purchased',
        format: 'digital',
        manualTotalPlayed: 62,
        rating: 3,
        sessions: [
          borderSession(d(2021, 3, 5), 'month', 'started'),
          borderSession(d(2021, 5, 18), 'month', 'completed'),
        ],
        startSessionIndex: 0,
        endSessionIndex: 1,
        stateEvents: [
          ev('started', d(2021, 3, 5), 'month'),
          ev(
            'completed',
            d(2021, 5, 18),
            'month',
            'Terminado entre bugs y crasheos. El potencial estaba ahí.',
          ),
        ],
      },
      {
        label: 'Solo Phantom Liberty',
        playedPlatform: 'GOG',
        origin: 'purchased',
        format: 'digital',
        extraContent: true,
        rating: 4,
        sessions: phantomLibertySessions,
        startSessionIndex: 0,
        endSessionIndex: 8,
        stateEvents: [
          ev(
            'started',
            phantomLibertySessions[0].startedAt,
            'datetime',
            'Vuelta a Night City solo por el DLC.',
          ),
          ev(
            'completed',
            phantomLibertySessions[8].endedAt!,
            'datetime',
            'Phantom Liberty es lo que el juego base debió ser. Redimido.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 59.99,
        occurredAt: d(2020, 12, 10),
        datePrecision: 'day',
        note: 'Preorder. Craso error.',
      },
      {
        type: 'ingame_spend',
        amount: 29.99,
        occurredAt: d(2026, 1, 4),
        datePrecision: 'day',
        note: 'Expansión Phantom Liberty',
      },
    ],
  },
  {
    game: {
      title: 'Hollow Knight',
      igdbId: 14593,
      steamGridDbId: 3220,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co93cr.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar12f2.webp',
      officialPlatforms: ['PC', 'Switch', 'PS4', 'Xbox One'],
      hltbMain: 27.5,
      hltbMainExtras: 41.5,
      hltbCompletionist: 63.5,
      notes: 'Caído en rebajas de Steam. Directo al backlog, todavía sin abrir.',
      endless: false,
      addedAt: d(2025, 12, 19),
    },
    iterations: [],
    spends: [
      {
        type: 'purchase',
        amount: 4.99,
        occurredAt: d(2025, 12, 19),
        datePrecision: 'day',
        note: 'Rebajas de Steam. Directo al backlog.',
      },
    ],
  },
  {
    game: {
      title: 'Persona 5',
      igdbId: 9927,
      steamGridDbId: 4030,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1r76.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar4mc.webp',
      officialPlatforms: ['PS3', 'PS4'],
      hltbMain: 97,
      hltbMainExtras: 116,
      hltbCompletionist: 143,
      notes:
        'Joya emulada en RPCS3. **97 horas** y ni una se sintió de más.\n\n- OST de 10, sin discusión\n- Perdón, Atlus, algún día lo compro en condiciones',
      endless: false,
      addedAt: d(2025, 9, 3),
    },
    iterations: [
      {
        label: 'Joya emulada',
        playedPlatform: 'Emulado (RPCS3)',
        origin: 'pirate',
        format: 'digital',
        manualTotalPlayed: 97,
        rating: 5,
        sessions: [
          borderSession(d(2022, 7, 10), 'month', 'started'),
          borderSession(d(2022, 10, 2), 'month', 'completed'),
        ],
        startSessionIndex: 0,
        endSessionIndex: 1,
        stateEvents: [
          ev('started', d(2022, 7, 10), 'month'),
          ev('completed', d(2022, 10, 2), 'month', '97 horas. OST de 10. Perdón, Atlus.'),
        ],
      },
    ],
    spends: [],
  },
  {
    game: {
      title: 'Persona 5 Royal',
      igdbId: 114283,
      steamGridDbId: null,
      coverUrl: null,
      heroUrl: null,
      officialPlatforms: ['PS4', 'PS5', 'PC', 'Switch', 'Xbox Series X|S'],
      hltbMain: 103,
      hltbMainExtras: 125,
      hltbCompletionist: 143,
      endless: false,
      addedAt: daysAgo(1, 22, 41),
    },
    iterations: [],
    spends: [],
  },
  {
    game: {
      title: 'Forza Horizon 5',
      igdbId: 134585,
      steamGridDbId: 5259219,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co3ofx.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar13z5.webp',
      officialPlatforms: ['PC', 'Xbox One', 'Xbox Series X|S'],
      hltbMain: 19.5,
      hltbMainExtras: 38,
      hltbCompletionist: 105,
      notes:
        'Vía Game Pass. Divertido en dosis cortas pero el grind de coches acabó por cansarme.\n\n*Quizá vuelva con la próxima expansión.*',
      endless: false,
      addedAt: d(2025, 11, 1),
    },
    iterations: [
      {
        label: 'México a todo gas',
        playedPlatform: 'PC (Game Pass)',
        origin: 'subscription',
        format: 'digital',
        rating: 3,
        sessions: forzaSessions,
        startSessionIndex: 0,
        endSessionIndex: null,
        stateEvents: [
          ev('started', forzaSessions[0].startedAt, 'datetime'),
          ev(
            'on_hold',
            daysAfter(forzaSessions[forzaSessions.length - 1].endedAt!, 5),
            'datetime',
            'Me cansé del grind. Quizá vuelva con la próxima expansión.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'ingame_spend',
        amount: 4.99,
        occurredAt: d(2025, 11, 20),
        datePrecision: 'day',
        note: 'Car pass. No sé por qué.',
      },
    ],
  },
  {
    game: {
      title: 'Balatro',
      igdbId: 252647,
      steamGridDbId: null,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co7pgm.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar2ay1.webp',
      officialPlatforms: ['PC', 'Switch', 'PS5', 'Xbox Series X|S', 'iOS', 'Android'],
      hltbMain: 29.5,
      hltbMainExtras: 71,
      hltbCompletionist: 344,
      notes:
        '«Solo una run rápida antes de dormir», dije. Van 26 sesiones y sigo diciendo lo mismo.\n\n- Steam Deck, sobre todo de madrugada\n- Endless por diseño, no hay "terminarlo"',
      endless: true,
      addedAt: d(2026, 5, 30),
    },
    iterations: [
      {
        label: 'Una run más',
        playedPlatform: 'Steam Deck',
        origin: 'purchased',
        format: 'digital',
        rating: null,
        sessions: balatroSessions,
        startSessionIndex: 0,
        endSessionIndex: null,
        stateEvents: [
          ev(
            'started',
            balatroSessions[0].startedAt,
            'datetime',
            '«Solo una run rápida antes de dormir», dije.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 14.99,
        occurredAt: d(2026, 5, 30),
        datePrecision: 'day',
        note: 'Culpa de un vídeo de YouTube',
      },
    ],
  },
  {
    game: {
      title: 'The Legend of Zelda: Tears of the Kingdom',
      igdbId: 119388,
      steamGridDbId: 5260961,
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co5vmg.webp',
      heroUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/ar24d8.webp',
      officialPlatforms: ['Switch'],
      hltbMain: 58.5,
      hltbMainExtras: 121,
      hltbCompletionist: 240,
      notes:
        '## Lágrimas del Reino\nLas mazmorras vuelven a ser mazmorras de verdad. **Vicio absoluto** de principio a fin.\n\n- 95 horas, edición física\n- Día de lanzamiento, sin arrepentimientos\n- Rating: **10/10**',
      endless: false,
      addedAt: d(2025, 9, 4),
    },
    iterations: [
      {
        label: 'Lágrimas del Reino',
        playedPlatform: 'Switch',
        origin: 'purchased',
        format: 'physical',
        manualTotalPlayed: 95,
        rating: 5,
        sessions: [
          borderSession(d(2023, 5, 12), 'day', 'started'),
          borderSession(d(2023, 8, 27), 'day', 'completed'),
        ],
        startSessionIndex: 0,
        endSessionIndex: 1,
        stateEvents: [
          ev('started', d(2023, 5, 12), 'day', 'Día de lanzamiento.'),
          ev(
            'completed',
            d(2023, 8, 27),
            'day',
            'Las mazmorras vuelven a ser mazmorras. Vicio absoluto.',
          ),
        ],
      },
    ],
    spends: [
      {
        type: 'purchase',
        amount: 69.99,
        occurredAt: d(2023, 5, 12),
        datePrecision: 'day',
        note: 'Día de lanzamiento, edición física',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Inserción
// ---------------------------------------------------------------------------

const insertSeedGame = async (def: SeedGameDef): Promise<'inserted' | 'skipped'> => {
  const db = getDb();

  const existing = await db
    .select({ id: gamesTable.id })
    .from(gamesTable)
    .where(eq(gamesTable.igdbId, def.game.igdbId))
    .limit(1);
  if (existing.length > 0) return 'skipped';

  await db.transaction(async (tx) => {
    const [game] = await tx.insert(gamesTable).values(def.game).returning({ id: gamesTable.id });

    for (const spend of def.spends) {
      await tx.insert(spendEventsTable).values({ ...spend, gameId: game.id });
    }

    for (const iteration of def.iterations) {
      const { sessions, startSessionIndex, endSessionIndex, stateEvents, ...iterationValues } =
        iteration;

      const [insertedIteration] = await tx
        .insert(iterationsTable)
        .values({ ...iterationValues, gameId: game.id })
        .returning({ id: iterationsTable.id });

      // Sessions apunta a la iteración, y la iteración (start/end) apunta de
      // vuelta a sessions — para la circular: creo la iteración, meto las
      // sesiones, y las anclo (start/end) con un UPDATE al final.
      const sessionIds: number[] = [];
      for (const session of sessions) {
        const [inserted] = await tx
          .insert(sessionsTable)
          .values({ ...session, iterationId: insertedIteration.id })
          .returning({ id: sessionsTable.id });
        sessionIds.push(inserted.id);
      }

      if (startSessionIndex !== null || endSessionIndex !== null) {
        await tx
          .update(iterationsTable)
          .set({
            startSessionId: startSessionIndex !== null ? sessionIds[startSessionIndex] : null,
            endSessionId: endSessionIndex !== null ? sessionIds[endSessionIndex] : null,
          })
          .where(eq(iterationsTable.id, insertedIteration.id));
      }

      for (const stateEvent of stateEvents) {
        await tx
          .insert(stateEventsTable)
          .values({ ...stateEvent, iterationId: insertedIteration.id });
      }
    }
  });

  return 'inserted';
};

export const seedDatabase = async (): Promise<void> => {
  let inserted = 0;
  let skipped = 0;

  for (const def of SEED_GAMES) {
    if ((await insertSeedGame(def)) === 'inserted') {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`[seed] ${inserted} juegos insertados, ${skipped} ya existían (saltados).`);
};
