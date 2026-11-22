import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _electron, test } from '@playwright/test';
import { openLocalDatabase } from '../../src/main/db/v2/connection';
import { createQueryContext } from '../../src/main/db/v2/queries/common/context';
import { seedEmulator, seedSession } from '../../src/main/db/v2/queries/common/__tests__/fixtures';
import { gameIdOf, goTo, launchAfterplay, type Route } from '../fixtures';
import { createSandbox, type SeedGame } from '../sandbox';

// CAPTURAS DEL REDISEÑO 2.0 (antes/después).
//
// No es un test: recorre las pantallas de escritorio sobre la biblioteca de
// prueba desechable (e2e/seed.ts) y guarda una imagen por pantalla en
// docs/redesign/screens/<SHOTS_SET>/. Nunca toca datos personales.
//
//   npm run build
//   $env:SHOTS_SET='after'; npx playwright test -c playwright.shots.config.ts

const SET = process.env.SHOTS_SET ?? 'before';
const OUT = join(process.cwd(), 'docs', 'redesign', 'screens', SET);

test('capturas de escritorio', async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const { app, window, sandbox } = await launchAfterplay();
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isVisible()) {
          w.setContentSize(1600, 1000);
          w.center();
        }
      }
    });
    const settle = async (): Promise<void> => {
      await window.waitForLoadState('domcontentloaded');
      await window.waitForTimeout(1500);
    };
    const shot = async (name: string): Promise<void> => {
      await settle();
      await window.screenshot({ path: join(OUT, `${name}.png`) });
    };

    const detailId = gameIdOf(sandbox, 'Strange Horticulture');
    const routes: [string, Route][] = [
      ['home', '/home'],
      ['library', '/games'],
      ['detail', `/games/${detailId}` as Route],
      ['plan', '/plan'],
      ['sessions', '/sessions'],
      ['stats', '/stats'],
      ['stats-game', `/stats?game=${detailId}` as Route],
    ];
    for (const [name, route] of routes) {
      await goTo(window, route);
      await shot(name);
    }

    // Diálogos: el alert dialog de borrar (components/ui/alert-dialog) y el
    // modal de editar notas (ModalShell), para ver Overlay, botones y foco.
    await goTo(window, `/games/${detailId}` as Route);
    const del = window.getByTitle('Delete game', { exact: true });
    if (await del.isVisible().catch(() => false)) {
      await del.click();
      await shot('dialog-delete');
      await window.keyboard.press('Escape');
    }
    const cover = window.getByTitle('Change cover / hero', { exact: true });
    if (await cover.isVisible().catch(() => false)) {
      await cover.click();
      await shot('dialog-modal');
      await window.keyboard.press('Escape');
    }

    // La paleta de Ctrl K, con resultados y sin ellos.
    await goTo(window, '/home');
    await window.keyboard.press('Control+k');
    await shot('palette');
    await window.keyboard.type('zzqx');
    await shot('palette-empty');
    await window.keyboard.press('Escape');

    // Una sesión en marcha: Home, Library y la barra "Now playing" acoplada.
    const session = await window.evaluate(
      (id) => globalThis.api.sessions.startForGame(id as never),
      detailId,
    );
    await goTo(window, '/home');
    await shot('home-live');
    await goTo(window, '/games');
    await shot('library-live');
    if (session) {
      await window.evaluate((id) => globalThis.api.sessions.close(id, new Date()), session.id);
    }

    // Ajustes: hoy un modal que abre el engranaje; en 2.0, una página.
    await goTo(window, '/games');
    const gear = window.getByRole('button', { name: 'Settings' }).first();
    if (await gear.isVisible().catch(() => false)) {
      await gear.click();
      await shot('settings');
      await window.keyboard.press('Escape');
    } else {
      const link = window.getByRole('link', { name: 'Settings' }).first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await shot('settings');
      }
    }
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

// La biblioteca vacía del primer arranque (estados-vacio-biblioteca.png) y la
// ventana mínima de la app (1000 x 700, src/main/windows/mainWindow.ts).
test('capturas de biblioteca vacía y ventana mínima', async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const empty = await launchAfterplay({ games: [] });
  try {
    await empty.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isVisible()) w.setContentSize(1600, 1000);
      }
    });
    await empty.window.waitForTimeout(1500);
    await empty.window.screenshot({ path: join(OUT, 'home-empty.png') });
    await goTo(empty.window, '/games');
    await empty.window.waitForTimeout(1500);
    await empty.window.screenshot({ path: join(OUT, 'library-empty.png') });
  } finally {
    await empty.app.close().catch(() => {});
    empty.sandbox.cleanup();
  }

  const small = await launchAfterplay();
  try {
    await small.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isVisible()) w.setContentSize(1000, 700);
      }
    });
    for (const [name, route] of [
      ['home-min', '/home'],
      ['library-min', '/games'],
    ] as [string, Route][]) {
      await goTo(small.window, route);
      await small.window.waitForTimeout(1500);
      await small.window.screenshot({ path: join(OUT, `${name}.png`) });
    }
  } finally {
    await small.app.close().catch(() => {});
    small.sandbox.cleanup();
  }
});

// Tanda 4 (Plan y Sessions): la cola con Next up, Up next reordenable, las
// lentes y el horizonte; el historial por días con una sesión en marcha, el
// aviso de sesión cerrada sobre la barra Now playing y las dos pantallas en la
// ventana mínima. Biblioteca propia y desechable: planeados fijados y sin
// fijar, uno sin salir, y sesiones de los últimos días.
test('capturas de Plan y Sessions', async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const daysAgo = (days: number, hour: number, minute = 0): Date => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const planned = (
    title: string,
    hltbMain: number,
    addedDaysAgo: number,
    extra: Partial<SeedGame> = {},
  ): SeedGame => ({
    title,
    planned: true,
    releaseYear: 2019,
    hltb: { main: hltbMain },
    addedAt: daysAgo(addedDaysAgo, 12),
    playthroughs: [
      { events: [{ type: 'plan_to_play', at: daysAgo(addedDaysAgo, 12), precision: 'day' }] },
    ],
    ...extra,
  });
  const games: SeedGame[] = [
    planned('Shot Plan Metaphor', 70, 25, { pinnedAt: daysAgo(20, 10) }),
    planned('Shot Plan Pentiment', 20, 23, { pinnedAt: daysAgo(19, 10) }),
    planned('Shot Plan Animal Well', 6, 19, { pinnedAt: daysAgo(18, 10) }),
    planned('Shot Plan Lies of P', 30, 300),
    planned('Shot Plan Octopath Traveler II', 55, 120),
    planned('Shot Plan Sea of Stars', 18, 40),
    planned('Shot Plan Sequel', 25, 10, { releaseYear: 2027 }),
    {
      title: 'Shot Hollow Knight',
      releaseYear: 2017,
      playthroughs: [
        {
          events: [{ type: 'started', at: daysAgo(30, 20), precision: 'datetime' }],
          sessions: [
            { at: daysAgo(0, 13, 5), hours: 0.75 },
            { at: daysAgo(1, 15), hours: 1.4 },
            { at: daysAgo(6, 21, 15), hours: 1.55 },
            { at: daysAgo(20, 20), hours: 2 },
          ],
        },
      ],
    },
    {
      title: 'Shot Clair Obscur',
      releaseYear: 2025,
      playthroughs: [
        {
          events: [{ type: 'started', at: daysAgo(40, 20), precision: 'datetime' }],
          sessions: [
            { at: daysAgo(1, 21), hours: 2.15 },
            { at: daysAgo(1, 10, 30), hours: 1.85 },
            { at: daysAgo(2, 20), hours: 2.2 },
            { at: daysAgo(4, 21), hours: 2.5 },
            { at: daysAgo(5, 12), hours: 3, manual: true },
            { at: daysAgo(45, 19), hours: 1.2 },
          ],
        },
      ],
    },
  ];
  const { app, window, sandbox } = await launchAfterplay({ games });
  const resize = async (width: number, height: number): Promise<void> => {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (w.isVisible()) w.setContentSize(size.width, size.height);
        }
      },
      { width, height },
    );
    await window.waitForFunction((size) => globalThis.innerWidth === size, width);
  };
  const shot = async (name: string): Promise<void> => {
    await window.waitForTimeout(1200);
    await window.screenshot({ path: join(OUT, `${name}.png`) });
  };
  try {
    await resize(1600, 1000);
    await goTo(window, '/plan');
    await shot('t4-plan');
    await window.getByRole('button', { name: /On the horizon/ }).click();
    await window.mouse.wheel(0, 900);
    await shot('t4-plan-queue');

    // Reordenar con el teclado: foco en el asa del segundo y flecha arriba.
    await window.mouse.wheel(0, -3000);
    await window.getByRole('button', { name: /Reorder Shot Plan Pentiment/ }).focus();
    await window.keyboard.press('ArrowUp');
    await shot('t4-plan-keyboard');

    await goTo(window, '/sessions');
    await shot('t4-sessions');

    // Una sesión en marcha (fila en directo y barra Now playing) y, encima,
    // el aviso de una sesión que acaba de cerrarse.
    const liveId = gameIdOf(sandbox, 'Shot Hollow Knight');
    const closedId = gameIdOf(sandbox, 'Shot Clair Obscur');
    const live = await window.evaluate(
      (id) => globalThis.api.sessions.startForGame(id as never),
      liveId,
    );
    const ended = await window.evaluate(
      (id) => globalThis.api.sessions.startForGame(id as never),
      closedId,
    );
    if (ended) {
      await window.evaluate((id) => globalThis.api.sessions.close(id, new Date()), ended.id);
    }
    await goTo(window, '/sessions');
    await shot('t4-sessions-live');
    if (ended) {
      await app.evaluate(
        ({ BrowserWindow }, payload) => {
          for (const w of BrowserWindow.getAllWindows()) {
            if (w.isVisible()) w.webContents.send('sessions:closed', payload);
          }
        },
        {
          sessionId: ended.id,
          gameId: closedId,
          iterationId: ended.iterationId,
          endless: false,
          gameTitle: 'Shot Clair Obscur',
          coverUrl: null,
          heroUrl: null,
          durationSec: 2 * 3600 + 10 * 60,
          totalHours: 40.3,
          isLongest: true,
        },
      );
      await window.mouse.move(800, 300);
      await shot('t4-toast');
      await window.getByRole('button', { name: 'Add note', exact: true }).click();
      await window.keyboard.type('Past the flooded cliffs');
      await shot('t4-toast-note');
      await window.keyboard.press('Escape');
    }
    if (live) {
      await window.evaluate((id) => globalThis.api.sessions.close(id, new Date()), live.id);
    }

    await resize(1000, 700);
    await goTo(window, '/plan');
    await shot('t4-plan-min');
    await goTo(window, '/sessions');
    await shot('t4-sessions-min');
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

// La bandeja de sesiones pendientes y el modal de asignar (estados-pendientes
// y estados-asignar): se siembran un emulador y tres sesiones sin asignar
// (una en marcha) en la base desechable ANTES de arrancar la app, con los
// mismos `seed*` que usa el sandbox.
test('capturas de sesiones pendientes', async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const sandbox = await createSandbox({
    games: [
      { title: 'Shot Super Metroid', isEmulated: true, steamAppId: null, releaseYear: 1994 },
      { title: 'Shot Metroid Dread', isEmulated: true, steamAppId: null, releaseYear: 2021 },
    ],
  });
  const { machineId } = JSON.parse(
    readFileSync(join(sandbox.userDataDir, 'machine-saves.json'), 'utf-8'),
  ) as { machineId: string };
  const local = openLocalDatabase({
    path: sandbox.dbPath,
    deviceId: machineId,
    migrationsFolder: join(process.cwd(), 'drizzle-v2'),
  });
  try {
    const ctx = createQueryContext(local);
    const retroArch = seedEmulator(ctx, { name: 'RetroArch' });
    const dolphin = seedEmulator(ctx, { name: 'Dolphin' });
    const ago = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);
    seedSession(ctx, { emulatorId: retroArch, startedAt: ago(21), endedAt: null });
    seedSession(ctx, { emulatorId: dolphin, startedAt: ago(26 * 60), endedAt: ago(26 * 60 - 65) });
    seedSession(ctx, {
      emulatorId: retroArch,
      startedAt: ago(48 * 60),
      endedAt: ago(48 * 60 - 38),
    });
  } finally {
    local.close();
  }

  const app = await _electron.launch({
    args: [join(process.cwd(), 'out', 'main', 'index.js')],
    cwd: process.cwd(),
    env: {
      ...process.env,
      AFTERPLAY_E2E_USER_DATA: sandbox.userDataDir,
      DATABASE_URL: '',
      DATABASE_AUTH_TOKEN: '',
    },
  });
  try {
    let window = app.windows().find((page) => page.url().includes('index.html'));
    while (!window) {
      const page = await app.waitForEvent('window', { timeout: 60_000 });
      if (page.url().includes('index.html')) window = page;
    }
    await window.getByRole('link', { name: 'Home', exact: true }).waitFor({ state: 'visible' });
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isVisible()) w.setContentSize(1600, 1000);
      }
    });
    await goTo(window, '/sessions');
    await window.waitForTimeout(1500);
    await window.screenshot({ path: join(OUT, 't4-pending.png') });

    await window
      .getByRole('region', { name: 'Pending sessions' })
      .getByRole('button', { name: 'Assign' })
      .nth(1)
      .click();
    await window.keyboard.type('met');
    await window.keyboard.press('ArrowDown');
    await window.waitForTimeout(800);
    await window.screenshot({ path: join(OUT, 't4-assign.png') });
    await window.keyboard.press('Escape');

    await window
      .getByRole('region', { name: 'Pending sessions' })
      .getByRole('button', { name: 'Discard session' })
      .first()
      .click();
    await window.waitForTimeout(800);
    await window.screenshot({ path: join(OUT, 't4-delete.png') });
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});
