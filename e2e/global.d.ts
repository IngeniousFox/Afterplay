import type { api as preloadApi } from '../src/preload/api';

// EL PUENTE DEL PRELOAD, TIPADO PARA LOS TESTS E2E.
//
// Dentro de page.evaluate() el codigo corre en la pagina, donde contextBridge
// ha colgado el puente en `api`. Sin esta declaracion cada spec tenia que
// escribir un `(globalThis as unknown as {...}).api` a mano con la forma del
// dominio que fuera: verboso, sin autocompletado y —lo peor— una copia de la
// firma que se queda vieja en silencio el dia que el preload cambie.
//
// Con esto, `globalThis.api.games.getAll()` esta tipado con la firma REAL del
// preload, asi que renombrar un metodo alli pone rojo el typecheck de los
// tests (ver tsconfig.e2e.json, que entra en `npm run typecheck`) en vez de
// fallar en ejecucion con un "undefined is not a function".
//
// OJO: dentro de evaluate NO se puede usar el identificador `window` — en un
// fichero de test resolveria a la Page de Playwright, no al global de la
// pagina. Por eso siempre `globalThis.api`.
declare global {
  // eslint-disable-next-line no-var
  var api: typeof preloadApi;
}
