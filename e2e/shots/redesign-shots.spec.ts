import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { gameIdOf, goTo, launchAfterplay, type Route } from '../fixtures';

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
