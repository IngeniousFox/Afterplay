import { expect, test } from './fixtures';

test('los binarios nativos y safeStorage funcionan dentro del Electron instalado', async ({
  afterplay,
}) => {
  const result = await afterplay.app.evaluate(async ({ app, safeStorage }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const { join } = process.getBuiltinModule('path');
    const requireFromApp = createRequire(join(app.getAppPath(), 'package.json'));
    const { createClient } = requireFromApp('@libsql/client') as typeof import('@libsql/client');
    const sdl = requireFromApp('@kmamal/sdl') as typeof import('@kmamal/sdl');
    const marker = 'Native compatibility: ñ 🎮';
    const client = createClient({
      url: `file:${join(app.getPath('userData'), 'native-libsql.db')}`,
    });
    let stored: unknown;
    try {
      await client.execute('CREATE TABLE probe (value TEXT NOT NULL)');
      await client.execute({ sql: 'INSERT INTO probe VALUES (?)', args: [marker] });
      stored = (await client.execute('SELECT value FROM probe')).rows[0].value;
    } finally {
      client.close();
    }
    const encrypted = safeStorage.encryptString(marker);
    return {
      databaseRoundTrip: stored === marker,
      credentialRoundTrip: safeStorage.decryptString(encrypted) === marker,
      controllerApiLoaded: typeof sdl.controller.on === 'function',
    };
  });

  expect(result).toEqual({
    databaseRoundTrip: true,
    credentialRoundTrip: true,
    controllerApiLoaded: true,
  });
  // El driver de producción es el que ya abrió la DB de este sandbox.
  await expect(afterplay.window.getByRole('link', { name: 'Games', exact: true })).toBeVisible();
});
