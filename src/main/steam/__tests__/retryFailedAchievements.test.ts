import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type { PendingAchievementsGame } from '../queue';

// EL BOTÓN DE REINTENTAR LOS FALLIDOS, y lo único que puede hacerle daño de
// verdad: el registro de fallidos es la ÚNICA memoria de esos juegos. Vive en
// RAM, no en la base, y la pasada automática del arranque no los recoge (solo
// mira los que nunca trajeron catálogo, y estos ya lo tenían). Si el registro
// se vacía sin que nadie los haya reencolado, esos juegos no vuelven a
// sincronizarse por ningún camino automático y el badge se pone a 0 mintiendo.
//
// El escenario real: 12 juegos fallan por un 429 durante un "Sync now", el
// usuario se va a API & Sync y borra la clave de Steam (deja la de RA, así que
// la tarjeta de logros sigue viva y el botón de reintento sigue pintado), y
// vuelve a pulsar. Borrar la clave tiene efecto EN CALIENTE —credentials.ts
// hace delete process.env[...]— así que aquí basta con quitar la variable.
//
// La cola es la REAL (lib/claimQueue); lo único doblado es el sync de un juego,
// que arrastra Electron y la base entera. Mismo reparto que queues.test.ts.

type AnyGame = { id: number; title: string };
let syncImpl: (
  game: AnyGame,
) => Promise<{ catalogCount: number; unlockedCount: number }> = async () => ({
  catalogCount: 0,
  unlockedCount: 0,
});

mock.module('../syncAchievements', {
  namedExports: {
    syncGameAchievements: (game: AnyGame) => syncImpl(game),
  },
});

let queue: typeof import('../queue');

const KEY_BEFORE = process.env.STEAM_API_KEY;
// La cola canta cada fallo por consola. Correcto en la app, ocho lineas de
// traza aqui — y los fallos son justo lo que este test provoca a proposito.
const realConsoleError = console.error;
console.error = (): void => {};

before(async () => {
  queue = await import('../queue');
});

after(() => {
  console.error = realConsoleError;
  if (KEY_BEFORE === undefined) delete process.env.STEAM_API_KEY;
  else process.env.STEAM_API_KEY = KEY_BEFORE;
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// La cola no expone su promesa de worker (a propósito, igual que en la app):
// se observa desde fuera, como haría el renderer.
const waitUntil = async (condition: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${what}`);
    await sleep(5);
  }
};

const game = (id: number): PendingAchievementsGame => ({
  id,
  title: `Juego ${id}`,
  steamAppId: 400 + id,
  executablePath: null,
  installDirectory: null,
  heroUrl: null,
});

test('steam: sin clave, el reintento no se lleva por delante el registro de fallidos', async () => {
  process.env.STEAM_API_KEY = 'clave-buena';
  syncImpl = async () => {
    throw new Error('boom 429');
  };

  queue.enqueueAchievements([game(301), game(302)]);
  await waitUntil(() => !queue.isAchievementsQueueRunning(), 'racha con fallos');
  assert.equal(queue.getFailedAchievementsCount(), 2);

  // ARREGLADO. El clear() iba ANTES de encolar, y enqueueAchievements sale con
  // 0 sin tocar la cola cuando no hay clave: el registro se quedaba vacío, el
  // badge en 0 y los dos juegos sin reintentar por ningún sitio.
  delete process.env.STEAM_API_KEY;
  assert.equal(queue.retryFailedAchievements(), 0);
  assert.equal(queue.getFailedAchievementsCount(), 2);
  await sleep(30);
  assert.equal(queue.isAchievementsQueueRunning(), false);

  // Con la clave de vuelta el reintento sí hace lo que dice, y el éxito los
  // limpia — el registro se vacía porque los juegos se han ido a la cola, no
  // por haber pulsado.
  process.env.STEAM_API_KEY = 'clave-buena';
  syncImpl = async () => ({ catalogCount: 3, unlockedCount: 1 });
  assert.equal(queue.retryFailedAchievements(), 2);
  await waitUntil(() => !queue.isAchievementsQueueRunning(), 'racha de reintento');
  assert.equal(queue.getFailedAchievementsCount(), 0);

  // Y sin nada pendiente, el reintento sigue diciendo 0 sin arrancar nada.
  assert.equal(queue.retryFailedAchievements(), 0);
  assert.equal(queue.isAchievementsQueueRunning(), false);
});
