import { expect, goTo, launchAfterplay, test } from './fixtures';
import { DEFAULT_SEED } from './seed';

test('Almost there labels fit completely inside the dark center of each ring', async ({}, testInfo) => {
  const games = DEFAULT_SEED.map((game) =>
    game.achievements
      ? { ...game, achievements: { ...game.achievements, unlocked: game.achievements.total - 1 } }
      : game,
  );
  const launched = await launchAfterplay({ games });
  try {
    const { app, window } = launched;
    await goTo(window, '/stats');
    const gauges = window.locator('.afterplay-almost-gauge');
    await expect(gauges.first()).toBeAttached();
    for (const width of [1060, 1400]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()
          .find((entry) => entry.webContents.getURL().includes('index.html'))!
          .setContentSize(size, 920);
      }, width);
      await window.waitForFunction((size) => globalThis.innerWidth === size, width);
      const overflow = await gauges.evaluateAll((elements) =>
        elements.flatMap((gauge, index) => {
          const center = gauge.firstElementChild!;
          const disc = center.getBoundingClientRect();
          const cx = disc.left + disc.width / 2;
          const cy = disc.top + disc.height / 2;
          const radius = disc.width / 2 - 1;
          return Array.from(center.children).flatMap((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            const box = range.getBoundingClientRect();
            const fits = [box.left, box.right].every((x) =>
              [box.top, box.bottom].every((y) => Math.hypot(x - cx, y - cy) <= radius),
            );
            return fits ? [] : [`ring ${index}: ${label.textContent}`];
          });
        }),
      );
      expect(overflow).toEqual([]);
      const section = window.locator('.afterplay-almost-section');
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({
        path: testInfo.outputPath(`almost-there-${width}.png`),
        animations: 'disabled',
      });
    }
  } finally {
    await launched.app.close().catch(() => {});
    launched.sandbox.cleanup();
  }
});

test('year-filtered achievement panels share their top and bottom edges', async ({
  afterplay,
}, testInfo) => {
  const { app, window } = afterplay;
  await goTo(window, '/stats');
  await window.getByRole('button', { name: 'All Time', exact: true }).click();
  await window.getByRole('button', { name: '2026', exact: true }).click();
  const pair = window.getByTestId('achievement-year-panels');
  await expect(pair).toBeAttached();
  for (const width of [1060, 1400]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()
        .find((entry) => entry.webContents.getURL().includes('index.html'))!
        .setContentSize(size, 920);
    }, width);
    await window.waitForFunction((size) => globalThis.innerWidth === size, width);
    const edges = await pair.evaluate((element) => {
      const months = element
        .querySelector('[data-testid="achievement-month-card"]')!
        .getBoundingClientRect();
      const games = element
        .querySelector('[data-testid="achievement-games-card"]')!
        .getBoundingClientRect();
      return {
        top: Math.abs(months.top - games.top),
        bottom: Math.abs(months.bottom - games.bottom),
        height: months.height,
        listHeight: games.height,
      };
    });
    expect(edges.top).toBeLessThan(1);
    expect(edges.bottom).toBeLessThan(1);
    expect(edges.height).toBeGreaterThan(200);
    expect(edges.listHeight).toBeLessThanOrEqual(360);
    await pair.scrollIntoViewIfNeeded();
    await pair.screenshot({
      path: testInfo.outputPath(`year-panels-${width}.png`),
      animations: 'disabled',
    });
  }
});
