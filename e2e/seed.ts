import type { SeedGame } from './sandbox';

// LA BIBLIOTECA DE PRUEBA DE LOS TESTS E2E.
//
// GENERADO por scripts/gen-e2e-seed.ts a partir de una copia de la biblioteca
// real del dueno. No se edita a mano: si hace falta otra forma, se anade el
// titulo a WANTED en el generador y se vuelve a lanzar.
//
// POR QUE DATOS REALES: en esta app todo lo que se ve —estado, horas, fechas—
// se DERIVA de un log de eventos, y un sembrado inventado a ojo (un juego, un
// playthrough limpio) no ejercita ninguna de las decisiones dificiles. Aqui
// hay dos playthroughs con precision de fecha distinta, horas tecleadas
// conviviendo con sesiones medidas, un emulado sin appid, un abandonado, un
// endless y dos planeados fijados en Up next. Cada juego lleva escrito para
// que esta.
//
// Son datos reales pero no secretos: titulos, anos, appids publicos y horas.
// Sin notas personales, sin rutas locales, sin credenciales.
export const DEFAULT_SEED: SeedGame[] = [
  // DOS playthroughs, con precision de fecha distinta y horas propias
  {
    title: "Assassin's Creed II",
    steamAppId: 33230,
    releaseYear: 2009,
    genres: ['Platform', 'Adventure'],
    hltb: { main: 19, extras: 26, completionist: 35 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Steam',
        origin: 'Purchased',
        format: 'digital',
        manualHours: 23,
        events: [
          { type: 'started', at: new Date('2021-01-01T00:00:00.000Z'), precision: 'year' },
          { type: 'completed', at: new Date('2021-01-01T00:00:00.000Z'), precision: 'year' },
        ],
      },
      {
        label: 'Playthrough 2',
        platform: 'Steam',
        origin: 'Purchased',
        format: 'digital',
        manualHours: 23.5,
        events: [
          { type: 'started', at: new Date('2023-10-13T22:00:00.000Z'), precision: 'day' },
          { type: 'completed', at: new Date('2023-11-13T23:00:00.000Z'), precision: 'day' },
        ],
      },
    ],
  },
  // dos playthroughs Y sesiones medidas de verdad
  {
    title: 'Strange Horticulture',
    steamAppId: 1574580,
    releaseYear: 2022,
    genres: ['Puzzle', 'Role-playing (RPG)', 'Simulator', 'Adventure'],
    hltb: { main: 6, extras: 7, completionist: 9 },
    achievements: { total: 18, unlocked: 7 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Steam',
        origin: 'Purchased',
        format: 'digital',
        manualHours: 4.2,
        events: [
          { type: 'started', at: new Date('2022-05-24T22:00:00.000Z'), precision: 'day' },
          { type: 'dropped', at: new Date('2022-05-25T22:00:00.000Z'), precision: 'day' },
        ],
      },
      {
        label: 'Playthrough 2',
        platform: 'Xbox Series X|S',
        origin: 'Purchased',
        format: 'digital',
        events: [
          { type: 'started', at: new Date('2026-08-16T09:47:05.092Z'), precision: 'datetime' },
          { type: 'dropped', at: new Date('2026-08-24T08:50:26.731Z'), precision: 'datetime' },
        ],
        sessions: [
          { at: new Date('2026-08-16T09:47:05.092Z'), hours: 0.82 },
          { at: new Date('2026-08-16T13:05:10.788Z'), hours: 0.88 },
          { at: new Date('2026-08-16T16:57:32.907Z'), hours: 0.2 },
          { at: new Date('2026-08-16T17:55:14.449Z'), hours: 0.19 },
          { at: new Date('2026-08-18T20:37:12.819Z'), hours: 0.03 },
          { at: new Date('2026-08-19T07:04:05.214Z'), hours: 0.36 },
        ],
      },
    ],
  },
  // el mas jugado: 20 sesiones medidas (se recortan a 6)
  {
    title: '007 First Light',
    steamAppId: 3768760,
    releaseYear: 2026,
    genres: ['Shooter', 'Adventure'],
    hltb: { main: 16, extras: 19, completionist: 25 },
    achievements: { total: 24, unlocked: 16 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'PC',
        origin: 'Pirate',
        format: 'digital',
        events: [
          { type: 'started', at: new Date('2026-07-18T15:20:14.118Z'), precision: 'datetime' },
          { type: 'completed', at: new Date('2026-07-30T18:04:12.714Z'), precision: 'datetime' },
        ],
        sessions: [
          { at: new Date('2026-07-18T15:20:14.118Z'), hours: 0.36 },
          { at: new Date('2026-07-18T18:52:53.799Z'), hours: 0.56 },
          { at: new Date('2026-07-19T08:58:55.783Z'), hours: 1.46 },
          { at: new Date('2026-07-19T13:03:57.338Z'), hours: 0.94 },
          { at: new Date('2026-07-19T16:24:50.487Z'), hours: 0.47 },
          { at: new Date('2026-07-19T17:45:00.439Z'), hours: 0.56 },
        ],
      },
    ],
  },
  // muchos logros y a medio sacar (500/223 reales)
  {
    title: 'Halls of Torment',
    endless: true,
    steamAppId: 2218750,
    releaseYear: 2024,
    genres: ['Role-playing (RPG)', 'Indie'],
    hltb: { main: 11, extras: 28, completionist: 66 },
    achievements: { total: 24, unlocked: 11 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Steam',
        origin: 'Purchased',
        format: 'digital',
        manualHours: 29,
        events: [{ type: 'resting', at: new Date('2025-11-12T23:00:00.000Z'), precision: 'day' }],
      },
    ],
  },
  // logros ademas de horas; juego largo de biblioteca
  {
    title: 'Terraria',
    endless: true,
    steamAppId: 105600,
    releaseYear: 2011,
    genres: ['Platform', 'Role-playing (RPG)', 'Simulator', 'Strategy', 'Adventure', 'Indie'],
    hltb: { main: 52, extras: 92, completionist: 206 },
    achievements: { total: 24, unlocked: 12 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Steam',
        origin: 'Purchased',
        format: 'digital',
        manualHours: 83,
        events: [{ type: 'resting', at: new Date('2022-09-06T22:00:00.000Z'), precision: 'day' }],
      },
    ],
  },
  // ENDLESS: sin final, nunca cuenta como backlog
  {
    title: '112 Operator',
    endless: true,
    steamAppId: 793460,
    releaseYear: 2020,
    genres: ['Puzzle', 'Simulator', 'Strategy', 'Indie'],
    hltb: { main: 10, extras: 19, completionist: 28 },
    achievements: { total: 24, unlocked: 9 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Steam',
        origin: 'Purchased',
        format: 'digital',
        manualHours: 3.6,
        events: [{ type: 'resting', at: new Date('2024-05-30T22:00:00.000Z'), precision: 'day' }],
      },
    ],
  },
  // EMULADO y sin appid de Steam
  {
    title: "The Legend of Zelda: Link's Awakening",
    isEmulated: true,
    steamAppId: null,
    releaseYear: 2019,
    genres: ['Puzzle', 'Adventure'],
    hltb: { main: 14, extras: 16, completionist: 21 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Emulated',
        origin: 'Pirate',
        format: 'digital',
        manualHours: 5,
        events: [
          { type: 'started', at: new Date('2026-01-15T00:00:00.000Z'), precision: 'day' },
          { type: 'on_hold', at: new Date('2026-01-17T23:00:00.000Z'), precision: 'day' },
          { type: 'dropped', at: new Date('2026-08-09T17:19:37.744Z'), precision: 'datetime' },
        ],
      },
    ],
  },
  // ABANDONADO (dropped): el desenlace que no es "terminado"
  {
    title: 'Alan Wake',
    steamAppId: 108710,
    releaseYear: 2010,
    genres: ['Shooter', 'Adventure'],
    hltb: { main: 11, extras: 14, completionist: 27 },
    achievements: { total: 24, unlocked: 2 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Steam',
        origin: 'Purchased',
        format: 'digital',
        manualHours: 1.5,
        events: [
          { type: 'started', at: new Date('2024-09-19T00:00:00.000Z'), precision: 'day' },
          { type: 'dropped', at: new Date('2024-09-19T00:00:00.000Z'), precision: 'day' },
        ],
      },
    ],
  },
  // PLANEADO y fijado en Up next
  {
    title: 'Octopath Traveler',
    planned: true,
    pinnedAt: new Date('2026-08-06T13:11:47.216Z'),
    steamAppId: 921570,
    releaseYear: 2018,
    genres: ['Role-playing (RPG)', 'Adventure'],
    hltb: { main: 60, extras: 81, completionist: 104 },
    achievements: { total: 24, unlocked: 0 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'Google Stadia',
        origin: 'Purchased',
        format: 'digital',
        events: [
          { type: 'plan_to_play', at: new Date('2026-07-19T06:55:09.669Z'), precision: 'datetime' },
        ],
      },
    ],
  },
  // PLANEADO y fijado: hacen falta dos para probar el orden
  {
    title: 'Chrono Trigger',
    planned: true,
    pinnedAt: new Date('2026-08-06T14:08:03.573Z'),
    steamAppId: 613830,
    releaseYear: 2018,
    genres: ['Role-playing (RPG)', 'Adventure'],
    hltb: { main: 23, extras: 27, completionist: 42 },
    achievements: { total: 13, unlocked: 0 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'PC (Microsoft Windows)',
        origin: 'Purchased',
        format: 'digital',
        events: [
          { type: 'plan_to_play', at: new Date('2026-08-05T19:40:34.662Z'), precision: 'datetime' },
        ],
      },
    ],
  },
  // PLANEADO normal, sin fijar
  {
    title: 'Behind the Frame: The Finest Scenery',
    planned: true,
    pinnedAt: new Date('2026-08-06T13:50:00.588Z'),
    steamAppId: 1634150,
    releaseYear: 2021,
    genres: ['Point-and-click', 'Puzzle', 'Adventure', 'Indie'],
    hltb: { main: 1, extras: 2, completionist: 2 },
    achievements: { total: 19, unlocked: 0 },
    playthroughs: [
      {
        label: 'Playthrough 1',
        platform: 'PlayStation 4',
        origin: 'Purchased',
        format: 'digital',
        events: [
          { type: 'plan_to_play', at: new Date('2026-08-06T12:56:02.310Z'), precision: 'datetime' },
        ],
      },
    ],
  },
];
