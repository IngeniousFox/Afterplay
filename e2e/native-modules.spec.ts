import { expect, test } from './fixtures';

test('los binarios nativos y safeStorage funcionan dentro del Electron instalado', async ({
  afterplay,
}) => {
  const result = await afterplay.app.evaluate(async ({ app, safeStorage }) => {
    const { createRequire } = process.getBuiltinModule('module');
    const { join } = process.getBuiltinModule('path');
    const requireFromApp = createRequire(join(app.getAppPath(), 'package.json'));
    // La base 2.0 va sobre node:sqlite, el SQLite que trae el propio Node de
    // Electron (db/v2/connection.ts): si una versión de Electron lo quitara o
    // lo dejara tras una bandera, esto se pone rojo antes que la app.
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const sdl = requireFromApp('@kmamal/sdl') as typeof import('@kmamal/sdl');
    const marker = 'Native compatibility: ñ 🎮';
    const db = new DatabaseSync(join(app.getPath('userData'), 'native-sqlite.db'));
    let stored: unknown;
    try {
      db.exec('CREATE TABLE probe (value TEXT NOT NULL)');
      db.prepare('INSERT INTO probe VALUES (?)').run(marker);
      stored = (db.prepare('SELECT value FROM probe').get() as { value: string }).value;
    } finally {
      db.close();
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
  // Y la app de verdad ya abrió con él la base 2.0 de este sandbox.
  await expect(afterplay.window.getByRole('link', { name: 'Games', exact: true })).toBeVisible();
});
