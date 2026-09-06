import type { Page } from '@playwright/test';
import { expect, goTo, launchAfterplay, test } from './fixtures';
import { DEFAULT_SEED } from './seed';

const idOf = async (page: Page, title: string): Promise<number> => {
  const games = await page.evaluate(() => globalThis.api.games.getAll());
  const found = games.find((game) => game.title === title);
  if (!found) throw new Error(`el seed no trae "${title}" — revisa e2e/seed.ts`);
  return found.id;
};

test.describe('Estadísticas de un juego', () => {
  test('la ficha tiene hero, contexto, récords, trofeos y ritmo visual', async ({
    afterplay,
  }, testInfo) => {
    const { window } = afterplay;
    const gameId = await idOf(window, '007 First Light');
    await goTo(window, `/stats?game=${gameId}`);

    await expect(window.getByRole('heading', { level: 1, name: '007 First Light' })).toBeVisible();
    await expect(window.getByTestId('game-stats-hero')).toBeVisible();
    await expect(window.locator('.afterplay-game-metric')).toHaveCount(4);
    await expect(window.locator('.afterplay-game-journey-step')).toHaveCount(3);
    await expect(window.locator('.afterplay-game-record')).toHaveCount(6);
    await expect(window.locator('.afterplay-game-badge')).toHaveCount(9);
    const dayparts = window.locator('.afterplay-game-daypart');
    const visibleDaypartCount = await dayparts.evaluateAll(
      (elements) => elements.filter((element) => Number(element.dataset.seconds) > 0).length,
    );
    const visibleDaypartArcs = window.locator('.afterplay-game-daypart-arc');
    await expect(visibleDaypartArcs).toHaveCount(visibleDaypartCount);

    // Las franjas vacías no deben crear una tapa redonda de color en el SVG.
    // Comparamos los datos de las filas con los arcos realmente renderizados
    // para cubrir cualquier zona horaria de la máquina que ejecute el test.
    const emptyDayparts = await dayparts.evaluateAll((elements) =>
      elements
        .filter((element) => Number(element.dataset.seconds) === 0)
        .map((element) => element.dataset.daypart),
    );
    const renderedDayparts = await visibleDaypartArcs.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-daypart')),
    );
    for (const daypart of emptyDayparts) expect(renderedDayparts).not.toContain(daypart);

    await expect(window.locator('.afterplay-game-hltb-milestone')).toHaveCount(3);
    await expect(window.getByText('THE RUN', { exact: true })).toBeVisible();

    const readableType = await window.evaluate(() => ({
      timeLabel: Number.parseFloat(
        getComputedStyle(document.querySelector('.afterplay-game-daypart-copy strong')!).fontSize,
      ),
      timeRange: Number.parseFloat(
        getComputedStyle(document.querySelector('.afterplay-game-daypart-copy small')!).fontSize,
      ),
      hltbKicker: Number.parseFloat(
        getComputedStyle(document.querySelector('.afterplay-game-hltb-kicker')!).fontSize,
      ),
      hltbStatus: Number.parseFloat(
        getComputedStyle(document.querySelector('.afterplay-game-hltb-milestone > em')!).fontSize,
      ),
    }));
    expect(readableType.timeLabel).toBeGreaterThanOrEqual(11);
    expect(readableType.timeRange).toBeGreaterThanOrEqual(9);
    expect(readableType.hltbKicker).toBeGreaterThanOrEqual(10);
    expect(readableType.hltbStatus).toBeGreaterThanOrEqual(8);

    // Los arcos comparten centro con el dial. Esta geometría evita que una
    // combinación de transform SVG + transform-origin vuelva a desplazar el
    // aro de color sobre las leyendas (el fallo visual que motivó este test).
    const dialIsAligned = await window.locator('.afterplay-game-daypart-dial').evaluate((dial) => {
      const dialRect = dial.getBoundingClientRect();
      const center = {
        x: dialRect.left + dialRect.width / 2,
        y: dialRect.top + dialRect.height / 2,
      };
      return Array.from(dial.querySelectorAll('.afterplay-game-daypart-arc')).every((arc) => {
        const rect = arc.getBoundingClientRect();
        return (
          Math.abs(rect.left + rect.width / 2 - center.x) < 2 &&
          Math.abs(rect.top + rect.height / 2 - center.y) < 2
        );
      });
    });
    expect(dialIsAligned).toBe(true);

    await window.waitForTimeout(950);
    await window.screenshot({
      path: testInfo.outputPath('game-stats-dossier-top.png'),
      fullPage: false,
    });

    const signature = window.getByText('YOUR SIGNATURE', { exact: true });
    await signature.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(signature).toBeInViewport();
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('game-stats-dossier-signature.png'),
      fullPage: false,
    });

    const earnedBadge = window.locator('.afterplay-game-badge.is-earned').first();
    await earnedBadge.hover();
    await expect
      .poll(() =>
        earnedBadge.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m42),
      )
      .toBeLessThan(-1);
    await expect(earnedBadge.locator('div').last()).toBeVisible();

    const afternoon = window.locator('.afterplay-game-daypart').filter({
      has: window.getByText('Afternoon', { exact: true }),
    });
    await afternoon.hover();
    await expect(window.locator('.afterplay-game-daypart-center')).toContainText('AFTERNOON');

    const hltb = window.locator('.afterplay-game-hltb-dossier');
    await hltb.scrollIntoViewIfNeeded();
    await expect(hltb).toBeInViewport();
    const mainTarget = hltb.locator('.afterplay-game-hltb-milestone').first();
    await mainTarget.hover();
    await expect(mainTarget).toHaveClass(/is-hovered/);
    await window.waitForTimeout(300);
    await window.screenshot({
      path: testInfo.outputPath('game-stats-dossier-pace.png'),
      fullPage: false,
    });

    const rhythm = window.getByText('PLAY RHYTHM', { exact: true });
    await rhythm.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(rhythm).toBeInViewport();
    await window.waitForTimeout(350);
    await window.screenshot({
      path: testInfo.outputPath('game-stats-dossier-rhythm.png'),
      fullPage: false,
    });
  });

  test('las múltiples partidas conservan su propio tablero', async ({ afterplay }) => {
    const { window } = afterplay;
    const gameId = await idOf(window, "Assassin's Creed II");
    await goTo(window, `/stats?game=${gameId}`);

    await expect(window.getByRole('heading', { name: "Assassin's Creed II" })).toBeVisible();
    await expect(window.locator('.afterplay-game-playthrough')).toHaveCount(2);
    await expect(window.getByText('How each playthrough stacks up')).toBeVisible();
  });

  test('Perfect games reutiliza la misma interacción que Completed', async () => {
    const games = DEFAULT_SEED.map((game) =>
      game.title === 'Strange Horticulture'
        ? { ...game, achievements: { total: 18, unlocked: 18 } }
        : game,
    );
    const launched = await launchAfterplay({ games });

    try {
      const { window } = launched;
      await goTo(window, '/stats');

      const perfectCard = window
        .locator('.afterplay-stat-card')
        .filter({ has: window.getByText('Perfect games', { exact: true }) });
      const perfect = perfectCard.locator('.afterplay-completed-button').first();
      await perfect.scrollIntoViewIfNeeded();
      await expect(perfect).toBeInViewport();
      await expect(perfect.locator('.afterplay-completed-cover')).toHaveCount(1);
      await expect(perfect.locator('.afterplay-completed-wash')).toHaveCount(1);
      await expect(perfect.locator('.afterplay-completed-mark')).toHaveCount(1);

      await perfect.hover();
      await expect
        .poll(() =>
          perfect.evaluate((element) => {
            const matrix = new DOMMatrix(getComputedStyle(element).transform);
            return { scaleX: matrix.a, scaleY: matrix.d, translateY: matrix.m42 };
          }),
        )
        .toEqual({ scaleX: 1, scaleY: 1, translateY: -2 });
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  });
});
