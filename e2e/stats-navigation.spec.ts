import { expect, test } from './fixtures';

test('statistics are prepared while the library is visible, before navigating', async ({
  afterplay,
}) => {
  const { window } = afterplay;
  const cdp = await window.context().newCDPSession(window);
  const parsed: string[] = [];
  cdp.on('Debugger.scriptParsed', ({ url }: { url: string }) => {
    if (/\/Stats-[^/]+\.js$/.test(url)) parsed.push(url);
  });
  // Enabling the debugger also reports modules already parsed before attachment.
  await cdp.send('Debugger.enable');
  await expect.poll(() => parsed.length).toBe(1);
  await expect(window.getByRole('link', { name: 'Games', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(window.locator('.afterplay-stats-screen')).toHaveCount(0);

  await window.getByRole('link', { name: 'Stats', exact: true }).click();
  await expect(window.locator('.afterplay-stats-hero')).toBeVisible();
  expect(parsed).toHaveLength(1);
  await cdp.detach();
});

test('the heatmap stays square and inside its card after navigation and resize', async ({
  afterplay,
}) => {
  const { app, window } = afterplay;
  await window.getByRole('link', { name: 'Stats', exact: true }).click();
  const cells = window.locator('.afterplay-heat-cell');
  await expect(cells.first()).toBeAttached();
  for (const width of [1060, 1400]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()
        .find((entry) => entry.webContents.getURL().includes('index.html'))!
        .setContentSize(size, 900);
    }, width);
    await expect
      .poll(() =>
        cells.evaluateAll((elements) => {
          const bounds = elements.map((element) => element.getBoundingClientRect());
          const grid = elements[0].parentElement!.getBoundingClientRect();
          return {
            populated: bounds.length >= 364,
            square: bounds.every((box) => Math.abs(box.width - box.height) <= 0.1),
            fits: bounds.every((box) => box.left >= grid.left - 1 && box.right <= grid.right + 1),
          };
        }),
      )
      .toEqual({ populated: true, square: true, fits: true });
  }
});
