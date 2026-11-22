import { defineConfig, devices } from '@playwright/test';

// Capturas de la PWA para revisar el diseño (solo desarrollo). Sirve el build
// de `web/dist` con `vite preview` y el spec intercepta TODA la API con datos
// inventados: no toca ningún hub ni lee ningún token.
//
//   npm --prefix web run build
//   npx playwright test -c web/scripts/shots/playwright.config.ts
//
// Las PNG van a web/scripts/shots/out/ (ignorada por git) o a $PWA_SHOTS_DIR.
const PORT = 4317;

export default defineConfig({
  testDir: '.',
  testMatch: 'pwa-shots.spec.ts',
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7'],
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    baseURL: `http://127.0.0.1:${PORT}`,
    colorScheme: 'dark',
    locale: 'en-US',
    timezoneId: 'Europe/Madrid',
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
