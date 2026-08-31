import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { achievementsTable } from '../../db/schema';
import {
  cleanupDbs,
  freshDb,
  makeAchievement,
  makeGame,
  makeUnlock,
  type TestDb,
} from '../../db/__tests__/harness';
import type { AchievementToast } from '../notifications/overlay';

// EL BROCHE DORADO DEL 100% (LOGROS-IDEAS.md §3.6) y la única pregunta que
// decide si emociona o molesta: CUÁNTAS VECES sale.
//
// La celebración no es el aviso de un logro, es el aviso de un ESTADO ("ya no
// te queda ninguno"), y ese estado sigue siendo verdad en la comprobación
// siguiente y en la de después. Por eso deduplicar el logro —que es lo que hace
// storeUnlocks, y muy bien— no deduplica esto: dos tandas seguidas del mismo
// juego programan dos comprobaciones, las dos ven el juego completo y las dos
// encolan la misma tarjeta dorada.
//
// La base es la REAL del andamio: lo que se prueba es la cuenta contra las
// tablas, no a quién se llamó. Lo falso es la cola de avisos, que arrastra
// Electron.

const toasts: AchievementToast[] = [];
mock.module('../notifications/overlay', {
  namedExports: {
    enqueueAchievementToasts: (batch: AchievementToast[]): void => {
      toasts.push(...batch);
    },
  },
});

let db: TestDb;
let maybeCelebrateCompletion: typeof import('../notifications/complete').maybeCelebrateCompletion;

// El propio AFTER_BATCH_MS del módulo (1500) más margen: la comprobación va en
// un setTimeout para que la tarjeta caiga DETRÁS de los logros que la
// provocaron, no fundida en su resumen.
const AFTER_CHECK_MS = 1800;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  ({ maybeCelebrateCompletion } = await import('../notifications/complete'));
});
beforeEach(async () => {
  db = await freshDb();
  toasts.length = 0;
});
after(() => cleanupDbs());

// Un juego con `total` logros de los que `unlocked` están sacados.
const gameWith = async (total: number, unlocked: number): Promise<number> => {
  const gameId = await makeGame(db, { title: 'Celeste' });
  for (let index = 0; index < total; index++) {
    const achievementId = await makeAchievement(db, gameId, `A${index}`, { sortIndex: index });
    if (index < unlocked) await makeUnlock(db, achievementId, '2026-01-10T19:00:00Z');
  }
  return gameId;
};

describe('maybeCelebrateCompletion: la tarjeta dorada sale UNA vez por 100%', () => {
  it('dos vaciados seguidos del mismo juego no sacan dos tarjetas iguales', async () => {
    // ARREGLADO. El vigilante de emuladores rebota a 900 ms, así que dos
    // escrituras del crack separadas ~1,1 s NO se funden: salen dos vaciados
    // con un logro fresco cada uno y, por tanto, dos comprobaciones. Cuando
    // vencía la del primero el último logro ya estaba guardado, así que las dos
    // veían el juego completo y encolaban su tarjeta — dos broches dorados
    // idénticos por el mismo 100%, separados por unos segundos.
    const gameId = await gameWith(2, 2);

    maybeCelebrateCompletion(gameId, 'Celeste', null);
    await sleep(200);
    maybeCelebrateCompletion(gameId, 'Celeste', null);
    await sleep(AFTER_CHECK_MS);

    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].celebration, true);
    assert.equal(toasts[0].gameTitle, 'Celeste');
  });

  it('un juego al que le falta un logro no celebra, y celebra al cerrarlo', async () => {
    // El borde contrario: la memoria de celebrados no puede convertirse en un
    // cepo. Se usa un juego distinto del test anterior a propósito — ese
    // registro es estado de módulo y sobrevive al vaciado de la base.
    await makeGame(db, { title: 'Relleno para no repetir id' });
    const gameId = await gameWith(2, 1);

    maybeCelebrateCompletion(gameId, 'Celeste', null);
    await sleep(AFTER_CHECK_MS);
    assert.deepEqual(toasts, []);

    // Cae el que faltaba: ahora sí.
    const [pendiente] = await db
      .select({ id: achievementsTable.id })
      .from(achievementsTable)
      .where(and(eq(achievementsTable.gameId, gameId), eq(achievementsTable.apiName, 'A1')));
    await makeUnlock(db, pendiente.id, '2026-01-10T20:00:00Z');

    maybeCelebrateCompletion(gameId, 'Celeste', null);
    await sleep(AFTER_CHECK_MS);
    assert.equal(toasts.length, 1);
  });
});
