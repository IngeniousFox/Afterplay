import { defineConfig } from '@playwright/test';

// Tests de extremo a extremo sobre la app REAL (ver e2e/fixtures.ts).
//
// Exigen `npm run build` antes: se lanza el main compilado de out/, no el de
// desarrollo. No se compila aquí automáticamente a propósito — un test que
// dispara un build de 30 s por su cuenta esconde cuándo estás probando código
// viejo; el script `test:e2e` de package.json encadena las dos cosas y deja
// `test:e2e:only` para iterar sin recompilar.
export default defineConfig({
  testDir: './e2e',
  // De uno en uno: cada test levanta un Electron entero (main + renderer +
  // GPU), y varias instancias a la vez en un portátil se pelean por la CPU
  // hasta que los timeouts empiezan a mentir sobre lo que falla.
  workers: 1,
  fullyParallel: false,
  // Arrancar la app son varios segundos (migraciones, tres relojes del
  // arranque, decodificar carátulas), así que el límite por test es generoso
  // comparado con uno de navegador.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Sin reintentos: un E2E que solo pasa a la segunda es un test que miente.
  // Si aparece uno inestable, se arregla o se marca, no se reintenta.
  retries: 0,
  reporter: [['list']],
  use: {
    // El vídeo/traza de Playwright no aplica a Electron igual que a un
    // navegador; lo que de verdad sirve para depurar aquí es la captura al
    // fallar, que se guarda junto al informe.
    screenshot: 'only-on-failure',
  },
});
