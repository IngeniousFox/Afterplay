import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, goTo, test } from './fixtures';

const gameId = async (page: Page, title: string, planned = false): Promise<number> => {
  const games = await page.evaluate(
    (plan) => (plan ? globalThis.api.games.getPlanned() : globalThis.api.games.getAll()),
    planned,
  );
  const game = games.find((candidate) => candidate.title === title);
  if (!game) throw new Error(`Missing seeded game: ${title}`);
  return game.id;
};

const loadedScripts = async (page: Page): Promise<string[]> => {
  // Chromium omits file:// scripts from ResourceTiming. Enabling the debugger
  // reports already-parsed scripts as well as new ones, including lazy chunks.
  const session = await page.context().newCDPSession(page);
  const scripts: string[] = [];
  session.on('Debugger.scriptParsed', ({ url }: { url: string }) => {
    if (url.startsWith('file:') && url.endsWith('.js')) {
      scripts.push(new URL(url).pathname.split('/').at(-1) ?? '');
    }
  });
  try {
    await session.send('Debugger.enable');
    return scripts;
  } finally {
    await session.detach();
  }
};

const markdownScript = (): string => {
  // Vite names react-markdown's chunk index-<hash>, just like the main entry.
  // Read the actual dynamic import from its small wrapper instead of guessing
  // which index chunk is the parser or hard-coding a build-specific hash.
  const assets = join(process.cwd(), 'out', 'renderer', 'assets');
  const wrapper = readdirSync(assets).find((name) => /^NotesMarkdown-.*\.js$/.test(name));
  if (!wrapper) throw new Error('Build the renderer before running the notes loading test.');
  const parser = readFileSync(join(assets, wrapper), 'utf8').match(
    /import\("\.\/([^"/]+\.js)"\)/,
  )?.[1];
  if (!parser) throw new Error('The notes reader has no separate parser chunk.');
  return parser;
};

const savedNotes = (page: Page, id: number): Promise<string | null | undefined> =>
  page.evaluate((target) => globalThis.api.games.getById(target).then((game) => game?.notes), id);

test.describe('notes and deferred renderer content', () => {
  test('startup skips editors, settings controls and secondary routes until needed', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    const initialScripts = await loadedScripts(page);
    const markdownChunk = markdownScript();
    expect(initialScripts.some((name) => name.startsWith('Afterplay-'))).toBe(true);
    expect(initialScripts).not.toContain(markdownChunk);
    expect(
      initialScripts.filter((name) =>
        /^(RichNotesEditor|SettingsContent|GameDetailRoute|PlanGameDetailRoute|PlanToPlay|Sessions)-/.test(
          name,
        ),
      ),
    ).toEqual([]);

    const id = await gameId(page, 'Alan Wake');
    await goTo(page, `/games/${id}`);
    await expect(page.getByRole('heading', { name: 'Alan Wake', exact: true })).toBeVisible();
    expect((await loadedScripts(page)).some((name) => name.startsWith('GameDetailRoute-'))).toBe(
      true,
    );
    expect((await loadedScripts(page)).some((name) => name.startsWith('RichNotesEditor-'))).toBe(
      false,
    );

    await page
      .getByRole('button', { name: 'Add notes about this game — markdown supported.' })
      .click();
    await expect(page.getByRole('textbox', { name: 'Game notes' })).toBeVisible();
    expect((await loadedScripts(page)).some((name) => name.startsWith('RichNotesEditor-'))).toBe(
      true,
    );
    await page.getByRole('textbox', { name: 'Game notes' }).fill('The deferred reader is ready.');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('The deferred reader is ready.', { exact: true })).toBeVisible();
    expect(await loadedScripts(page)).toContain(markdownChunk);

    expect((await loadedScripts(page)).some((name) => name.startsWith('SettingsContent-'))).toBe(
      false,
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog');
    await expect(settings.getByText('Time format', { exact: true })).toBeVisible();
    expect((await loadedScripts(page)).some((name) => name.startsWith('SettingsContent-'))).toBe(
      true,
    );
    await settings.getByRole('button', { name: 'Connections', exact: true }).click();
    await expect(settings.getByRole('button', { name: /^Anthropic\b/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(settings.getByRole('button', { name: /^Anthropic\b/ })).toBeVisible();
  });

  test('dedicated notes preserve Markdown, cancel drafts, survive navigation and can be cleared', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;
    const id = await gameId(page, 'Alan Wake');
    const original = '## Where I stopped\n\nA **bright** torch.';
    await page.evaluate(({ target, notes }) => globalThis.api.games.update(target, { notes }), {
      target: id,
      notes: original,
    });
    await goTo(page, `/games/${id}`);
    await expect(page.getByRole('heading', { name: 'Where I stopped', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit notes', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'Game notes' });
    await expect(editor.locator('h2')).toHaveText('Where I stopped');
    await expect(editor.locator('strong')).toHaveText('bright');
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.pressSequentially('Next: reach the lighthouse.');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const saved = await savedNotes(page, id);
    expect(saved).toContain('## Where I stopped');
    expect(saved).toContain('**bright**');
    expect(saved).toContain('Next: reach the lighthouse.');

    await page.getByRole('button', { name: 'Edit notes', exact: true }).click();
    await editor.fill('This cancelled draft must never be saved.');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await savedNotes(page, id)).toBe(saved);

    await goTo(page, '/games');
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await goTo(page, `/games/${id}`);
    await expect(page.getByText('Next: reach the lighthouse.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edit notes', exact: true }).click();
    await expect(editor).not.toContainText('cancelled draft');
    await editor.fill('');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await savedNotes(page, id)).toBeNull();
    await expect(
      page.getByRole('button', { name: 'Add notes about this game — markdown supported.' }),
    ).toBeVisible();
  });

  test('the shared editor saves from Edit game and Plan without leaking notes between games', async ({
    afterplay,
  }) => {
    const { window: page } = afterplay;
    const id = await gameId(page, 'Alan Wake');
    const before = await page.evaluate((target) => globalThis.api.games.getById(target), id);
    await goTo(page, `/games/${id}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Game notes' })
      .fill('Saved from the full game editor.');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const after = await page.evaluate((target) => globalThis.api.games.getById(target), id);
    expect(after?.notes).toBe('Saved from the full game editor.');
    expect(after?.stateHistory).toEqual(before?.stateHistory);

    const plannedId = await gameId(page, 'Chrono Trigger', true);
    await goTo(page, `/plan/${plannedId}`);
    await expect(page.getByRole('heading', { name: 'Chrono Trigger', exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Add notes about this game — markdown supported.' })
      .click();
    const editor = page.getByRole('textbox', { name: 'Game notes' });
    await expect(editor).not.toContainText('Saved from the full game editor.');
    await editor.fill('A separate planned adventure.');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await savedNotes(page, plannedId)).toBe('A separate planned adventure.');
    expect(await savedNotes(page, id)).toBe('Saved from the full game editor.');
  });

  test('a failed IPC save keeps the draft open and a retry saves the same text', async ({
    afterplay,
  }) => {
    const { window: page, app } = afterplay;
    const id = await gameId(page, 'Alan Wake');
    await goTo(page, `/games/${id}`);
    await page
      .getByRole('button', { name: 'Add notes about this game — markdown supported.' })
      .click();
    const editor = page.getByRole('textbox', { name: 'Game notes' });
    const draft = 'This draft survives a failed save.';
    await editor.fill(draft);

    // Fault only this sandbox process's save handler; restore the real handler
    // before retrying. Electron exposes no public getter, so this single test
    // captures its registered callback from the internal handler map, then uses
    // the public registration API. No production testing hook is needed.
    const saveHandler = await app.evaluateHandle(({ ipcMain }) => {
      const handlers = (
        ipcMain as typeof ipcMain & {
          _invokeHandlers: Map<string, Parameters<typeof ipcMain.handle>[1]>;
        }
      )._invokeHandlers;
      const original = handlers.get('games:update');
      if (!original) throw new Error('Missing games:update handler for E2E fault injection.');
      ipcMain.removeHandler('games:update');
      ipcMain.handle('games:update', () => {
        throw new Error('E2E forced note save failure');
      });
      return {
        restore: () => {
          ipcMain.removeHandler('games:update');
          ipcMain.handle('games:update', original);
        },
      };
    });
    try {
      await page.getByRole('button', { name: 'Save notes', exact: true }).click();
      await expect(page.getByText(/Couldn't save your notes/)).toBeVisible();
      await expect(editor).toHaveText(draft);
      expect(await savedNotes(page, id)).toBeNull();
      await saveHandler.evaluate((handler) => handler.restore());
      await page.getByRole('button', { name: 'Save notes', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await savedNotes(page, id)).toBe(draft);
    } finally {
      await saveHandler.evaluate((handler) => handler.restore());
      await saveHandler.dispose();
    }
  });
});
