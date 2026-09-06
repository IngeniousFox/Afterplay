import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  cleanupDbs,
  freshDb,
  makeAchievement,
  makeGame,
  makeUnlock,
  measure,
  type TestDb,
} from './harness';

// Dos consultas que comparten el mismo denominador: "juegos con catálogo de
// logros posible" (steamAppId O raGameId). getAchievementsStatus lo cuenta
// para la tarjeta de Ajustes; getPendingAchievementsGames lo recorre para
// decidir a quién le toca sincronizar. Lo que se blinda:
//
//   · el denominador es una fila por juego, no una suma por vía (un juego con
//     LAS DOS ids no cuenta doble — esa fue la cicatriz real: la tarjeta
//     llegó a decir "541 de 527" al sumar Steam y RA sin deduplicar);
//   · un juego sin ninguna de las dos ids no cuenta, planeado o no;
//   · y los PLANEADOS SÍ cuentan cuando tienen appid — a propósito, y no una
//     laguna: getAchievementsOverview.ts lo dice explícito ("LA POBLACIÓN SON
//     TODOS LOS JUEGOS CON CATÁLOGO, PLANEADOS INCLUIDOS") y
//     getPendingAchievementsGames.ts lo confirma en su propia cabecera
//     ("Incluye los PLANEADOS a propósito"): el catálogo de un juego que aún
//     no has jugado es información válida, y ni el escritor de Steam ni el de
//     RA miran `planned` al sincronizar. Si getAchievementsStatus excluyera
//     planeados de su denominador, contaría juegos que la propia sincro SÍ
//     procesa — la tarjeta volvería a mentir, esta vez al revés.

let db: TestDb;
let getAchievementsStatus: typeof import('../queries/achievements/getAchievementsStatus').getAchievementsStatus;
let getPendingAchievementsGames: typeof import('../queries/achievements/getPendingAchievementsGames').getPendingAchievementsGames;

before(async () => {
  ({ getAchievementsStatus } = await import('../queries/achievements/getAchievementsStatus'));
  ({ getPendingAchievementsGames } =
    await import('../queries/achievements/getPendingAchievementsGames'));
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

// ══ getAchievementsStatus ═══════════════════════════════════════════════════

describe('getAchievementsStatus: el denominador de "juegos elegibles"', () => {
  it('combina los contadores de juegos sin perder catálogos ni duplicar desbloqueos por fuente', async () => {
    const gameId = await makeGame(db, { steamAppId: 620, raGameId: 1 });
    // Un sello sigue siendo una sincronización aunque ya no tenga fuente,
    // y epoch 0 no es lo mismo que NULL.
    await makeGame(db, { achievementsSyncedAt: new Date(0) });
    const achievementId = await makeAchievement(db, gameId, 'FIRST');
    await makeAchievement(db, gameId, 'SECOND');
    await makeUnlock(db, achievementId, '2024-01-01T12:00:00Z', { source: 'steam' });
    await makeUnlock(db, achievementId, '2024-01-02T12:00:00Z', { source: 'emu' });
    const [status, work] = await measure(() => getAchievementsStatus(true, 2));
    assert.equal(status.eligibleGames, 1);
    assert.equal(status.syncedGames, 1);
    assert.equal(status.totalAchievements, 2);
    assert.equal(status.unlockedAchievements, 1);
    assert.deepEqual(work, { queries: 1, rows: 1 });
  });

  it('cuenta steamAppId O raGameId, y un juego con LAS DOS no cuenta doble', async () => {
    await makeGame(db, { title: 'Solo Steam', steamAppId: 620 });
    await makeGame(db, { title: 'Solo RA', raGameId: 4650 });
    await makeGame(db, { title: 'Las dos', steamAppId: 730, raGameId: 1 });
    await makeGame(db, { title: 'Ninguna', steamAppId: null, raGameId: null });

    const status = await getAchievementsStatus(false, 0);

    assert.equal(status.eligibleGames, 3);
  });

  it('un juego PLANEADO con appid SÍ cuenta: la sincro lo procesa igual que a uno de la biblioteca', async () => {
    await makeGame(db, { title: 'Planeado con appid', planned: true, steamAppId: 620 });
    await makeGame(db, { title: 'Planeado sin appid', planned: true });

    const status = await getAchievementsStatus(false, 0);

    assert.equal(status.eligibleGames, 1);
  });

  it('una biblioteca vacía da ceros, no undefined ni NaN', async () => {
    const status = await getAchievementsStatus(false, 0);

    assert.equal(status.eligibleGames, 0);
    assert.equal(status.syncedGames, 0);
    assert.equal(status.totalAchievements, 0);
    assert.equal(status.unlockedAchievements, 0);
  });

  it('syncedGames cuenta achievementsSyncedAt puesto, sin mirar si el catálogo vino vacío', async () => {
    // achievementsSyncedAt se marca aunque el juego no tenga logros (hay
    // juegos en Steam sin ninguno, y eso es una respuesta legítima): el
    // conteo no puede exigir catálogo, solo el sello de "ya se preguntó".
    await makeGame(db, {
      title: 'Preguntado sin catálogo',
      steamAppId: 620,
      achievementsSyncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    await makeGame(db, { title: 'Nunca preguntado', steamAppId: 730 });

    const status = await getAchievementsStatus(false, 0);

    assert.equal(status.syncedGames, 1);
  });

  it('running y failedGames viajan tal cual, sin que la consulta los toque', async () => {
    const status = await getAchievementsStatus(true, 7);

    assert.equal(status.running, true);
    assert.equal(status.failedGames, 7);
  });
});

// ══ getPendingAchievementsGames ═════════════════════════════════════════════

describe('getPendingAchievementsGames: a quién le toca sincronizar', () => {
  it('sin steamAppId no hay nada que preguntar, planeado o no', async () => {
    await makeGame(db, { title: 'Sin appid' });
    await makeGame(db, { title: 'Sin appid, planeado', planned: true });
    // Y raGameId no basta: esta consulta es SOLO de Steam.
    await makeGame(db, { title: 'Solo RA', raGameId: 4650 });

    assert.deepEqual(await getPendingAchievementsGames(false), []);
    assert.deepEqual(await getPendingAchievementsGames(true), []);
  });

  it('un juego PLANEADO con steamAppId entra: el catálogo es info del juego, no tuya', async () => {
    await makeGame(db, { title: 'Planeado', planned: true, steamAppId: 620 });

    const [pending] = await getPendingAchievementsGames(false);

    assert.equal(pending.title, 'Planeado');
    assert.equal(pending.steamAppId, 620);
  });

  it('full=false solo trae los que NUNCA han traído catálogo (achievementsSyncedAt null)', async () => {
    await makeGame(db, {
      title: 'Ya sincronizado',
      steamAppId: 620,
      achievementsSyncedAt: new Date(),
    });
    await makeGame(db, { title: 'Pendiente', steamAppId: 730 });

    const pending = await getPendingAchievementsGames(false);

    assert.deepEqual(
      pending.map((game) => game.title),
      ['Pendiente'],
    );
  });

  it('full=true trae TODOS los que tienen steamAppId, ya estén sincronizados o no', async () => {
    await makeGame(db, {
      title: 'Ya sincronizado',
      steamAppId: 620,
      achievementsSyncedAt: new Date(),
    });
    await makeGame(db, { title: 'Pendiente', steamAppId: 730 });

    const pending = await getPendingAchievementsGames(true);

    assert.deepEqual(pending.map((game) => game.title).sort(), ['Pendiente', 'Ya sincronizado']);
  });

  it('el orden es por título, sin importar mayúsculas ni minúsculas', async () => {
    await makeGame(db, { title: 'zelda', steamAppId: 1 });
    await makeGame(db, { title: 'Alba', steamAppId: 2 });
    await makeGame(db, { title: 'braid', steamAppId: 3 });

    const pending = await getPendingAchievementsGames(true);

    assert.deepEqual(
      pending.map((game) => game.title),
      ['Alba', 'braid', 'zelda'],
    );
  });

  it('cada fila trae lo justo para la cola: ejecutable, carpeta y hero para las fuentes de emulador', async () => {
    await makeGame(db, {
      title: 'Con datos de emulador',
      steamAppId: 620,
      executablePath: 'C:\\Games\\g\\g.exe',
      installDirectory: 'C:\\Games\\g',
      heroUrl: 'https://hero/g.jpg',
    });

    const [pending] = await getPendingAchievementsGames(false);

    assert.equal(pending.executablePath, 'C:\\Games\\g\\g.exe');
    assert.equal(pending.installDirectory, 'C:\\Games\\g');
    assert.equal(pending.heroUrl, 'https://hero/g.jpg');
  });
});
