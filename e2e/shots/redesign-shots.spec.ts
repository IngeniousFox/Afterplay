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
