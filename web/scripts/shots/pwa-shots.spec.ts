import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

// Arnés de capturas de la PWA (solo desarrollo, no es un test de verdad).
// Todas las respuestas de /api/v2 salen de aquí: juegos, dispositivos y
// correos INVENTADOS, nada de datos reales.

const OUT = process.env.PWA_SHOTS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Carátulas de mentira: un degradado con una forma, como SVG en data URL.
const cover = (a: string, b: string, shape: 'slash' | 'circle' | 'peak' = 'slash'): string => {
  const mark =
    shape === 'circle'
      ? `<circle cx="60" cy="70" r="26" fill="none" stroke="${b}" stroke-width="3"/><circle cx="60" cy="70" r="4" fill="${b}"/>`
      : shape === 'peak'
        ? `<path d="M20 130 L60 40 L100 130 Z" fill="${b}" opacity=".85"/>`
        : `<path d="M70 0 L90 0 L40 160 L20 160 Z" fill="${b}" opacity=".9"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#0c1012"/></linearGradient></defs><rect width="120" height="160" fill="url(#g)"/>${mark}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

type State = 'started' | 'completed' | 'dropped' | 'on_hold' | 'resting' | 'plan_to_play' | null;

const GAMES: { id: string; title: string; state: State; hours: number; cover: string }[] = [
  {
    id: 'g1',
    title: 'Lantern Drift',
    state: 'started',
    hours: 23.25,
    cover: cover('#8a1f2c', '#f1e3c8'),
  },
  {
    id: 'g2',
    title: 'Ember Protocol: Second Signal',
    state: 'started',
    hours: 38.17,
    cover: cover('#3a2a3a', '#d7a15a', 'circle'),
  },
  {
    id: 'g3',
    title: 'Copper Saints',
    state: 'started',
    hours: 61.5,
    cover: cover('#5a2440', '#e7c2ff'),
  },
  {
    id: 'g4',
    title: 'Moss & Marrow',
    state: 'started',
    hours: 22.08,
    cover: cover('#1f4a3a', '#9bd67a', 'circle'),
  },
  {
    id: 'g5',
    title: 'Glass Orchard',
    state: 'completed',
    hours: 24.17,
    cover: cover('#7a4a1a', '#ffd38a', 'circle'),
  },
  {
    id: 'g6',
    title: 'Paper Lighthouse',
    state: 'completed',
    hours: 9.67,
    cover: cover('#3a4a8a', '#e9e4d8', 'peak'),
  },
  {
    id: 'g7',
    title: 'Night Courier',
    state: 'resting',
    hours: 14.5,
    cover: cover('#2a3a4a', '#5fd3e0'),
  },
  {
    id: 'g8',
    title: 'Saltmarsh Tactics',
    state: 'dropped',
    hours: 3.2,
    cover: cover('#4a4a3a', '#c8c0a0', 'peak'),
  },
  {
    id: 'g9',
    title: 'Quiet Engine',
    state: null,
    hours: 0,
    cover: cover('#2a2f33', '#8a9496', 'circle'),
  },
  {
    id: 'g10',
    title: 'Velvet Circuit',
    state: 'completed',
    hours: 41,
    cover: cover('#5a1a4a', '#ff9ad5'),
  },
];

const library = GAMES.map((game) => ({
  id: game.id,
  title: game.title,
  coverUrl: game.cover,
  releaseYear: 2019 + (Number(game.id.slice(1)) % 7),
  totalHours: game.hours,
  sessionCount: Math.ceil(game.hours / 2),
  currentState: game.state,
  lastPlayedAt: NOW - Number(game.id.slice(1)) * DAY,
  isLive: game.id === 'g1',
  liveSince: game.id === 'g1' ? NOW - (72 * 60 + 4) * 1000 : null,
  liveDeviceId: game.id === 'g1' ? 'd1' : null,
}));

const timer = {
  sessionId: 's-live',
  gameId: 'g1',
  title: 'Lantern Drift',
  coverUrl: GAMES[0].cover,
  startedAt: new Date(NOW - (72 * 60 + 4) * 1000).toISOString(),
  lastSeenAt: new Date(NOW - 60_000).toISOString(),
};

const stats = {
  totalGames: 331,
  playedGames: 214,
  totalHours: 5448.7,
  totalSessions: 2140,
  hoursThisYear: 412.3,
  gamesThisYear: 38,
  year: new Date(NOW).getFullYear(),
  beaten: 120,
  playing: 9,
  dropped: 31,
  onHold: 6,
  resting: 12,
  unplayed: 153,
  live: {
    gameId: 'g1',
    gameTitle: 'Lantern Drift',
    coverUrl: GAMES[0].cover,
    since: NOW - (72 * 60 + 4) * 1000,
  },
};

const at = (daysAgo: number, hour: number, minute = 0): number => {
  const date = new Date(NOW - daysAgo * DAY);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
};

const sessionRows = [
  { g: 0, start: at(0, 19, 40), mins: null },
  { g: 1, start: at(0, 13, 5), mins: 45 },
  { g: 1, start: at(1, 21, 0), mins: 130 },
  { g: 0, start: at(1, 15, 0), mins: 85 },
  { g: 1, start: at(1, 10, 30), mins: 110 },
  { g: 3, start: at(2, 20, 0), mins: 130 },
  { g: 4, start: at(4, 21, 0), mins: 150 },
  { g: 2, start: at(5, 18, 15), mins: 55 },
].map((row, index) => ({
  id: `s${index}`,
  iterationId: `i-${GAMES[row.g].id}`,
  gameId: GAMES[row.g].id,
  gameTitle: GAMES[row.g].title,
  coverUrl: GAMES[row.g].cover,
  isManual: false,
  startedAt: row.start,
  endedAt: row.mins === null ? null : row.start + row.mins * 60_000,
  durationSec: row.mins === null ? null : row.mins * 60,
  datePrecision: 'datetime',
  note: null,
  deviceId: 'd1',
}));

const planned = (
  id: string,
  title: string,
  hltb: number | null,
  pinnedAt: number | null,
  extra: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  id,
  title,
  coverUrl: cover('#4a3a6a', '#ffb347', 'peak'),
  releaseYear: 2024,
  releaseDate: Date.UTC(2024, 3, 18),
  releaseDatePrecision: 'day',
  genres: ['RPG'],
  hltbMain: hltb,
  endless: false,
  addedAt: NOW - 40 * DAY,
  pinnedAt,
  planNote: null,
  ratingCritics: 88,
  ratingCriticsCount: 40,
  ratingUsers: null,
  ratingUsersCount: null,
  steamPositive: null,
  steamNegative: null,
  ...extra,
});

const plan = [
  planned('p1', 'Saltwind Chronicle', 70, NOW - 10 * DAY),
  planned('p2', 'Hollow Signal', 6, NOW - 9 * DAY, {
    coverUrl: cover('#1a2a5a', '#8ce4ee', 'circle'),
  }),
  planned('p3', 'Pentagram Press', 20, NOW - 8 * DAY, { coverUrl: cover('#6a4a2a', '#e9d2a0') }),
  planned('p4', 'Lies of Paper', 30, NOW - 7 * DAY, { coverUrl: cover('#2a2f33', '#e9e4d8') }),
  planned('p5', 'Octave Traveler', 55, NOW - 6 * DAY, {
    coverUrl: cover('#3a5a7a', '#f4f0e6', 'circle'),
  }),
  planned('p6', 'Brass Meridian', 18, null, { coverUrl: cover('#5a3a1a', '#ffc266') }),
  planned('p7', 'Quiet Shore', null, null, { coverUrl: cover('#1f3a3a', '#9bd67a', 'peak') }),
  planned('p8', 'Starfall Atlas', 40, null, {
    releaseYear: new Date(NOW).getFullYear() + 1,
    releaseDate: NOW + 120 * DAY,
    coverUrl: cover('#2a1a4a', '#b9a6ff', 'peak'),
  }),
];

const gameSessions = [
  { start: at(1, 21, 0), mins: 130, note: 'Act 2 is where the combat really opens up.' },
  { start: at(1, 10, 30), mins: 110, note: null },
  { start: at(2, 20, 0), mins: 130, note: null },
  { start: at(4, 21, 0), mins: 150, note: null },
  { start: at(6, 20, 0), mins: 120, note: null },
  { start: at(9, 19, 0), mins: 140, note: null },
].map((row, index) => ({
  id: `gs${index}`,
  iterationId: 'it1',
  emulatorId: null,
  isManual: false,
  startedAt: row.start,
  endedAt: row.start + row.mins * 60_000,
  durationSec: row.mins * 60,
  datePrecision: 'datetime',
  note: row.note,
  deviceId: 'd1',
  startedBy: 'watcher',
}));

const detail = (id: string): Record<string, unknown> => {
  const base = GAMES.find((game) => game.id === id) ?? GAMES[1];
  return {
    id: base.id,
    title: base.title,
    coverUrl: base.cover,
    heroUrl: null,
    igdbId: 1000,
    steamAppId: 2000,
    releaseYear: 2025,
    releaseDate: Date.UTC(2025, 3, 24),
    releaseDatePrecision: 'day',
    genres: ['RPG', 'Turn-based', 'Adventure'],
    officialPlatforms: ['PC', 'PlayStation 5'],
    developer: 'Northlight Foundry',
    publisher: 'Kettle & Spark',
    summary:
      'A crew of cartographers sets out across a world that redraws itself every night. Each map you finish holds for a single day, so the expedition has to decide what is worth remembering before the ink fades and the roads move again.',
    igdbCollections: null,
    isEmulated: false,
    endless: false,
    planned: false,
    addedAt: NOW - 60 * DAY,
    planPinnedAt: null,
    planHistory: null,
    notes:
      'Act 2 is where the combat really opens up. Keep the **lantern** upgrades ahead of the others.\n\n- Finish the lighthouse side quest\n- Try the parry build',
    installedOn: [{ deviceId: 'd1', deviceName: 'Desk PC' }],
    hltbMain: 30,
    hltbMainExtras: 45,
    hltbCompletionist: 62,
    ratingCritics: 91,
    ratingCriticsCount: 120,
    ratingUsers: 88,
    ratingUsersCount: 640,
    steamTags: [
      { name: 'Turn-Based Combat', votes: 900 },
      { name: 'Story Rich', votes: 700 },
      { name: 'Exploration', votes: 400 },
    ],
    steamPositive: 9200,
    steamNegative: 400,
    totalHours: 38.17,
    currentState: 'started',
    isLive: false,
    liveSince: null,
    totalSpend: 49.99,
    costPerHour: 1.31,
    iterations: [
      {
        id: 'it1',
        label: '#1',
        playedPlatform: 'PC',
        origin: 'steam',
        format: 'digital',
        manualTotalPlayed: null,
        rating: 4,
        extraContent: false,
        hours: 38.17,
        startedAt: NOW - 50 * DAY,
        endedAt: null,
        startEvent: null,
        endEvent: null,
        startedBySession: true,
        currentState: 'started',
        sessions: gameSessions,
        spend: 49.99,
      },
    ],
    stateHistory: [
      {
        id: 'e1',
        iterationId: 'it1',
        type: 'started',
        occurredAt: NOW - 14 * DAY,
        datePrecision: 'day',
        note: 'Back after a break, straight into Act 2.',
      },
      {
        id: 'e2',
        iterationId: 'it1',
        type: 'resting',
        occurredAt: NOW - 34 * DAY,
        datePrecision: 'day',
        note: 'Another game took over for a while.',
      },
      {
        id: 'e3',
        iterationId: 'it1',
        type: 'started',
        occurredAt: NOW - 50 * DAY,
        datePrecision: 'day',
        note: 'Started on the Desk PC.',
      },
    ],
    spendHistory: [
      {
        id: 'sp1',
        type: 'purchase',
        amount: 49.99,
        occurredAt: NOW - 55 * DAY,
        datePrecision: 'day',
        note: 'Steam',
      },
    ],
  };
};

const achievements = {
  gameId: 'g2',
  steamAppId: 2000,
  syncedAt: NOW - DAY,
  unlocksSyncedAt: NOW - DAY,
  entries: Array.from({ length: 52 }, (_, index) => ({
    id: `a${index}`,
    apiName: `ACH_${index}`,
    displayName:
      ['First Light', 'Dawn of the Expedition', 'Stance Dancer', 'Perfect Parry', 'Master of Inks'][
        index % 5
      ] + (index >= 5 ? ` ${Math.floor(index / 5) + 1}` : ''),
    description: index === 6 ? null : 'Complete a chapter of the expedition.',
    iconUrl: null,
    iconGrayUrl: null,
    hidden: index === 6,
    globalPercent: [92, 71, 34, 8, 27][index % 5],
    unlockedAt: index < 38 && index !== 6 ? NOW - (index + 1) * DAY : null,
    dateReliable: true,
    sources: ['steam'],
  })),
  completion: [
    { source: 'steam', total: 52, unlocked: 38, complete: false, known: true, completedAt: null },
    { source: 'ra', total: 0, unlocked: 0, complete: false, known: false, completedAt: null },
  ],
};

const devicesList = [
  {
    tokenId: 't1',
    deviceId: 'd1',
    deviceName: 'Desk PC',
    shortDeviceId: 'd1',
    createdAt: NOW - 90 * DAY,
    lastUsedAt: NOW - HOUR,
    revokedAt: null,
  },
  {
    tokenId: 't2',
    deviceId: 'd2',
    deviceName: 'Living room PC',
    shortDeviceId: 'd2',
    createdAt: NOW - 60 * DAY,
    lastUsedAt: NOW - DAY,
    revokedAt: null,
  },
  {
    tokenId: 't3',
    deviceId: 'd3',
    deviceName: 'Handheld PC',
    shortDeviceId: 'd3',
    createdAt: NOW - 2 * DAY,
    lastUsedAt: null,
    revokedAt: null,
  },
];

const searchResults = [
  {
    igdbId: 1,
    title: 'Dark Harbor III',
    coverUrl: cover('#5a2a1a', '#ffb347'),
    releaseYear: 2016,
    owned: null,
  },
  {
    igdbId: 2,
    title: 'Darkwater Depths',
    coverUrl: cover('#4a1a1a', '#ff756f', 'circle'),
    releaseYear: 2023,
    owned: null,
  },
  {
    igdbId: 3,
    title: 'Dark Harbor: Remastered',
    coverUrl: cover('#3a3a2a', '#e9d2a0', 'peak'),
    releaseYear: 2018,
    owned: 'library',
  },
  {
    igdbId: 4,
    title: 'Darkling Grove',
    coverUrl: cover('#1a3a2a', '#9bd67a', 'circle'),
    releaseYear: 2017,
    owned: null,
  },
  {
    igdbId: 5,
    title: 'Pentagram Press',
    coverUrl: cover('#6a4a2a', '#e9d2a0'),
    releaseYear: 2022,
    owned: 'plan',
  },
];

type Options = {
  timer?: boolean;
  enrollExpired?: boolean;
  failSessions?: 'network' | 'expired';
  hangLibrary?: boolean;
  startConflict?: boolean;
  emptyPlan?: boolean;
  // Parar el cronómetro funciona (y después ya no queda ninguno).
  stopOk?: boolean;
};

const json = (route: Route, body: unknown, status = 200): Promise<void> =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const mockApi = async (page: Page, options: Options = {}): Promise<void> => {
  let stopped = false;
  await page.route('**/api/v2/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v2', '');
    const method = route.request().method();

    if (path === '/timer' && method === 'GET')
      return json(route, options.timer === false || stopped ? null : timer);
    if (path === '/timer/beat') return json(route, { alive: true });
    if (path === '/timer/stop') {
      if (!options.stopOk) return route.abort('internetdisconnected');
      // Un poco de red: el destello de confirmación llega después del clic.
      await new Promise((resolve) => setTimeout(resolve, 250));
      stopped = true;
      return json(route, { sessionId: timer.sessionId, durationSec: 72 * 60 });
    }
    if (path === '/timer/start') {
      if (options.startConflict)
        return json(
          route,
          {
            error: 'conflict',
            message:
              'Ember Protocol: Second Signal is being played on Desk PC. Stop it there first, or open its page to see the running session.',
          },
          409,
        );
      return json(route, timer);
    }
    if (path === '/stats/summary')
      return json(route, options.timer === false ? { ...stats, live: null } : stats);
    if (path === '/library') {
      if (options.hangLibrary) return; // se queda colgada: pantalla de carga
      return json(route, library);
    }
    if (path === '/sessions') {
      if (options.failSessions === 'network') return json(route, { error: 'internal' }, 500);
      if (options.failSessions === 'expired')
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html>sign in</html>',
        });
      const limit = Number(url.searchParams.get('limit') ?? 20);
      return json(route, { sessions: sessionRows.slice(0, limit), total: 126, limit, offset: 0 });
    }
    if (path === '/plan') return json(route, options.emptyPlan ? [] : plan);
    if (path === '/search') return json(route, searchResults);
    if (path === '/plan/add') return json(route, { gameId: 'new' });
    const game = /^\/games\/([^/]+)(\/.*)?$/.exec(path);
    if (game) {
      const [, id, sub] = game;
      if (!sub) return json(route, detail(id));
      if (sub === '/achievements') return json(route, { ...achievements, gameId: id });
      if (sub === '/curiosities')
        return json(route, ['The night maps were drawn by hand before being scanned in.']);
      if (sub === '/saga') return json(route, []);
      if (sub === '/media') return json(route, { screenshots: [], videoId: null });
    }
    if (path === '/me') return json(route, { email: 'host@example.com', isHost: true });
    if (path === '/devices') return json(route, devicesList);
    if (path === '/devices/enroll-code')
      return json(route, {
        code: '7KQF92MX',
        expiresAt: options.enrollExpired ? Date.now() - 1000 : Date.now() + 9 * 60_000 + 42_000,
      });
    if (path === '/invitations')
      return json(route, {
        email: 'friend@example.com',
        invitedBy: 'host@example.com',
        createdAt: NOW,
        expiresAt: NOW + 7 * DAY,
        acceptedAt: null,
      });
    return json(route, { error: 'not_found', message: 'unknown' }, 404);
  });
};

const shot = async (page: Page, name: string, fullPage = false): Promise<void> => {
  // Deja terminar las animaciones de entrada: el encendido del tubo (720 ms),
  // las cifras que cuentan (700 ms) y los medidores que se rellenan al entrar
  // en la vista (hasta ~1,4 s el de How long to beat).
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
};

test.describe('PWA', () => {
  test('home', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByRole('heading', { name: 'Tonight' }).waitFor();
    await shot(page, '01-home');
    await shot(page, '01-home-full', true);
  });

  test('library', async ({ page }) => {
    await mockApi(page);
    await page.goto('/library');
    await page.getByText('Copper Saints').waitFor();
    await shot(page, '02-library');
  });

  test('library loading', async ({ page }) => {
    await mockApi(page, { hangLibrary: true });
    await page.goto('/library');
    await shot(page, '03-library-loading');
  });

  test('sessions', async ({ page }) => {
    await mockApi(page);
    await page.goto('/sessions');
    await page.getByText('Yesterday').first().waitFor();
    await shot(page, '04-sessions');
  });

  test('sessions error', async ({ page }) => {
    await mockApi(page, { failSessions: 'network' });
    await page.goto('/sessions');
    await page.getByText("Can't reach your library").waitFor({ timeout: 20_000 });
    await shot(page, '05-sessions-error');
  });

  test('session expired', async ({ page }) => {
    await mockApi(page, { failSessions: 'expired' });
    await page.goto('/sessions');
    await page.getByText('Session expired').waitFor();
    await shot(page, '06-session-expired');
  });

  test('plan', async ({ page }) => {
    await mockApi(page);
    await page.goto('/plan');
    await page.getByText('Next up').waitFor();
    await shot(page, '07-plan');
    await shot(page, '07-plan-full', true);
    await page.getByRole('button', { name: 'Reorder' }).click();
    await shot(page, '08-plan-reorder');
  });

  test('plan empty', async ({ page }) => {
    await mockApi(page, { emptyPlan: true });
    await page.goto('/plan');
    await page.getByText('Nothing planned yet').waitFor();
    await shot(page, '09-plan-empty');
  });

  test('add game', async ({ page }) => {
    await mockApi(page);
    await page.goto('/plan');
    await page.getByRole('button', { name: 'Add a game to your plan' }).first().click();
    await page.getByRole('searchbox', { name: 'Search for a game' }).fill('dark');
    await page.getByText('Darkling Grove').waitFor();
    await page.getByRole('button', { name: 'Add Darkwater Depths to your plan' }).click();
    await page.getByText('Added to your plan').waitFor();
    await shot(page, '10-add-game');
  });

  test('game detail', async ({ page }) => {
    await mockApi(page);
    await page.goto('/game/g2');
    await page.getByRole('heading', { name: 'Ember Protocol: Second Signal' }).waitFor();
    await shot(page, '11-detail-top');
    await shot(page, '11-detail-full', true);
    await page
      .getByRole('heading', { name: 'How long to beat' })
      .evaluate((node) =>
        window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 70),
      );
    await shot(page, '12-detail-hltb');
    await page
      .getByRole('heading', { name: 'Achievements' })
      .evaluate((node) =>
        window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 70),
      );
    await shot(page, '13-detail-achievements');
    await page
      .getByRole('heading', { name: 'History', exact: true })
      .evaluate((node) =>
        window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 70),
      );
    await shot(page, '14-detail-history');
  });

  test('start session sheet', async ({ page }) => {
    await mockApi(page, { timer: false, startConflict: true });
    await page.goto('/game/g2');
    await page.getByRole('button', { name: 'Start timer' }).click();
    await page.getByRole('dialog').waitFor();
    await shot(page, '15-start-sheet');
    await page.getByRole('dialog').getByRole('button', { name: 'Start timer' }).click();
    await page.getByRole('alert').waitFor();
    await shot(page, '16-start-conflict');
  });

  test('settings', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Generate a code' }).click();
    await page.getByTestId('enroll-code').waitFor();
    await shot(page, '17-settings-code');
    await page.getByRole('button', { name: 'Revoke' }).nth(1).click();
    await page.getByRole('heading', { name: 'Devices' }).scrollIntoViewIfNeeded();
    await shot(page, '18-settings-revoke');
    await page.getByPlaceholder('friend@example.com').fill('friend@example.com');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'can now sign in' }).waitFor();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(page, '19-settings-invite');
  });

  test('settings expired code', async ({ page }) => {
    await mockApi(page, { enrollExpired: true });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Generate a code' }).click();
    await page.getByText('This code has expired').waitFor();
    await shot(page, '20-settings-expired');
  });

  test('offline', async ({ page, context }) => {
    await mockApi(page);
    await page.goto('/library');
    await page.getByText('Copper Saints').waitFor();
    await page.getByRole('button', { name: 'Stop the timer' }).click();
    await page.getByText("Couldn't stop the timer").waitFor();
    await context.setOffline(true);
    await page.getByText("You're offline").waitFor();
    await shot(page, '21-offline');
    await context.setOffline(false);
  });

  test('reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockApi(page);
    await page.goto('/');
    await page.getByRole('heading', { name: 'Tonight' }).waitFor();
    await shot(page, '22-home-reduced-motion');
  });
  // MOVIMIENTO (components/fx de la PWA). Las capturas son estáticas, así que
  // se congelan las animaciones y se fotografían fotograma a fotograma: el
  // TimerBar con un dígito cayendo, el Stop con su anillo y el destello de
  // confirmación al parar. Van a $PWA_MOTION_DIR (o a out/motion).
  test('motion: timer bar', async ({ page }) => {
    const MOTION = process.env.PWA_MOTION_DIR ?? join(OUT, 'motion');
    mkdirSync(MOTION, { recursive: true });
    await mockApi(page, { stopOk: true });
    await page.goto('/library');
    await page.getByText('Copper Saints').waitFor();
    await page.waitForTimeout(1600);

    const stopButton = page.getByRole('button', { name: 'Stop the timer' });
    const box = await stopButton.boundingBox();
    if (!box) throw new Error('No hay TimerBar');
    const clip = { x: 0, y: box.y - 46, width: 390, height: 140 };

    // Las animaciones WAAPI nuevas nacen en pausa para llevarlas al instante
    // que se quiera; las CSS se pausan al congelar. `release` las suelta.
    const holdNew = (): Promise<void> =>
      page.evaluate(() => {
        const proto = Element.prototype as Element & { heldAnimate?: Element['animate'] };
        proto.heldAnimate ??= proto.animate;
        const original = proto.heldAnimate;
        proto.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
          const animation = original.apply(this, args);
          animation.pause();
          return animation;
        };
      });
    const freezeAt = (ms: number): Promise<void> =>
      page.evaluate((time) => {
        for (const animation of document.getAnimations()) {
          // Las entradas que ya acabaron (la barra, las filas) no se tocan:
          // rebobinarlas vaciaría la pantalla.
          if (animation.playState === 'finished') continue;
          animation.pause();
          // Los bucles (VuMeter, halo) se quedan donde estén: solo se llevan
          // al instante pedido las animaciones de un solo disparo.
          const timing = animation.effect?.getComputedTiming();
          if (timing && timing.iterations !== Infinity) animation.currentTime = time;
        }
      }, ms);
    const release = (): Promise<void> =>
      page.evaluate(() => {
        const proto = Element.prototype as Element & { heldAnimate?: Element['animate'] };
        if (proto.heldAnimate) proto.animate = proto.heldAnimate;
        for (const animation of document.getAnimations()) animation.play();
      });
    const frames = async (name: string, times: number[]): Promise<void> => {
      for (const time of times) {
        await freezeAt(time);
        await page.waitForTimeout(60);
        await page.screenshot({
          path: join(MOTION, `${name}-${String(time).padStart(4, '0')}ms.png`),
          clip,
        });
      }
    };

    // 1. Un segundo que cambia: el dígito nuevo cae (Odometer) con el
    // cronómetro respirando y el VuMeter bailando.
    await holdNew();
    await page.waitForFunction(() =>
      document.getAnimations().some((animation) => animation.playState === 'paused'),
    );
    await frames('pwa-timerbar-tick', [0, 50, 100, 160, 280]);
    await release();

    // 2. Stop: se hunde, rebota y suelta un anillo con destello Live. Las
    // WAAPI nuevas siguen retenidas: el destello del paso 3 nace en pausa.
    await holdNew();
    await stopButton.click();
    await frames('pwa-timerbar-stop', [30, 90, 160, 260, 420]);

    // 3. Al confirmarse el parar, el destello de «hecho» donde estaba la barra.
    await page.waitForFunction(() =>
      [...document.body.children].some(
        (node) => node instanceof HTMLElement && node.style.background.includes('radial-gradient'),
      ),
    );
    await frames('pwa-timerbar-stopped-flash', [0, 120, 260, 480]);
    await release();
  });
});
