import type { Locator, Page } from '@playwright/test';
import { expect, goTo, launchAfterplay, test } from './fixtures';
import type { SeedGame } from './sandbox';

const NOW = new Date('2026-09-05T12:00:00.000Z');
const STARTED = new Date('2026-01-10T12:00:00.000Z');

// Four dated eras total exactly 100 hours. The smallest reproduces the 2% sector
// that used to disappear underneath its neighbours' round line caps.
const ageGames: SeedGame[] = [
  { title: 'New era sample', releaseYear: 2026, hours: 2 },
  { title: 'Recent era sample', releaseYear: 2023, hours: 18 },
  { title: 'Modern era sample', releaseYear: 2018, hours: 37 },
  { title: 'Classic era sample', releaseYear: 2000, hours: 43 },
].map(({ title, releaseYear, hours }, index) => ({
  title,
  releaseYear,
  playthroughs: [
    {
      manualHours: hours - (index === 3 ? 2 : 0),
      events: [{ type: 'started', at: STARTED, precision: 'day' }],
      sessions: index === 3 ? [{ at: new Date('2026-08-22T12:00:00.000Z'), hours: 2 }] : undefined,
    },
  ],
}));

const distributionAndDebt: SeedGame[] = [
  ...ageGames,
  {
    title: 'Undated playtime sample',
    releaseYear: null,
    playthroughs: [
      { manualHours: 7, events: [{ type: 'started', at: STARTED, precision: 'day' }] },
    ],
  },
  { title: 'Untouched sample one', hltb: { main: 7 } },
  { title: 'Untouched sample two', hltb: { main: 6 } },
  { title: 'Large planned estimate one', planned: true, hltb: { main: 3_300 } },
  { title: 'Large planned estimate two', planned: true, hltb: { main: 4_064 } },
  { title: 'Planned without estimate', planned: true },
];

const prepareStats = async (page: Page): Promise<void> => {
  // Fixed Date with ordinary timers keeps the age buckets and forecast stable.
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await goTo(page, '/stats');
  await expect(page.locator('.afterplay-age-card')).toBeVisible();
};

const expectMinimumType = async (
  scope: Locator,
  selector: string,
  minimum: number,
): Promise<void> => {
  const sizes = await scope.locator(selector).evaluateAll((elements) =>
    elements.map((element) => ({
      text: element.textContent?.trim(),
      size: Number.parseFloat(getComputedStyle(element).fontSize),
    })),
  );
  expect(sizes.length, `Missing typography targets: ${selector}`).toBeGreaterThan(0);
  for (const sample of sizes) {
    expect(sample.size, `${sample.text}: at least ${minimum}px`).toBeGreaterThanOrEqual(minimum);
  }
};

const expectUnclippedText = async (card: Locator, selector: string): Promise<void> => {
  const problems = await card.evaluate((element, textSelector) => {
    const failures: string[] = [];
    const cardBox = element.getBoundingClientRect();
    if (cardBox.left < -1 || cardBox.right > globalThis.innerWidth + 1) {
      failures.push('card extends beyond the viewport');
    }
    for (const text of Array.from(element.querySelectorAll(textSelector))) {
      // Ranges measure the glyphs even when text-overflow would hide their end.
      const range = document.createRange();
      range.selectNodeContents(text);
      const rectangles = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
      for (let parent: Element | null = text; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!['hidden', 'clip'].includes(style.overflowX)) continue;
        const bounds = parent.getBoundingClientRect();
        if (
          rectangles.some((rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
        ) {
          failures.push(`clipped: ${text.textContent?.trim()}`);
          break;
        }
      }
    }
    return failures;
  }, selector);
  expect(problems).toEqual([]);
};

type ArcGeometry = {
  key: string;
  start: number;
  length: number;
  circumference: number;
  capExtension: number;
};

const readArcs = (card: Locator): Promise<ArcGeometry[]> =>
  card.locator('[data-age-slice]').evaluateAll((elements) =>
    elements.map((element) => {
      const circle = element as SVGCircleElement;
      const radius = circle.r.baseVal.value;
      const circumference = 2 * Math.PI * radius;
      const style = getComputedStyle(circle);
      const start = -Number.parseFloat(style.strokeDashoffset);
      const width = Number.parseFloat(style.strokeWidth);
      // A round end occupies space beyond its dash. Count that space so the
      // regression fails even if the strokeDasharray itself looks separated.
      const capExtension =
        style.strokeLinecap === 'butt' ? 0 : Math.asin(Math.min(1, width / (2 * radius))) * radius;
      return {
        key: circle.dataset.ageSlice ?? '',
        start: ((start % circumference) + circumference) % circumference,
        length: Number.parseFloat(style.strokeDasharray),
        circumference,
        capExtension,
      };
    }),
  );

const expectSeparateSectors = (arcs: ArcGeometry[]): void => {
  const ordered = [...arcs].sort((a, b) => a.start - b.start);
  for (const [index, current] of ordered.entries()) {
    const next = ordered[(index + 1) % ordered.length];
    const nextStart = next.start + (index === ordered.length - 1 ? current.circumference : 0);
    const clearGap =
      nextStart - next.capExtension - (current.start + current.length + current.capExtension);
    expect(clearGap, `${current.key} overlaps ${next.key}`).toBeGreaterThanOrEqual(-0.001);
  }
};

test.describe('Backlog debt and game age readability', () => {
  test('small text stays readable and fits at desktop widths', async ({}, testInfo) => {
    const launched = await launchAfterplay({ games: distributionAndDebt });
    try {
      const { app, window } = launched;
      await prepareStats(window);
      const debt = window.locator('.afterplay-debt-card');
      const age = window.locator('.afterplay-age-card');
      await expect(debt.locator('[data-debt-hours]')).toHaveText('7,377');
      await expect(debt.locator('.afterplay-debt-horizon-labels')).toBeAttached();

      for (const width of [1_060, 1_400]) {
        await app.evaluate(({ BrowserWindow }, size) => {
          const target = BrowserWindow.getAllWindows().find((entry) =>
            entry.webContents.getURL().includes('index.html'),
          )!;
          target.setContentSize(size, 920);
        }, width);
        await window.waitForFunction((size) => globalThis.innerWidth === size, width);
        await debt.scrollIntoViewIfNeeded();
        await expectMinimumType(
          debt,
          '.afterplay-debt-mode, .afterplay-debt-kicker, .afterplay-debt-forecast-head > div > span, .afterplay-debt-horizon-labels small',
          10,
        );
        await expectMinimumType(
          debt,
          '.afterplay-debt-coverage > span, .afterplay-debt-horizon-labels > span, .afterplay-debt-source > small',
          11,
        );
        await expectMinimumType(
          debt,
          '.afterplay-debt-header > div:first-child > div > div:last-child',
          11.5,
        );
        await expectUnclippedText(
          debt,
          '.afterplay-debt-kicker, .afterplay-debt-total, .afterplay-debt-human, .afterplay-debt-coverage > span, .afterplay-debt-forecast-head > div > span, .afterplay-debt-forecast-head strong, .afterplay-debt-horizon-labels > span, .afterplay-debt-source > span, .afterplay-debt-source > small',
        );
        await debt.screenshot({
          path: testInfo.outputPath(`debt-readable-${width}.png`),
          animations: 'disabled',
        });

        await age.scrollIntoViewIfNeeded();
        await expectMinimumType(
          age,
          '.afterplay-age-total > span, .afterplay-age-core > span, .afterplay-age-core > small, .afterplay-age-focus > div > span',
          10,
        );
        await expectMinimumType(
          age,
          '.afterplay-age-total > small, .afterplay-age-era-copy > small, .afterplay-age-focus p, .afterplay-age-unknown',
          11,
        );
        await expectMinimumType(
          age,
          '.afterplay-age-header > div:first-child > div:last-child',
          11.5,
        );
        await expectUnclippedText(
          age,
          '.afterplay-age-total > *, .afterplay-age-core > *, .afterplay-age-focus p, .afterplay-age-focus strong, .afterplay-age-era-copy > *, .afterplay-age-unknown',
        );
        await age.screenshot({
          path: testInfo.outputPath(`age-readable-${width}.png`),
          animations: 'disabled',
        });
      }
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  });

  test('the 2% sector remains visible and separate when focused', async ({}, testInfo) => {
    const launched = await launchAfterplay({ games: distributionAndDebt });
    try {
      const { window } = launched;
      await prepareStats(window);
      const age = window.locator('.afterplay-age-card');
      await age.scrollIntoViewIfNeeded();
      await expect(age.locator('[data-age-slice]')).toHaveCount(4);
      expectSeparateSectors(await readArcs(age));

      const newEra = age.getByRole('button', { name: /New releases/ });
      await newEra.focus();
      await expect(newEra).toHaveAttribute('aria-pressed', 'true');
      await expect(age.locator('.afterplay-age-core > strong')).toHaveText('2%');
      const arcs = await readArcs(age);
      expectSeparateSectors(arcs);
      const smallest = arcs.find((arc) => arc.key === 'new')!;
      expect(smallest.length).toBeGreaterThan(smallest.circumference * 0.01);
      expect(smallest.length).toBeLessThanOrEqual(smallest.circumference * 0.02);
      await age.screenshot({
        path: testInfo.outputPath('age-small-sector-focused.png'),
        animations: 'disabled',
      });
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  });

  test('one era fills the ring and an empty archive has no artificial sectors', async () => {
    for (const games of [[ageGames[0]], []]) {
      const launched = await launchAfterplay({ games });
      try {
        const { window } = launched;
        await prepareStats(window);
        const age = window.locator('.afterplay-age-card');
        await age.scrollIntoViewIfNeeded();
        if (games.length === 0) {
          await expect(age.getByText('Nothing tracked yet.', { exact: true })).toBeVisible();
          await expect(age.locator('[data-age-slice]')).toHaveCount(0);
          await expect(age.locator('.afterplay-age-total')).toHaveCount(0);
          await expect(window.locator('.afterplay-debt-card')).toContainText(
            'Nothing waiting for you.',
          );
        } else {
          await expect(age.locator('[data-age-slice]')).toHaveCount(1);
          await expect(age.locator('.afterplay-age-core > strong')).toHaveText('100%');
          const [arc] = await readArcs(age);
          expect(arc.length).toBeCloseTo(arc.circumference, 3);
          expect(arc.start).toBeCloseTo(0, 3);
        }
      } finally {
        await launched.app.close().catch(() => {});
        launched.sandbox.cleanup();
      }
    }
  });
});
