import type { Page } from '@playwright/test';
import { expect, goTo, launchAfterplay, test } from './fixtures';
import type { SeedGame } from './sandbox';
import { landingError } from './scroll';

// A cold archive with deliberately different month heights. The short default
// seed cannot expose repeated corrections across dozens of unpainted months.
const archive: SeedGame[] = [];
for (let year = 2016; year <= 2025; year++) {
  for (const [month, count] of [
    [0, 1],
    [2, 3],
    [4, 12],
    [6, 2],
    [8, 8],
  ]) {
    for (let index = 0; index < count; index++) {
      archive.push({
        title: `Journey ${year}-${month + 1} game ${index + 1}`,
        playthroughs: [
          {
            manualHours: index + 1,
            events: [{ type: 'completed', at: new Date(year, month, 12), precision: 'day' }],
          },
        ],
      });
    }
  }
}

type Trace = {
  calls: { at: number; behavior: string; distance: number }[];
  frames: { at: number; scroll: number; targetTop: number; height: number }[];
};

const startTrace = async (page: Page, selector: string): Promise<void> => {
  await page.evaluate((targetSelector) => {
    const scroller = document.querySelector<HTMLElement>('.afterplay-stats-screen')!;
    const target = document.querySelector<HTMLElement>(targetSelector)!;
    const trace: Trace & { stop: () => void } = { calls: [], frames: [], stop: () => {} };
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      if (this === target) {
        const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
        const padding = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
        const desired =
          scroller.scrollTop +
          target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          scroller.clientTop -
          margin -
          padding;
        const clamped = Math.max(
          0,
          Math.min(scroller.scrollHeight - scroller.clientHeight, desired),
        );
        trace.calls.push({
          at: performance.now(),
          behavior: typeof options === 'object' ? (options.behavior ?? 'auto') : 'auto',
          distance: clamped - scroller.scrollTop,
        });
      }
      return original.call(this, options);
    };
    let frame = 0;
    const sample = (): void => {
      trace.frames.push({
        at: performance.now(),
        scroll: scroller.scrollTop,
        targetTop: target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        height: scroller.scrollHeight,
      });
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    trace.stop = () => {
      cancelAnimationFrame(frame);
      Element.prototype.scrollIntoView = original;
    };
    Object.assign(globalThis, { journeyScrollTrace: trace });
  }, selector);
};

const stopTrace = (page: Page): Promise<Trace> =>
  page.evaluate(() => {
    const trace = (globalThis as unknown as { journeyScrollTrace: Trace & { stop: () => void } })
      .journeyScrollTrace;
    trace.stop();
    return { calls: trace.calls, frames: trace.frames };
  });

const openJourney = async (page: Page): Promise<void> => {
  await goTo(page, '/stats');
  await page.getByRole('button', { name: 'Journey', exact: true }).click();
  await expect(page.locator('[data-month-key]')).toHaveCount(50);
};

const expectVirtualizationRestored = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page
        .locator('[data-month-key]')
        .evaluateAll((months) =>
          months.every((month) => getComputedStyle(month).contentVisibility === 'auto'),
        ),
    )
    .toBe(true);
};

test('long cold year navigation travels once and lands without later corrections', async ({}, testInfo) => {
  const { app, window: page, sandbox } = await launchAfterplay({ games: archive });
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openJourney(page);
    const nav = page.getByRole('navigation', { name: 'Journey date navigation' });
    await expect(nav.getByRole('button', { name: '2017', exact: true })).toBeVisible();
    await expect(page.locator('[data-month-key]')).toHaveCount(50);
    await startTrace(page, '[data-year="2017"]');
    await nav.getByRole('button', { name: '2017', exact: true }).click();
    // This fixed observation window is intentional: capture the whole motion
    // and any late restarts, not merely the optimistically highlighted label.
    await page.waitForTimeout(6_000);
    const trace = await stopTrace(page);
    await testInfo.attach('journey-scroll-trace', {
      body: JSON.stringify(trace),
      contentType: 'application/json',
    });
    const smoothStarts = trace.calls.filter((call) => call.behavior === 'smooth').length;
    const last = trace.frames.at(-1)!;
    console.log(
      JSON.stringify({ smoothStarts, start: trace.frames[0], end: last, calls: trace.calls }),
    );
    expect(
      smoothStarts,
      'a distant click must not repeatedly brake and launch another animation',
    ).toBe(1);
    const movingFrames = trace.frames.filter((frame) => frame.at >= trace.calls[0].at);
    expect(
      movingFrames.every(
        (frame, index) => index === 0 || frame.scroll >= movingFrames[index - 1].scroll - 2,
      ),
      'the downward trip must not reverse as months materialize',
    ).toBe(true);
    expect(
      await landingError(page, '[data-year="2017"]'),
      'the actual year heading must reach its scroll margin',
    ).toBeLessThanOrEqual(2);
    expect(
      trace.calls
        .filter((call) => call.behavior === 'instant')
        .every((call) => Math.abs(call.distance) <= 2),
      'restoring lazy layout must not replace the second animation with a visible snap',
    ).toBe(true);
    await expectVirtualizationRestored(page);

    // Month links use the same navigation and must handle a destination near
    // the bottom which physically cannot reach the top of the scroller.
    await nav.getByRole('button', { name: '2016', exact: true }).click();
    await expect.poll(() => landingError(page, '[data-year="2016"]')).toBeLessThanOrEqual(2);
    await nav.getByRole('button', { name: /^Jan/ }).click();
    await expect.poll(() => landingError(page, '[data-month-key="2016-0"]')).toBeLessThanOrEqual(2);
    await expectVirtualizationRestored(page);
    const tail = trace.frames.filter((frame) => frame.at > last.at - 500);
    expect(
      Math.max(...tail.map((frame) => frame.targetTop)) -
        Math.min(...tail.map((frame) => frame.targetTop)),
    ).toBeLessThanOrEqual(2);
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

test('a cold upward trip remains aligned after releasing month layout', async ({}, testInfo) => {
  const { app, window: page, sandbox } = await launchAfterplay({ games: archive });
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openJourney(page);
    // Dragging a scrollbar straight to the end leaves the middle unpainted.
    await page.locator('.afterplay-stats-screen').evaluate((scroller) => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(300);
    await startTrace(page, '[data-year="2024"]');
    const nav = page.getByRole('navigation', { name: 'Journey date navigation' });
    await nav.getByRole('button', { name: '2024', exact: true }).click();
    await page.waitForTimeout(5_500);
    const trace = await stopTrace(page);
    await testInfo.attach('upward-scroll-trace', {
      body: JSON.stringify(trace),
      contentType: 'application/json',
    });
    expect(trace.calls.filter((call) => call.behavior === 'smooth').length).toBe(1);
    const movingFrames = trace.frames.filter((frame) => frame.at >= trace.calls[0].at);
    expect(
      movingFrames.every(
        (frame, index) => index === 0 || frame.scroll <= movingFrames[index - 1].scroll + 2,
      ),
      'the upward trip must not reverse when placeholder heights change',
    ).toBe(true);
    expect(trace.frames.at(-1)!.scroll).toBeLessThan(trace.frames[0].scroll - 10_000);
    expect(await landingError(page, '[data-year="2024"]')).toBeLessThanOrEqual(2);
    expect(
      trace.calls
        .filter((call) => call.behavior === 'instant')
        .every((call) => Math.abs(call.distance) <= 2),
    ).toBe(true);
    const last = trace.frames.at(-1)!;
    const tail = trace.frames.filter((frame) => frame.at > last.at - 500);
    expect(
      Math.max(...tail.map((frame) => frame.targetTop)) -
        Math.min(...tail.map((frame) => frame.targetTop)),
    ).toBeLessThanOrEqual(2);
    await expectVirtualizationRestored(page);
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

test('a new date replaces the trip and a wheel gesture takes control immediately', async ({}) => {
  const { app, window: page, sandbox } = await launchAfterplay({ games: archive });
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openJourney(page);
    const scroller = page.locator('.afterplay-stats-screen');
    const nav = page.getByRole('navigation', { name: 'Journey date navigation' });
    await nav.getByRole('button', { name: '2017', exact: true }).click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    expect(await landingError(page, '[data-year="2017"]')).toBeGreaterThan(100);
    await nav.getByRole('button', { name: '2022', exact: true }).click();
    await expect.poll(() => landingError(page, '[data-year="2022"]')).toBeLessThanOrEqual(2);
    await page.waitForTimeout(400);
    expect(await landingError(page, '[data-year="2022"]')).toBeLessThanOrEqual(2);
    await expectVirtualizationRestored(page);

    await nav.getByRole('button', { name: '2016', exact: true }).click();
    await page.waitForTimeout(180);
    expect(await landingError(page, '[data-year="2016"]')).toBeGreaterThan(100);
    const box = await scroller.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(300);
    const stoppedAt = await scroller.evaluate((element) => element.scrollTop);
    await page.waitForTimeout(5_200);
    expect(
      Math.abs((await scroller.evaluate((element) => element.scrollTop)) - stoppedAt),
    ).toBeLessThanOrEqual(2);
    expect(await landingError(page, '[data-year="2016"]')).toBeGreaterThan(100);
    await expectVirtualizationRestored(page);
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

test('reduced motion and dated Journey URLs land without smooth animation', async ({}) => {
  const { app, window: page, sandbox } = await launchAfterplay({ games: archive });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openJourney(page);
    await startTrace(page, '[data-year="2017"]');
    await page
      .getByRole('navigation', { name: 'Journey date navigation' })
      .getByRole('button', { name: '2017', exact: true })
      .click();
    await expect
      .poll(() => landingError(page, '[data-year="2017"]'), { timeout: 1_000 })
      .toBeLessThanOrEqual(2);
    await page.waitForTimeout(300);
    const trace = await stopTrace(page);
    expect(trace.calls.some((call) => call.behavior === 'smooth')).toBe(false);
    await expectVirtualizationRestored(page);

    await page.evaluate(() => {
      location.hash = '#/stats?view=journey&month=2023-05';
    });
    await expect.poll(() => landingError(page, '[data-month-key="2023-4"]')).toBeLessThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/stats');
    await expectVirtualizationRestored(page);
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});

test('a cold dated link lands correctly and resize or leaving the route releases navigation', async ({}) => {
  const { app, window: page, sandbox } = await launchAfterplay({ games: archive });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      location.hash = '#/stats?view=journey&month=2021-05';
    });
    await expect(page.locator('[data-month-key]')).toHaveCount(50);
    await expect.poll(() => landingError(page, '[data-month-key="2021-4"]')).toBeLessThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/stats');
    await expectVirtualizationRestored(page);

    const nav = page.getByRole('navigation', { name: 'Journey date navigation' });
    // Keyboard activation must share the same navigation and cancellation.
    await nav.getByRole('button', { name: '2017', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(180);
    expect(await landingError(page, '[data-year="2017"]')).toBeGreaterThan(100);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((candidate) => candidate.webContents.getURL().includes('index.html'))!
        .setContentSize(1060, 900);
    });
    await expectVirtualizationRestored(page);
    await expect
      .poll(() =>
        page
          .locator('.afterplay-stats-screen')
          .evaluate((element) => (element as HTMLElement).style.overflowAnchor),
      )
      .toBe('');

    await nav.getByRole('button', { name: '2016', exact: true }).click();
    await page.waitForTimeout(100);
    await goTo(page, '/games');
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await page.waitForTimeout(5_200);
    expect(errors).toEqual([]);
    await openJourney(page);
    await expectVirtualizationRestored(page);
  } finally {
    await app.close().catch(() => {});
    sandbox.cleanup();
  }
});
