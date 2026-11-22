import { defineConfig } from '@playwright/test';

// Capturas del rediseño (e2e/shots): mismo arranque que los e2e, pero aparte
// para que `npm run test:e2e` no las ejecute. Exige `npm run build` antes.
export default defineConfig({
  testDir: './e2e/shots',
  workers: 1,
  timeout: 240_000,
  retries: 0,
  reporter: [['list']],
});
