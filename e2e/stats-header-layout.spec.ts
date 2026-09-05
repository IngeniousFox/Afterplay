import { expect, goTo, launchAfterplay, test } from './fixtures';
import type { Page } from '@playwright/test';

const expectJoinedChrome = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('app-titlebar')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const title = document
          .querySelector('[data-testid="app-titlebar"]')!
          .getBoundingClientRect();
        const shell = document.querySelector('[data-testid="desktop-layout"]')!;
        return Array.from(shell.children).map(
          (column) => Math.round((column.getBoundingClientRect().top - title.bottom) * 100) / 100,
        );
      }),
    )
    .toEqual([0, 0, 0]);
};

test('sidebar dividers meet the title bar on each desktop view and after fullscreen', async ({
  afterplay,
}, testInfo) => {
  const { window } = afterplay;
  for (const route of ['/games', '/plan', '/sessions', '/stats'] as const) {
    await goTo(window, route);
    await expectJoinedChrome(window);
  }
  await window.evaluate(() => globalThis.api.window.bigPicture.enter());
  await expect(window.getByText('YOUR LIBRARY')).toBeVisible();
  await expect(window.getByTestId('app-titlebar')).toHaveCount(0);
  await expect
    .poll(() =>
      window.evaluate(() => getComputedStyle(document.getElementById('root')!).paddingTop),
    )
    .toBe('0px');
  await window.evaluate(() => globalThis.api.window.bigPicture.exit());
  await expect(window.getByTestId('desktop-layout')).toBeVisible();
  await expectJoinedChrome(window);
  await window.screenshot({
    path: testInfo.outputPath('joined-titlebar.png'),
    animations: 'disabled',
  });
});

test('year comparisons sit under their matching totals, before archive records', async ({}, testInfo) => {
  const launched = await launchAfterplay({
    games: [
      {
        title: 'Across two years',
        playthroughs: [
          {
            sessions: [
              { at: new Date(2025, 4, 1, 12), hours: 2 },
              { at: new Date(2026, 4, 1, 12), hours: 4 },
            ],
          },
        ],
      },
      {
        title: 'This year only',
        playthroughs: [{ sessions: [{ at: new Date(2026, 5, 1, 12), hours: 3 }] }],
      },
    ],
  });
  try {
    const { app, window } = launched;
    await goTo(window, '/stats');
    await expect(window.locator('.afterplay-stats-hero')).toBeVisible();
    await expect(window.locator('[data-year-comparison]')).toHaveCount(0);
    await window.getByRole('button', { name: 'All Time', exact: true }).click();
    await window.getByRole('button', { name: '2026', exact: true }).click();
    await expect(window.locator('[data-year-comparison]')).toHaveCount(4);
    await expect(window.locator('[data-year-comparison="totalGames"]')).toContainText(
      '1 more than 2025',
    );
    await expect(window.locator('[data-year-comparison="totalHours"]')).toContainText(
      '5h more than 2025',
    );
    await expect(
      window.locator('.afterplay-stats-metric').nth(1).locator(':scope > div').nth(1),
    ).toHaveText('7h');
    for (const width of [1060, 1400]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()
          .find((entry) => entry.webContents.getURL().includes('index.html'))!
          .setContentSize(size, 920);
      }, width);
      await window.waitForFunction((size) => globalThis.innerWidth === size, width);
      const problems = await window.locator('[data-year-comparison]').evaluateAll((elements) => {
        const labels: Record<string, string> = {
          totalGames: 'GAMES PLAYED',
          totalHours: 'TOTAL PLAYTIME',
          totalSpent: 'SPENT IN 2026',
          costPerHour: 'AVG COST / HOUR',
        };
        const recordsTop = document
          .querySelector('.afterplay-stats-record-deck')!
          .getBoundingClientRect().top;
        return elements.flatMap((comparison) => {
          const metric = comparison.closest('.afterplay-stats-metric');
          const key = (comparison as HTMLElement).dataset.yearComparison!;
          const text = comparison.querySelector('span')!;
          const box = comparison.getBoundingClientRect();
          return !metric?.textContent?.includes(labels[key]) ||
            box.bottom > recordsTop ||
            text.scrollWidth > text.clientWidth + 1
            ? [key]
            : [];
        });
      });
      expect(problems).toEqual([]);
      await window.screenshot({
        path: testInfo.outputPath(`year-comparisons-${width}.png`),
        animations: 'disabled',
      });
    }
    await window.getByRole('button', { name: '2026', exact: true }).click();
    await window.getByRole('button', { name: '2025', exact: true }).click();
    await expect(window.locator('[data-year-comparison]')).toHaveCount(0);
  } finally {
    await launched.app.close().catch(() => {});
    launched.sandbox.cleanup();
  }
});

test('game totals stay below the hero and align with its sides', async ({
  afterplay,
}, testInfo) => {
  const { app, window } = afterplay;
  const games = await window.evaluate(() => globalThis.api.games.getAll());
  const game = games.find((entry) => entry.title === '007 First Light')!;
  await goTo(window, `/stats?game=${game.id}`);
  await expect(window.getByTestId('game-stats-hero')).toBeVisible();
  for (const width of [1060, 1400]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()
        .find((entry) => entry.webContents.getURL().includes('index.html'))!
        .setContentSize(size, 920);
    }, width);
    await window.waitForFunction((size) => globalThis.innerWidth === size, width);
    // Finish the finite entrance animation before measuring the final layout.
    await window
      .getByTestId('game-stats-hero')
      .screenshot({ path: testInfo.outputPath(`game-hero-${width}.png`), animations: 'disabled' });
    const geometry = await window.locator('.afterplay-game-metrics').evaluate((metrics) => {
      const hero = document
        .querySelector('[data-testid="game-stats-hero"]')!
        .getBoundingClientRect();
      const box = metrics.getBoundingClientRect();
      return {
        gap: box.top - hero.bottom,
        left: Math.abs(box.left - hero.left),
        right: Math.abs(box.right - hero.right),
      };
    });
    expect(geometry.gap).toBeGreaterThanOrEqual(15);
    expect(geometry.left).toBeLessThan(1);
    expect(geometry.right).toBeLessThan(1);
    await window.screenshot({
      path: testInfo.outputPath(`game-metrics-separated-${width}.png`),
      animations: 'disabled',
    });
  }
});
