import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDENTIAL_KEYS } from '../src/shared/credentialKeys';
import { expect, test } from './fixtures';

// EL TEST QUE PROTEGE AL DUEÑO.
//
// Todos los demás tests E2E prueban la app; este prueba que los tests no
// puedan hacer daño. Es el que hay que mirar primero si alguien toca el
// arranque, las credenciales o la conexión con Turso — y el que tiene que
// seguir en verde para que el resto pueda existir.
//
// El escenario que vigila no es hipotético: el 3-ago-2026 una instancia de
// prueba con carpeta de datos nueva importó el .env del proyecto (que
// entonces tenía la base REAL activa) y le empujó una migración. Un test E2E
// es EXACTAMENTE esa situación —carpeta virgen, app sin empaquetar—, así que
// sin estas comprobaciones la suite entera sería una pistola cargada.

test.describe('aislamiento del entorno', () => {
  test('la app vive entera en la carpeta desechable, no en la del dueño', async ({ afterplay }) => {
    const { app, sandbox } = afterplay;

    const paths = await app.evaluate(({ app: electronApp }) => ({
      userData: electronApp.getPath('userData'),
      isPackaged: electronApp.isPackaged,
    }));

    expect(paths.userData).toBe(sandbox.userDataDir);
    // Y que quede dicho: los tests corren SIN empaquetar, que es la condición
    // que activa la importación del .env legado. Si esto fuera true algún
    // día, el gate de abajo dejaría de ser el que salva la situación.
    expect(paths.isPackaged).toBe(false);

    // La base que la app abrió es la sembrada, y está donde la dejamos.
    expect(existsSync(sandbox.dbPath)).toBe(true);

    // Y la app ha escrito lo SUYO aquí dentro. El sandbox nació con dos
    // ficheros (la base y las credenciales falsas); todo lo que haya de más
    // lo puso ella: el lockfile de instancia única, el WAL de SQLite, la
    // caché de Chromium… Se cuenta en vez de nombrar un fichero concreto
    // porque cuáles son exactamente es cosa de Electron y cambia entre
    // versiones — lo que este test afirma es DÓNDE caen, no cuáles son.
    // (config.json no vale de testigo: se escribe perezoso, solo cuando
    // cambia un ajuste, así que en un arranque limpio no existe.)
    const entries = readdirSync(sandbox.userDataDir);
    expect(entries).toContain('Afterplay.db');
    expect(entries).toContain('credentials.json');
    expect(entries.length).toBeGreaterThan(2);
  });

  test('no hay credenciales de Turso vivas ni sync posible', async ({ afterplay }) => {
    const { app } = afterplay;

    const env = await app.evaluate(() => ({
      databaseUrl: process.env.DATABASE_URL ?? '',
      databaseToken: process.env.DATABASE_AUTH_TOKEN ?? '',
      e2eFlag: process.env.AFTERPLAY_E2E_USER_DATA ?? '',
    }));

    // Ni una ni otra: initCredentials pasó por aquí y NO importó el .env del
    // proyecto (que hoy tiene una base de verdad configurada). Esta es la
    // comprobación que impide repetir el 3-ago-2026.
    expect(env.databaseUrl).toBe('');
    expect(env.databaseToken).toBe('');
    // Y el gate está de verdad encendido — si esta variable se perdiera por
    // el camino, las dos de arriba podrían estar vacías por casualidad.
    expect(env.e2eFlag).not.toBe('');
  });

  test('las credenciales de la app salen SOLO de .env.test, y sin la base', async ({
    afterplay,
  }) => {
    const { sandbox } = afterplay;

    // El .env del repo existe y tiene DATABASE_URL (lo usa el tooling de
    // desarrollo). Que exista es justo el peligro: importLegacyEnv lo
    // buscaría en process.cwd() por no estar la app empaquetada.
    const projectEnvExists = existsSync(join(process.cwd(), '.env'));
    test.skip(!projectEnvExists, 'sin .env en el repo no hay nada que importar (ni riesgo)');

    // Lo que la app tiene delante es lo que el sandbox le escribió, y punto.
    // Se lee desde el test y no con app.evaluate() a propósito: dentro de
    // evaluate no hay import() dinámico, y la ruta del sandbox ya se conoce
    // en este lado.
    const stored = readFileSync(join(sandbox.userDataDir, 'credentials.json'), 'utf-8');
    const parsed = JSON.parse(stored) as { values: Record<string, string> };
    const keys = Object.keys(parsed.values);

    // LO QUE DE VERDAD PROTEGE: ni una credencial de base de datos. Este test
    // corre sin `withRemote`, así que da igual lo que traiga .env.test (o el
    // .env del proyecto, o la terminal): aquí no puede haber con qué abrir la
    // biblioteca de nadie. Es la comprobación que impide repetir el susto del
    // 3-ago-2026 ahora que los tests SÍ llevan credenciales de verdad.
    expect(keys).not.toContain('databaseUrl');
    expect(keys).not.toContain('databaseAuthToken');

    // Y lo que hay es del catálogo permitido: nada que el andamio no haya
    // puesto a partir de .env.test (o el relleno de IGDB si no existe).
    const allowed = new Set([
      ...CREDENTIAL_KEYS.filter((key) => key !== 'databaseUrl' && key !== 'databaseAuthToken'),
    ]);
    for (const key of keys) expect(allowed.has(key as never)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
  });
});
