import { join } from 'node:path';
import { _electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { createSandbox, type Sandbox, type SandboxOptions } from './sandbox';

// EL ARRANQUE DE LA APP PARA UN TEST E2E.
//
// Playwright lanza el binario de Electron con el main COMPILADO (out/main,
// lo que deja `npm run build`), no el de desarrollo: así se prueba lo mismo
// que se instala, sin depender de que haya un servidor de Vite levantado.
//
// La variable AFTERPLAY_E2E_USER_DATA es la llave de todo (ver
// src/main/lib/e2e.ts): trae la carpeta desechable Y enciende el modo test en
// la misma palanca, de modo que no existe forma de arrancar un test sin
// sandbox. Las credenciales que la app usará son las que el sandbox le dejó
// escritas en su credentials.json, salidas de .env.test y de ningún otro
// sitio (ver e2e/credentials.ts).
//
// Las dos de Turso se vacían ADEMÁS en el entorno del proceso hijo, por si la
// terminal que lanza los tests las tuviera puestas: la app las ignoraría
// igual (lee su credentials.json, no el entorno heredado), pero cuanto menos
// cerca esté una credencial de producción de un proceso que va a pulsar
// botones solo, mejor.
//
// AFTERPLAY_E2E_ALLOW_SYNC es la SEGUNDA cerradura de la puerta peligrosa: el
// sync con una remota necesita credenciales (que solo entran si el test las
// pide) Y esta bandera. Dos llaves para lo único que puede escribir fuera del
// sandbox.
//
// El SPLASH obliga a buscar la ventana buena: la app abre primero una ventana
// de splash (una data: URL) y la de verdad (file://…/index.html) nace oculta
// y no se muestra hasta que hay contenido pintable — los tres relojes del
// arranque. Por eso no vale firstWindow(): hay que esperar a la que tiene la
// app dentro.

const MAIN_ENTRY = join(process.cwd(), 'out', 'main', 'index.js');
const WINDOW_TIMEOUT_MS = 60_000;

export type LaunchedApp = {
  app: ElectronApplication;
  window: Page;
  sandbox: Sandbox;
};

const isAppWindow = (page: Page): boolean => page.url().includes('index.html');

const waitForAppWindow = async (app: ElectronApplication): Promise<Page> => {
  const existing = app.windows().find(isAppWindow);
  if (existing) return existing;

  const deadline = Date.now() + WINDOW_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const page = await app.waitForEvent('window', { timeout: deadline - Date.now() });
    if (isAppWindow(page)) return page;
  }
  throw new Error('la ventana de la app no apareció (¿se quedó en el splash?)');
};

export const launchAfterplay = async (options: SandboxOptions = {}): Promise<LaunchedApp> => {
  const sandbox = await createSandbox(options);

  const app = await _electron.launch({
    args: [MAIN_ENTRY],
    cwd: process.cwd(),
    env: {
      ...process.env,
      AFTERPLAY_E2E_USER_DATA: sandbox.userDataDir,
      ...(sandbox.withRemote ? { AFTERPLAY_E2E_ALLOW_SYNC: '1' } : {}),
      DATABASE_URL: '',
      DATABASE_AUTH_TOKEN: '',
    },
  });

  const window = await waitForAppWindow(app);
  // La ventana nace oculta y se revela con el tercer reloj (el contenido
  // pintable). Esperar a que el shell exista es lo que evita que un test
  // empiece a buscar botones sobre un documento vacío.
  await window.waitForLoadState('domcontentloaded');
  return { app, window, sandbox };
};

// NAVEGAR SIN ENCADENAR CLICS.
//
// La app usa createHashRouter (router.tsx), así que la ruta vive en
// location.hash y se puede poner directamente. Es MUCHO más robusto que
// pinchar el rail lateral: un test de Stats no debería ponerse rojo porque
// alguien cambió el icono de Games, y llegar a la ficha de un juego a base de
// clics obliga a que la card esté visible (o sea, a pelearse con el
// content-visibility de la parrilla).
//
// Los clics del rail SÍ hay que probarlos — pero en UN test que pruebe el
// rail, no en los treinta que solo quieren estar en otra pantalla.
export type Route =
  '/games' | '/plan' | '/sessions' | '/stats' | `/games/${number}` | `/plan/${number}`;

export const goTo = async (page: Page, route: Route): Promise<void> => {
  await page.evaluate((target) => {
    globalThis.location.hash = `#${target}`;
  }, route);
  // El hash cambia sincrono pero React pinta después: esperar a que el
  // documento se asiente evita que el siguiente locator busque en la pantalla
  // anterior. waitForFunction y no un sleep: se espera al HECHO, no a un
  // número de milisegundos inventado.
  await page.waitForFunction((target) => globalThis.location.hash === `#${target}`, route);
};

// El test con la app ya arrancada y limpiada al terminar. Cada test estrena
// carpeta y base: nada de estado compartido entre ellos.
export const test = base.extend<{ afterplay: LaunchedApp }>({
  afterplay: async ({}, use) => {
    const launched = await launchAfterplay();
    try {
      await use(launched);
    } finally {
      await launched.app.close().catch(() => {});
      launched.sandbox.cleanup();
    }
  },
});

export { expect } from '@playwright/test';
