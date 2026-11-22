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

    // Ajustes: una página con sus nueve secciones (estados-ajustes-*.png). El
    // engranaje lleva a General; el resto, una captura por sección.
    await goTo(window, '/games');
    await window.getByRole('link', { name: 'Settings', exact: true }).click();
    await shot('settings');
    for (const section of [
      'general',
      'library',
      'emulators',
      'saves',
      'integrations',
      'sync',
      'achievements',
      'backups',
      'about',
    ]) {
      await goTo(window, `/settings/${section}` as Route);
      await shot(`settings-${section}`);
    }
    // Integrations con el aviso de bienvenida y IGDB abierto, como llega en el
    // primer arranque sin claves. La biblioteca de prueba sí tiene claves, así
    // que se simula la navegación del armazón: la misma ruta con el estado
    // { credentialsSpotlight } que pone RootLayout (formato del historial de
    // React Router: el estado propio va en `usr`).
    await goTo(window, '/home');
    await window.evaluate(() => {
      const state = { usr: { credentialsSpotlight: true }, key: 'shots', idx: 1 };
      globalThis.history.pushState(state, '', '#/settings/integrations');
      globalThis.dispatchEvent(new PopStateEvent('popstate', { state }));
    });
    await shot('settings-integrations-welcome');
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

// La ficha de juego (tanda 3): las cinco pestañas, la cabecera compacta al
// bajar, una sesión en marcha, la ficha del Plan y los modales (Add game en sus
// dos pasos, Edit game, Change cover y borrar), a 1600 x 1000 y a la ventana
// mínima.
test('capturas de la ficha y sus modales', async () => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const { app, window, sandbox } = await launchAfterplay();
  try {
    const resize = async (width: number, height: number): Promise<void> => {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          for (const w of BrowserWindow.getAllWindows()) {
            if (w.isVisible()) w.setContentSize(size.width, size.height);
          }
        },
        { width, height },
      );
      await window.waitForFunction((w) => globalThis.innerWidth === w, width);
    };
    const shot = async (name: string): Promise<void> => {
      await window.waitForTimeout(1200);
      await window.screenshot({ path: join(OUT, `${name}.png`) });
    };
    const tab = async (name: string): Promise<void> => {
      await window.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
    };
    // El contenedor que desplaza la ficha es el antepasado del h1 con scroll.
    const scrollDetail = async (top: number): Promise<void> => {
      await window.evaluate((y) => {
        let el = document.querySelector('h1')?.parentElement ?? null;
        while (el && getComputedStyle(el).overflowY !== 'auto') el = el.parentElement;
        el?.scrollTo({ top: y });
      }, top);
    };

    await resize(1600, 1000);
    const detailId = gameIdOf(sandbox, 'Strange Horticulture');
    await goTo(window, `/games/${detailId}` as Route);
    await shot('ficha-overview');
    await scrollDetail(520);
    await shot('ficha-overview-scroll');
    await scrollDetail(2000);
    await shot('ficha-overview-bottom');
    for (const name of ['Sessions', 'Achievements', 'Saves', 'Notes']) {
      await tab(name);
      await shot(`ficha-${name.toLowerCase()}`);
    }

    // Otro juego con dos playthroughs y sin carátula ni arte.
    await goTo(window, `/games/${gameIdOf(sandbox, "Assassin's Creed II")}` as Route);
    await shot('ficha-dos-playthroughs');
    await tab('Sessions');
    await shot('ficha-dos-playthroughs-sessions');

    // Una sesión en marcha: Stop en Live y el cronómetro.
    const session = await window.evaluate(
      (id) => globalThis.api.sessions.startForGame(id as never),
      detailId,
    );
    await goTo(window, `/games/${detailId}` as Route);
    await shot('ficha-live');
    await tab('Sessions');
    await shot('ficha-live-sessions');
    if (session) {
      await window.evaluate((id) => globalThis.api.sessions.close(id, new Date()), session.id);
    }

    // La ficha del Plan.
    await goTo(window, `/plan/${gameIdOf(sandbox, 'Chrono Trigger')}` as Route);
    await shot('ficha-plan');
    await scrollDetail(520);
    await shot('ficha-plan-scroll');

    // Saves con el motor y la nube "listos": el estado lo inventa el main de
    // prueba (dos PCs que divergieron) para ver la pestaña y Restore save.
    await app.evaluate(({ ipcMain }, gameId) => {
      const now = Date.now();
      const at = (hours: number): Date => new Date(now - hours * 3_600_000);
      const tip = (
        id: string,
        deviceId: string,
        deviceName: string,
        isOwn: boolean,
        h: number,
      ): Record<string, unknown> => ({
        backupId: id,
        contentHash: `hash-${id}`,
        deviceId,
        deviceName,
        isOwn,
        createdAt: at(h),
      });
      const row = (
        id: string,
        h: number,
        machineName: string,
        differential: boolean,
      ): Record<string, unknown> => ({
        id,
        gameId,
        createdAt: at(h),
        backupName: `backup-${id}`,
        r2Key: `saves/${id}`,
        sizeBytes: 2_400_000 - Number(id.slice(1)) * 90_000,
        ludusaviName: 'Strange Horticulture',
        differential,
        parentBackupName: null,
        machineId: machineName,
        machineName,
        machineHome: '',
        locations: ['%LOCALAPPDATA%/Bad Viking/Strange Horticulture'],
        hasRegistry: false,
        contentHash: `hash-${id}`,
      });
      const living = tip('b1', 'device-living', 'Living room PC', false, 3);
      const desk = tip('b2', 'device-desk', 'Desk PC', true, 26);
      ipcMain.removeHandler('saves:getStatus');
      ipcMain.handle('saves:getStatus', () => ({
        binaryAvailable: true,
        r2Configured: true,
        ready: true,
      }));
      ipcMain.removeHandler('saves:getGameState');
      ipcMain.handle('saves:getGameState', () => ({
        ludusaviName: 'Strange Horticulture',
        detectionSource: 'auto',
        enabled: true,
        customPaths: ['D:/Backups/Horticulture extra'],
        local: {
          files: 3,
          bytes: 2_300_000,
          registryKeys: [],
          locations: ['%LOCALAPPDATA%/Bad Viking/Strange Horticulture'],
          steamIdInPath: true,
          change: 'different',
        },
        cloud: [
          row('b1', 3, 'Living room PC', false),
          row('b2', 26, 'Desk PC', true),
          row('b3', 50, 'Desk PC', false),
          row('b4', 98, 'Desk PC', true),
          row('b5', 190, 'Living room PC', false),
          row('b6', 240, 'Desk PC', false),
          row('b7', 300, 'Desk PC', false),
        ],
        restoreTarget: null,
        running: false,
        sync: {
          status: 'diverged',
          head: living,
          tips: [living, desk],
          localChanges: true,
          localVerified: true,
        },
      }));
      ipcMain.removeHandler('saves:restore');
      ipcMain.handle('saves:restore', () => ({
        files: [
          {
            target: '%LOCALAPPDATA%/Bad Viking/Strange Horticulture/save_0.dat',
            source: null,
            bytes: 1_200_000,
          },
          {
            target: '%LOCALAPPDATA%/Bad Viking/Strange Horticulture/save_1.dat',
            source: null,
            bytes: 900_000,
          },
          {
            target: '%LOCALAPPDATA%/Bad Viking/Strange Horticulture/settings.json',
            source: null,
            bytes: 4_000,
          },
        ],
        totalBytes: 2_104_000,
        warnings: [],
        removedFiles: [],
      }));
    }, detailId);
    // Recargar: el estado de Saves ya estaba en la caché del renderer.
    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await goTo(window, `/games/${detailId}` as Route);
    await tab('Saves');
    await shot('ficha-saves-estados');
    await window.getByTitle('Restore this version…').first().click();
    await shot('modal-restaurar');
    await window.getByRole('button', { name: 'Show me what will happen' }).click();
    await shot('modal-restaurar-plan');
    await window.keyboard.press('Escape');

    // Modales de la ficha.
    await goTo(window, `/games/${detailId}` as Route);
    await window.getByRole('button', { name: 'Edit', exact: true }).click();
    await shot('modal-editar');
    await window.keyboard.press('Escape');
    await window.getByRole('button', { name: 'Change cover / hero' }).first().click();
    await shot('modal-caratula');
    await window.keyboard.press('Escape');
    await window.getByRole('button', { name: 'Delete game' }).first().click();
    await shot('modal-borrar');
    await window.keyboard.press('Escape');

    // Add game desde el armazón: buscar (con un resultado de prueba) y
    // escanear.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('igdb:search');
      ipcMain.handle('igdb:search', () => [
        {
          igdbId: 990001,
          title: 'Shots Candidate',
          coverUrl: null,
          releaseYear: 2025,
          platforms: ['PC (Microsoft Windows)', 'PlayStation 5'],
          genres: [],
          summary: null,
        },
        {
          igdbId: 990002,
          title: 'Shots Candidate II',
          coverUrl: null,
          releaseYear: 2027,
          platforms: ['PC (Microsoft Windows)'],
          genres: [],
          summary: null,
        },
      ]);
    });
    await window.getByRole('button', { name: 'Add game' }).first().click();
    await shot('modal-add');
    await window.getByPlaceholder(/Search a game/).fill('Shots');
    await shot('modal-add-buscar');
    const scan = window.getByRole('button', { name: /Scan/ }).first();
    if (await scan.isVisible().catch(() => false)) {
      await scan.click();
      await shot('modal-add-escanear');
    }
    await window.keyboard.press('Escape');

    // La ventana mínima.
    await resize(1000, 700);
    await goTo(window, `/games/${detailId}` as Route);
    await shot('ficha-min');
    await scrollDetail(420);
    await shot('ficha-min-scroll');
    await tab('Sessions');
    await shot('ficha-min-sessions');
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
      ['settings-integrations-min', '/settings/integrations' as Route],
      ['settings-saves-min', '/settings/saves' as Route],
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

// Stats (tanda 5): la página global entera por tramos de scroll, un año
// concreto, la ficha de un juego por tramos y el Journey.
test('capturas de Stats', async () => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const { app, window, sandbox } = await launchAfterplay();
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isVisible()) w.setContentSize(1600, 1000);
      }
    });
    await window.emulateMedia({ reducedMotion: 'reduce' });
    const scrollShots = async (prefix: string, selector: string): Promise<void> => {
      const scroller = window.locator(selector).first();
      await scroller.waitFor();
      await window.waitForTimeout(1200);
      const { height, client } = await scroller.evaluate((el) => ({
        height: el.scrollHeight,
        client: el.clientHeight,
      }));
      const steps = Math.min(9, Math.ceil(height / (client * 0.85)));
      for (let index = 0; index < steps; index++) {
        await scroller.evaluate(
          (el, top) => el.scrollTo({ top, behavior: 'instant' as ScrollBehavior }),
          Math.round(index * client * 0.85),
        );
        await window.waitForTimeout(400);
        await window.screenshot({ path: join(OUT, `${prefix}-${index + 1}.png`) });
      }
    };

    await goTo(window, '/stats');
    await scrollShots('stats-all', '.afterplay-stats-screen');

    const year = window.getByRole('button', { name: '2026', exact: true }).first();
    if (await year.isVisible().catch(() => false)) {
      await year.click();
      await scrollShots('stats-year', '.afterplay-stats-screen');
    }

    for (const [prefix, title] of [
      ['stats-game', '007 First Light'],
      ['stats-game-runs', "Assassin's Creed II"],
    ]) {
      await goTo(window, `/stats?game=${gameIdOf(sandbox, title)}` as Route);
      await scrollShots(prefix, '.afterplay-game-stats-screen');
    }

    await goTo(window, '/stats');
    await window.getByRole('button', { name: 'Journey', exact: true }).click();
    await scrollShots('stats-journey', '.afterplay-stats-screen');
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

// El modo TV (tanda 8) a 1920 x 1080: Home, Library con el foco en una
// portada, el teclado en pantalla, la ficha y sus secciones, Journey, el menú
// Start y el panel de fin de sesión. Se entra como en e2e/stats-tv.spec.ts
// (por IPC, pantalla completa de verdad) y se fija el viewport a 1080p para
// que la escala 10-foot sea la de una tele, sea cual sea el monitor.
test('capturas del modo TV', async () => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const { app, window, sandbox } = await launchAfterplay();
  try {
    await window.getByText("Assassin's Creed II").first().waitFor({ state: 'visible' });
    await window.evaluate(() => globalThis.api.window.bigPicture.enter());
    await window.waitForFunction(() => globalThis.location.hash === '#/tv', undefined, {
      timeout: 20_000,
    });
    await window.setViewportSize({ width: 1920, height: 1080 });
    const tvGo = async (hash: string): Promise<void> => {
      await window.evaluate((target) => {
        globalThis.location.hash = target;
      }, hash);
      await window.waitForFunction((target) => globalThis.location.hash === target, hash);
    };
    const shot = async (name: string, wait = 1800): Promise<void> => {
      await window.waitForTimeout(wait);
      await window.screenshot({ path: join(OUT, `tv-${name}.png`) });
    };
    const press = async (key: string, times = 1): Promise<void> => {
      for (let index = 0; index < times; index++) {
        await window.keyboard.press(key);
        await window.waitForTimeout(140);
      }
    };

    // La cortina de entrada dura 1,65 s.
    await shot('home', 3200);
    await press('ArrowDown', 2);
    await press('ArrowRight');
    await shot('home-shelf');

    await tvGo('#/tv/library');
    await window.waitForTimeout(1000);
    await press('ArrowRight');
    await shot('library');
    await press('ArrowDown');
    await shot('library-row2');
    // En Library el teclado físico escribe en la búsqueda; el teclado en
    // pantalla se abre desde el chip de búsqueda, arriba a la derecha.
    await window.getByRole('button', { name: /^Search/ }).click();
    await shot('keyboard-empty', 900);
    await window.keyboard.type('al', { delay: 120 });
    await press('ArrowDown');
    await press('ArrowRight', 3);
    await shot('keyboard');
    await press('Escape');
    await press('Escape');

    const detailId = gameIdOf(sandbox, 'Strange Horticulture');
    await tvGo(`#/tv/game/${detailId}`);
    await shot('detail');
    for (const section of ['achievements', 'sessions', 'history', 'notes', 'saves']) {
      await press('e');
      await shot(`detail-${section}`, 1200);
    }
    // Una sección con el foco en una fila: Sessions, bajando desde arriba.
    await press('e', 3);
    await press('ArrowDown', 3);
    await shot('detail-sessions-focus', 900);

    await tvGo('#/tv/journey');
    await shot('journey', 2200);
    await press('e');
    await shot('journey-year', 1200);
    await press('e');
    await shot('journey-month', 1200);
    await press('ArrowRight');
    await shot('journey-month-focus', 900);

    await tvGo('#/tv');
    await window.waitForTimeout(1200);
    await press('m');
    await shot('menu', 900);
    await press('Escape');

    // El panel de fin de sesión, con el mismo evento que manda el main.
    await app.evaluate(
      ({ BrowserWindow }, payload) => {
        const main = BrowserWindow.getAllWindows().find((candidate) =>
          candidate.webContents.getURL().includes('index.html'),
        );
        main?.webContents.send('sessions:closed', payload);
      },
      {
        sessionId: 'shot-session',
        gameId: detailId,
        iterationId: 'shot-iteration',
        endless: false,
        gameTitle: 'Strange Horticulture',
        coverUrl: null,
        heroUrl: null,
        durationSec: 2 * 3600 + 40 * 60,
        totalHours: 40.8,
        isLongest: true,
      },
    );
    await shot('session-ended', 1200);
    await press('Escape');

    await window.emulateMedia({ reducedMotion: 'reduce' });
    await tvGo('#/tv/library');
    await window.waitForTimeout(1000);
    await press('ArrowRight');
    await shot('library-reduced-motion');
  } finally {
    await window.evaluate(() => globalThis.api.window.bigPicture.exit()).catch(() => {});
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});
