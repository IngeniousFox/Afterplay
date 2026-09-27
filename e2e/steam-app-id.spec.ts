import { expect, goTo, launchAfterplay, test } from './fixtures';

test('the Steam App ID editor works in Library and Plan to Play', async () => {
  const {
    app,
    window: page,
    sandbox,
  } = await launchAfterplay({
    games: [
      {
        title: 'E2E Wrong Steam match',
        steamAppId: 1000,
        achievements: { total: 2, unlocked: 1, source: 'emu' },
      },
      { title: 'E2E Planned Steam match', planned: true, steamAppId: 2000 },
    ],
  });
  try {
    const library = (await page.evaluate(() => globalThis.api.games.getAll()))[0];
    const planned = (await page.evaluate(() => globalThis.api.games.getPlanned()))[0];

    await goTo(page, `/games/${library.id}`);
    await page.getByRole('button', { name: 'Edit Steam App ID' }).click();
    await expect(page.getByRole('textbox', { name: 'STEAM APP ID' })).toHaveValue('1000');
    await page.getByRole('textbox', { name: 'STEAM APP ID' }).fill('3000');
    await page.getByRole('button', { name: 'Save App ID' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const libraryAfter = await page.evaluate(async (id) => {
      const [game, achievements] = await Promise.all([
        globalThis.api.games.getById(id),
        globalThis.api.achievements.getForGame(id),
      ]);
      return { game, achievements };
    }, library.id);
    expect(libraryAfter.game?.steamAppId).toBe(3000);
    expect(libraryAfter.game?.steamAppIdManual).toBe(true);
    expect(libraryAfter.achievements.entries).toHaveLength(0);

    await goTo(page, `/plan/${planned.id}`);
    await page.getByRole('button', { name: 'Edit Steam App ID' }).click();
    await page.getByRole('textbox', { name: 'STEAM APP ID' }).fill('4000');
    await page.getByRole('button', { name: 'Save App ID' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const planAfter = await page.evaluate((id) => globalThis.api.games.getById(id), planned.id);
    expect(planAfter?.steamAppId).toBe(4000);
    expect(planAfter?.steamAppIdManual).toBe(true);
  } finally {
    await app.close();
    sandbox.cleanup();
  }
});

test('normal Add Game offers a Steam App ID override with numeric validation', async () => {
  const { app, window: page, sandbox } = await launchAfterplay();
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('igdb:search');
      ipcMain.handle('igdb:search', () => [
        {
          igdbId: 987654,
          title: 'E2E Override Candidate',
          coverUrl: null,
          releaseYear: 2026,
          platforms: ['PC (Microsoft Windows)'],
          genres: [],
          summary: null,
        },
      ]);
      ipcMain.removeHandler('igdb:getById');
      ipcMain.handle('igdb:getById', () => null);
    });

    await page.getByRole('button', { name: 'Add game' }).first().click();
    await page.getByPlaceholder('Search a game… (e.g. Sekiro)').fill('Override Candidate');
    await page.getByRole('button', { name: /E2E Override Candidate/ }).click();
    const field = page.getByRole('textbox', { name: 'OVERRIDE STEAM APP ID' });
    await expect(field).toBeVisible();
    await field.fill('bad');
    await expect(page.getByRole('button', { name: 'Add to library' })).toBeDisabled();
    await field.fill('123456');
    await expect(page.getByRole('button', { name: 'Add to library' })).toBeEnabled();
  } finally {
    await app.close();
    sandbox.cleanup();
  }
});
