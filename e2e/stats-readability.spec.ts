import { expect, goTo, launchAfterplay, test } from './fixtures';
import type { SeedGame } from './sandbox';

test('general statistics keep informational text readable at both desktop widths', async ({
  afterplay,
}, testInfo) => {
  const { app, window } = afterplay;
  await goTo(window, '/stats');
  await expect(window.locator('.afterplay-stats-record-card')).toHaveCount(4);
  for (const width of [1060, 1400]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()
        .find((entry) => entry.webContents.getURL().includes('index.html'))!
        .setContentSize(size, 920);
    }, width);
    await window.waitForFunction((size) => globalThis.innerWidth === size, width);
    const tiny = await window.locator('.afterplay-stats-screen').evaluate((screen) => {
      const walker = document.createTreeWalker(screen, NodeFilter.SHOW_TEXT);
      const problems: { text: string; size: number }[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (
          !parent ||
          !node.textContent?.trim() ||
          parent.closest('.afterplay-debt-card, .afterplay-age-card, [aria-hidden="true"]')
        )
          continue;
        if (!parent.getClientRects().length) continue;
        const scale = parent instanceof SVGGraphicsElement ? (parent.getScreenCTM()?.a ?? 1) : 1;
        const size = parseFloat(getComputedStyle(parent).fontSize) * Math.abs(scale);
        if (size < 10.95) problems.push({ text: node.textContent.trim(), size });
      }
      return problems;
    });
    expect(tiny).toEqual([]);
    const headings = window.locator('.afterplay-chart-heading-copy');
    const clipped = await headings.evaluateAll((elements) =>
      elements.flatMap((element) =>
        Array.from(element.children).flatMap((child) =>
          child.scrollWidth > child.clientWidth + 1 ? [child.textContent] : [],
        ),
      ),
    );
    expect(clipped, 'Chart titles and subtitles must fit after increasing the type').toEqual([]);
    const clippedMetadata = await window
      .locator(
        '.afterplay-streak-footer span, .afterplay-streak-footer strong, .afterplay-session-insights span, .afterplay-session-insights strong, .afterplay-session-axis > div',
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.textContent),
      );
    expect(clippedMetadata, 'Summary labels and duration ranges must stay complete').toEqual([]);
    for (const [name, selector] of [
      ['overview', '.afterplay-stats-hero'],
      ['streak', '.afterplay-streak-card'],
      ['genres', '.afterplay-genre-card'],
      ['session-length', '.afterplay-session-length-card'],
    ]) {
      const card = window.locator(selector);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({
        path: testInfo.outputPath(`${name}-${width}.png`),
        animations: 'disabled',
      });
    }
  }
});

const gameForShares = (minutes: number[]): SeedGame => ({
  title: 'Daypart ring sample',
  playthroughs: [
    {
      events: [{ type: 'started', at: new Date(2026, 6, 1), precision: 'day' }],
      sessions: minutes.flatMap((value, index) =>
        value > 0 ? [{ at: new Date(2026, 6, 2, [8, 14, 20, 2][index]), hours: value / 60 }] : [],
      ),
    },
  ],
});

test('the selected-game ring preserves tiny, full and empty shares without overlapping ends', async ({}, testInfo) => {
  for (const shares of [
    [2, 18, 43, 37],
    [100, 0, 0, 0],
    [0, 0, 0, 0],
  ]) {
    const launched = await launchAfterplay({ games: [gameForShares(shares)] });
    try {
      const { window } = launched;
      await window.emulateMedia({ reducedMotion: 'reduce' });
      const [game] = await window.evaluate(() => globalThis.api.games.getAll());
      await goTo(window, `/stats?game=${game.id}`);
      const card = window.locator('.afterplay-game-time-of-day');
      await expect(card).toBeVisible();
      const count = shares.filter((value) => value > 0).length;
      await expect(card.locator('.afterplay-game-daypart-arc')).toHaveCount(count);
      if (!count) {
        await expect(card).toContainText('No tracked sessions yet.');
        continue;
      }
      const geometry = await card.locator('.afterplay-game-daypart-arc').evaluateAll((elements) =>
        elements.map((element) => {
          const circle = element as SVGCircleElement;
          const style = getComputedStyle(circle);
          return {
            start: -parseFloat(style.strokeDashoffset),
            length: parseFloat(style.strokeDasharray),
            total: 2 * Math.PI * circle.r.baseVal.value,
            cap: style.strokeLinecap,
          };
        }),
      );
      for (const [index, arc] of geometry.entries()) {
        expect(arc.cap).toBe('butt');
        expect(arc.length).toBeGreaterThan(0);
        const next = geometry[(index + 1) % geometry.length];
        const nextStart = next.start + (index === geometry.length - 1 ? arc.total : 0);
        expect(arc.start + arc.length).toBeLessThanOrEqual(nextStart + 0.001);
      }
      if (count === 1) expect(geometry[0].length).toBeCloseTo(geometry[0].total, 3);
      else {
        expect(geometry[0].length).toBeLessThanOrEqual(geometry[0].total * 0.02);
        await card.locator('.afterplay-game-daypart').first().focus();
        await expect(card.locator('.afterplay-game-daypart-center strong')).toHaveText('2%');
        await card.locator('.afterplay-game-daypart').nth(2).focus();
        await card.screenshot({
          path: testInfo.outputPath('time-of-day-matched.png'),
          animations: 'disabled',
        });
      }
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  }
});
