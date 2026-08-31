import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import { achievementsTable, achievementUnlocksTable } from '../../db/schema';
import {
  cleanupDbs,
  freshDb,
  makeAchievement,
  makeGame,
  type TestDb,
} from '../../db/__tests__/harness';
import type { RaRecentUnlock } from '../../ra/api';

// EL SONDEO EN VIVO DE RETROACHIEVEMENTS y la regla que comparte con el
// vigilante de emuladores: los logros se le dan a TODAS las fichas emparejadas
// con ese juego, no a la primera que devuelva SQLite.
//
// La cicatriz es literal (steam/emu/watcher.ts): raGameId no lleva UNIQUE y el
// emparejado se decide fila a fila, así que dos fichas de la biblioteca —el
// juego y una edición o recopilatorio— pueden acabar apuntando al mismo set de
// RA. Con un find(), los logros quedaban colgados de la que SQLite devolviera
// antes; y como el resto de caminos de RA (el nivel 3 del arranque y "Sync
// now") sí se los dan a todas, el estado EN VIVO y el de después de reiniciar
// ni siquiera coincidían.
//
// El fichero está aquí, junto al resto de tests de logros, porque lo que se
// prueba es el mismo embudo (storeUnlocks) y la misma regla que el vigilante.

let recent: RaRecentUnlock[] = [];

mock.module('../../ra/api', {
  namedExports: {
    hasRaCredentials: (): boolean => true,
    getRaRecentUnlocks: async (): Promise<RaRecentUnlock[]> => recent,
  },
});

// Los avisos en pantalla arrastran Electron; la celebración del 100% se agenda
// a 1,5 s y llegaría con la base ya cerrada.
mock.module('../notifications/overlay', {
  namedExports: { enqueueAchievementToasts: (): void => {} },
});
mock.module('../notifications/complete', {
  namedExports: { maybeCelebrateCompletion: (): void => {} },
});

const RA_GAME_ID = 12345;
const RA_ACHIEVEMENT_ID = 777;
// El intervalo real del sondeo (ra/livePoll.ts). Se avanza el reloj en vez de
// esperarlo: medio minuto por test sería medio minuto por test.
const INTERVAL_MS = 30_000;

let db: TestDb;
let livePoll: typeof import('../../ra/livePoll');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (condition: () => Promise<boolean>, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${what}`);
    await sleep(5);
  }
};

before(async () => {
  livePoll = await import('../../ra/livePoll');
});
beforeEach(async () => {
  db = await freshDb();
  recent = [];
  mock.timers.enable({ apis: ['setInterval'] });
});
// El sondeo y el reloj de mentira se sueltan pase lo que pase: un test que
// falle a mitad no puede dejar el intervalo vivo para el siguiente.
afterEach(() => {
  livePoll.stopRaLivePoll();
  mock.timers.reset();
});
after(() => cleanupDbs());

// Una ficha de la biblioteca emparejada con el set de RA, con su catálogo — sin
// fila de catálogo no hay dónde colgar un desbloqueo.
const fichaEmparejada = async (title: string): Promise<number> => {
  const gameId = await makeGame(db, { title, raGameId: RA_GAME_ID });
  await makeAchievement(db, gameId, String(RA_ACHIEVEMENT_ID), { displayName: 'Warp Zone' });
  return gameId;
};

const unlocksOf = async (gameId: number): Promise<number> => {
  const rows = await db
    .select({ id: achievementUnlocksTable.id })
    .from(achievementUnlocksTable)
    .innerJoin(achievementsTable, eq(achievementUnlocksTable.achievementId, achievementsTable.id))
    .where(eq(achievementsTable.gameId, gameId));
  return rows.length;
};

describe('sondeo en vivo de RA: el desbloqueo va a todas las fichas del set', () => {
  it('dos fichas emparejadas con el mismo juego de RA reciben las dos el logro', async () => {
    // ARREGLADO. Con find() solo una de las dos lo recibía —la que devolviera
    // SQLite primero, sin orderBy que lo decidiera— y el "Sync now" siguiente
    // se lo daba a las dos: la ficha que mirabas cambiaba de logros al
    // reiniciar la app.
    const elJuego = await fichaEmparejada('Super Mario World');
    const laColeccion = await fichaEmparejada('Super Mario All-Stars + World');
    recent = [
      {
        raAchievementId: RA_ACHIEVEMENT_ID,
        raGameId: RA_GAME_ID,
        gameTitle: 'Super Mario World',
        unlockedAt: new Date('2026-02-01T19:30:00Z'),
      },
    ];

    livePoll.startRaLivePoll(() => true);
    mock.timers.tick(INTERVAL_MS);

    await waitUntil(async () => (await unlocksOf(laColeccion)) === 1, 'la segunda ficha');
    assert.equal(await unlocksOf(elJuego), 1);
  });

  it('un set de RA que no está en la biblioteca se ignora en silencio', async () => {
    // Sin ninguna ficha emparejada no hay dónde colgarlo: mismo silencio que el
    // vigilante de emuladores con un appid que no conoce.
    const otroJuego = await fichaEmparejada('Super Mario World');
    recent = [
      {
        raAchievementId: RA_ACHIEVEMENT_ID,
        raGameId: 99999,
        gameTitle: 'Un juego que no tienes',
        unlockedAt: new Date('2026-02-01T19:30:00Z'),
      },
    ];

    livePoll.startRaLivePoll(() => true);
    mock.timers.tick(INTERVAL_MS);
    await sleep(150);

    assert.equal(await unlocksOf(otroJuego), 0);
  });
});
