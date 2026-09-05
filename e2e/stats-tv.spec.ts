import type { Page } from '@playwright/test';
import { formatHours } from '../src/renderer/src/lib/format';
import type { SeedGame } from './sandbox';
import { DEFAULT_SEED } from './seed';
import { expect, goTo, test } from './fixtures';

// LO QUE ESTA SUITE BLINDA: la pantalla de Stats (las cifras de cabecera,
// la pestaña Journey y su índice de años) y el modo TV / Big Picture
// (entrar y salir de pantalla completa por IPC, con el árbol de /tv
// montado de verdad).
//
// TODO ES REAL Y NADA ES DOBLE: la app entera (main + preload + renderer +
// SQLite) arranca sobre la biblioteca sembrada de e2e/seed.ts —los mismos
// datos reales del dueño que usa el resto de la suite—, y ni Stats ni el
// modo TV llaman a ninguna API externa (leen la base local); no hace falta
// doblar nada. El fullscreen que se comprueba es el de verdad del sistema
// operativo (BrowserWindow.isFullScreen()), no un simulacro.
//
// Los números de "Backlog debt" y los años del Journey NO se hardcodean a
// ojo: se derivan aquí mismo de DEFAULT_SEED (mismo fichero que sembró la
// base), así que si algún día cambia el seed este test cambia solo con él
// en vez de quedarse mintiendo con un número viejo.

// El valor de una MetricCard (label.tsx) a partir de su etiqueta: la
// etiqueta vive en el div "cabecera" (icono + texto) de la card, y el
// número es el SIGUIENTE div hermano de esa cabecera — estructura fija de
// components/library/detail/MetricsRow.tsx, no depende de ninguna clase de
// Tailwind que pueda cambiar con un retoque visual.
const readMetricValue = (page: Page, label: string): Promise<string | null> =>
  page.evaluate((needle) => {
    const isLeaf = (element: Element): boolean => element.children.length === 0;
    const labelSpan = Array.from(document.querySelectorAll('span')).find(
      (span) => isLeaf(span) && span.textContent?.trim() === needle,
    );
    const header = labelSpan?.parentElement ?? null;
    return header?.nextElementSibling?.textContent?.trim() ?? null;
  }, label);

type BacklogDebtSnapshot = {
  hours: string | null;
  neverTouched: string | null;
  planToPlay: string | null;
};

// Toda la lectura de la tarjeta "Backlog debt" (BacklogDebtCard.tsx, modo
// all-time) en una sola pasada por el DOM. Los atributos data-debt-* forman
// el pequeño contrato de prueba: permiten cambiar la composición visual sin
// volver a acoplar las cifras al número de wrappers del diseño.
const readBacklogDebtCard = (page: Page): Promise<BacklogDebtSnapshot | null> =>
  page.evaluate(() => {
    const card = document.querySelector('.afterplay-debt-card');
    if (!card) return null;

    const readSplit = (label: string): string | null =>
      card.querySelector(`[data-debt-source="${label}"] [data-debt-count]`)?.textContent?.trim() ??
      null;

    return {
      hours: card.querySelector('[data-debt-hours]')?.textContent?.trim() ?? null,
      neverTouched: readSplit('Never touched'),
      planToPlay: readSplit('Plan to play'),
    };
  });

test.describe('Stats — cifras derivadas', () => {
  test('las cifras de cabecera cuadran con lo que devuelve games:getAll', async ({ afterplay }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    // La fuente de la verdad NO es este test, es la API que ya usa la app:
    // si getGames.ts o yearTotals.ts cambiaran cómo derivan las horas, este
    // número cambiaría con ellos y la comparación seguiría siendo justa.
    const games = await window.evaluate(() => globalThis.api.games.getAll());
    const expectedGames = String(games.length);
    const expectedHours = formatHours(games.reduce((sum, game) => sum + game.totalHours, 0));

    // El contador animado (useCountUp, ~700ms) tarda en aterrizar en su
    // valor final — expect.poll reintenta hasta que lo hace, en vez de un
    // sleep a ciegas.
    await expect
      .poll(() => readMetricValue(window, 'GAMES TRACKED'), { timeout: 5_000 })
      .toBe(expectedGames);
    await expect
      .poll(() => readMetricValue(window, 'TOTAL PLAYTIME'), { timeout: 5_000 })
      .toBe(expectedHours);
  });

  test('Backlog debt usa los tiempos de HowLongToBeat del seed', async ({ afterplay }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');

    // Derivado del seed, no inventado: "pendiente" es todo lo planeado
    // (no endless) — en esta biblioteca ningún juego de la biblioteca
    // principal se queda sin tocar (los 8 tienen algún evento de estado),
    // así que "Never touched" tiene que salir en 0.
    const hasStateEvent = (game: SeedGame): boolean =>
      (game.playthroughs ?? []).some((playthrough) => (playthrough.events?.length ?? 0) > 0);
    const planned = DEFAULT_SEED.filter((game) => game.planned === true && !game.endless);
    const expectedPlanned = String(planned.length);
    const expectedUnplayed = String(
      DEFAULT_SEED.filter((game) => !game.planned && !game.endless && !hasStateEvent(game)).length,
    );
    const expectedHours = String(
      Math.round(planned.reduce((sum, game) => sum + (game.hltb?.main ?? 0), 0)),
    );

    await expect
      .poll(async () => (await readBacklogDebtCard(window))?.hours ?? null, { timeout: 5_000 })
      .toBe(expectedHours);

    const card = await readBacklogDebtCard(window);
    expect(card?.neverTouched).toBe(expectedUnplayed);
    expect(card?.planToPlay).toBe(expectedPlanned);
  });
});

test.describe('Stats — Journey', () => {
  test('aparecen los años con actividad real del seed (2021 y 2023)', async ({ afterplay }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');
    await window.getByRole('button', { name: 'Journey', exact: true }).click();

    // Los dos playthroughs de Assassin's Creed II del seed: uno cerrado en
    // 2021 con precisión de AÑO y otro con fechas exactas que empieza en
    // octubre y termina en noviembre de 2023 (buildEntries agrupa por la
    // fecha de FIN). Si el agrupado por año/mes se rompiera, uno de los dos
    // faltaría o caería en el año contiguo.
    const nav = window.getByRole('navigation', { name: 'Journey date navigation' });
    await expect(nav.getByRole('button', { name: '2021', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: '2023', exact: true })).toBeVisible();
  });

  test('pulsar un año del índice navega hasta él y lo resalta', async ({ afterplay }) => {
    const { window } = afterplay;
    await goTo(window, '/stats');
    await window.getByRole('button', { name: 'Journey', exact: true }).click();

    const nav = window.getByRole('navigation', { name: 'Journey date navigation' });
    const year2021 = nav.getByRole('button', { name: '2021', exact: true });
    await expect(year2021).toBeVisible();
    // Antes de pulsar, el índice arranca resaltando el año MÁS RECIENTE
    // (2026 en este seed) — si 2021 ya apareciera marcado, el test de abajo
    // no probaría que el clic haya movido nada.
    await expect(year2021).not.toHaveAttribute('aria-current', 'true');

    await year2021.click();

    // settleScrollIntoView (Journey.tsx) puede relanzar el viaje varias
    // veces mientras los meses sin pintar aún se materializan con su alto
    // real — de ahí un margen bastante mayor que el resto de la suite.
    await expect(year2021).toHaveAttribute('aria-current', 'true', { timeout: 20_000 });
  });
});

test.describe('Modo TV (Big Picture)', () => {
  test('entrar por IPC pone la ventana en pantalla completa y monta el árbol de TV', async ({
    afterplay,
  }) => {
    const { app, window } = afterplay;
    // La app tiene que haber terminado de arrancar (biblioteca pintada)
    // antes de pedirle que cambie de modo.
    await expect(window.getByText("Assassin's Creed II").first()).toBeVisible();

    await window.evaluate(() => globalThis.api.window.bigPicture.enter());

    // "YOUR LIBRARY" es la última estantería de TvHome (tv/TvHome.tsx): que
    // aparezca demuestra que BigPictureLayout, TvFocusProvider y TvHome se
    // montaron los tres, no solo que cambió la ruta.
    await expect(window.getByText('YOUR LIBRARY')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => window.evaluate(() => globalThis.location.hash), { timeout: 5_000 })
      .toBe('#/tv');

    // El fullscreen de VERDAD del sistema operativo — lo que hace
    // enterBigPicture() en main/index.ts, no un CSS a pantalla completa.
    const isFullScreen = await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('index.html'),
      );
      return main?.isFullScreen() ?? false;
    });
    expect(isFullScreen).toBe(true);
  });

  test('salir por IPC restaura la ventana y la pantalla de escritorio', async ({ afterplay }) => {
    const { app, window } = afterplay;
    await expect(window.getByText("Assassin's Creed II").first()).toBeVisible();

    await window.evaluate(() => globalThis.api.window.bigPicture.enter());
    await expect(window.getByText('YOUR LIBRARY')).toBeVisible({ timeout: 20_000 });

    await window.evaluate(() => globalThis.api.window.bigPicture.exit());

    // ModeBridge (tv/ModeBridge.tsx) devuelve a la última ruta de escritorio
    // pisada — aquí '/games', la que trae el arranque — y RootLayout vuelve
    // a montarse con la biblioteca dentro.
    await expect(window.getByText("Assassin's Creed II").first()).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => window.evaluate(() => globalThis.location.hash), { timeout: 5_000 })
      .toBe('#/games');

    const isFullScreen = await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes('index.html'),
      );
      return main?.isFullScreen() ?? false;
    });
    expect(isFullScreen).toBe(false);
  });
});
