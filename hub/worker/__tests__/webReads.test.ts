import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { playthroughs } from '../../../src/main/db/v2/schema';
import {
  seedCatalog,
  seedCuriosities,
  seedGame,
  seedInstall,
  seedPlaythrough,
  seedSession,
  seedSpendEvent,
  seedStateEvent,
  seedUnlock,
} from '../../../src/main/db/v2/queries/common/__tests__/fixtures';
import type { QueryContext } from '../../../src/main/db/v2/queries/common/context';
import type { LocalDb } from '../../../src/main/db/v2/store';
import type {
  GameAchievements,
  GameDetail,
  LibraryGame,
  PlannedGame,
  SessionPage,
  StatsSummary,
} from '../../../src/shared/api/v2/reads';
import { NodeSqlStorage } from '../../core/node/nodeStorage';
import { TenantService } from '../src/tenantService';
import type { WebRequest } from '../src/web/types';
import { HOST, T0, makeWorld } from './helpers';

// Las lecturas de la PWA en /api/v2 (web/reads.ts): cada ruta con datos
// inventados, sus errores, que no salga ninguna ruta local de un PC (F-31) y
// la caché por secuencia (§9.7). Las consultas son las del escritorio sobre el
// almacén del hub (node:sqlite aquí, durable-sqlite en producción).

const HOUR = 3_600_000;

function makeService(): { service: TenantService; time: { now: number } } {
  const time = { now: T0 };
  const storage = new NodeSqlStorage();
  const queryDb = (): LocalDb => drizzle({ client: storage.db }) as unknown as LocalDb;
  const service = new TenantService(storage, () => time.now, { tenantId: 'abc123' }, queryDb);
  return { service, time };
}

const write = <T>(service: TenantService, fn: (ctx: QueryContext) => T): T =>
  service.queries().write(fn).result;

async function get<T>(
  service: TenantService,
  path: string,
  query: Record<string, string> = {},
): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  const request: WebRequest = { method: 'GET', path, query, body: null };
  const outcome = await service.web(request);
  return outcome.ok
    ? { ok: true, value: outcome.value as T }
    : { ok: false, code: outcome.error.error };
}

async function value<T>(
  service: TenantService,
  path: string,
  query: Record<string, string> = {},
): Promise<T> {
  const result = await get<T>(service, path, query);
  assert.ok(result.ok, `GET ${path} debería ir bien`);
  return result.value;
}

/** Una biblioteca pequeña: un juego jugado y terminado, uno en vivo, uno del Plan. */
function seedWorld(service: TenantService): { celeste: string; hades: string; silksong: string } {
  return write(service, (ctx) => {
    const celeste = seedGame(ctx, {
      title: 'Celeste',
      igdbId: 1942,
      metadata: { coverUrl: 'https://img/celeste.jpg' },
      install: {},
    });
    const p1 = seedPlaythrough(ctx, { gameId: celeste });
    seedSession(ctx, { playthroughId: p1, startedAt: new Date(T0 - 40 * HOUR) });
    seedSession(ctx, { playthroughId: p1, startedAt: new Date(T0 - 30 * HOUR) });
    seedStateEvent(ctx, {
      playthroughId: p1,
      type: 'completed',
      occurredAt: new Date(T0 - 20 * HOUR),
    });
    seedSpendEvent(ctx, { gameId: celeste, amount: 20 });
    seedCuriosities(ctx, { gameId: celeste, items: ['Se hizo en cuatro días.', 'Otra más.'] });
    seedCatalog(ctx, {
      gameId: celeste,
      items: [
        { apiName: 'ACH_1', displayName: 'Primera' },
        { apiName: 'ACH_2', displayName: 'Segunda' },
      ],
    });
    seedUnlock(ctx, { gameId: celeste, apiName: 'ACH_1', unlockedAt: new Date(T0 - 35 * HOUR) });

    const hades = seedGame(ctx, { title: 'Hades' });
    const p2 = seedPlaythrough(ctx, { gameId: hades });
    seedSession(ctx, { playthroughId: p2, startedAt: new Date(T0 - HOUR), endedAt: null });

    const silksong = seedGame(ctx, {
      title: 'Silksong',
      planned: { pinnedAt: new Date(T0 - HOUR), note: 'Me lo recomendó Dani' },
      metadata: { releaseDate: new Date('2026-09-04T00:00:00Z'), releaseDatePrecision: 'day' },
    });
    return { celeste, hades, silksong };
  });
}

describe('GET /library', () => {
  it('lista la biblioteca con ids de texto, fechas en ms y sin los juegos del Plan', async () => {
    const { service } = makeService();
    const ids = seedWorld(service);
    const library = await value<LibraryGame[]>(service, '/library');

    assert.deepEqual(
      library.map((game) => game.title),
      ['Celeste', 'Hades'],
    );
    const celeste = library[0];
    assert.equal(celeste.id, ids.celeste);
    assert.equal(celeste.currentState, 'completed');
    assert.equal(celeste.sessionCount, 2);
    assert.equal(celeste.totalHours, 2);
    assert.equal(celeste.coverUrl, 'https://img/celeste.jpg');
    assert.equal(typeof celeste.lastPlayedAt, 'number');
    const hades = library[1];
    assert.equal(hades.isLive, true);
    assert.equal(hades.liveSince, T0 - HOUR);
    assert.ok(hades.liveDeviceId, 'dice en qué dispositivo está abierta');
  });

  it('una biblioteca vacía es una lista vacía', async () => {
    const { service } = makeService();
    assert.deepEqual(await value(service, '/library'), []);
  });
});

describe('GET /plan', () => {
  it('lista el Plan con lo fijado, la nota y la fecha de salida', async () => {
    const { service } = makeService();
    const { silksong } = seedWorld(service);
    const plan = await value<PlannedGame[]>(service, '/plan');
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, silksong);
    assert.equal(plan[0].title, 'Silksong');
    assert.equal(plan[0].pinnedAt, T0 - HOUR);
    assert.equal(plan[0].planNote, 'Me lo recomendó Dani');
    assert.equal(plan[0].releaseDate, Date.parse('2026-09-04T00:00:00Z'));
    assert.equal(plan[0].releaseDatePrecision, 'day');
  });
});

describe('GET /games/:id', () => {
  it('devuelve la ficha con lo derivado y en qué dispositivos está instalado', async () => {
    const { service } = makeService();
    const { celeste } = seedWorld(service);
    const game = await value<GameDetail>(service, `/games/${celeste}`);

    assert.equal(game.id, celeste);
    assert.equal(game.title, 'Celeste');
    assert.equal(game.igdbId, 1942);
    assert.equal(game.totalHours, 2);
    assert.equal(game.currentState, 'completed');
    assert.equal(game.totalSpend, 20);
    assert.equal(game.isLive, false);
    assert.equal(game.liveSince, null);
    assert.equal(game.iterations.length, 1);
    assert.equal(game.iterations[0].sessions.length, 2);
    assert.equal(typeof game.iterations[0].sessions[0].startedAt, 'number');
    assert.equal(game.stateHistory[0].type, 'completed');
    assert.equal(game.spendHistory.length, 1);
    assert.deepEqual(
      game.installedOn.map((install) => install.deviceName),
      ['Phone'],
    );
  });

  it('una ficha con una sesión abierta dice desde cuándo', async () => {
    const { service } = makeService();
    const { hades } = seedWorld(service);
    const game = await value<GameDetail>(service, `/games/${hades}`);
    assert.equal(game.isLive, true);
    assert.equal(game.liveSince, T0 - HOUR);
  });

  it('también sirve la ficha de un juego del Plan', async () => {
    const { service } = makeService();
    const { silksong } = seedWorld(service);
    const game = await value<GameDetail>(service, `/games/${silksong}`);
    assert.equal(game.planned, true);
    assert.equal(game.planPinnedAt, T0 - HOUR);
  });

  it('un id que no existe es not_found', async () => {
    const { service } = makeService();
    seedWorld(service);
    assert.deepEqual(await get(service, '/games/no-existe'), { ok: false, code: 'not_found' });
  });
});

describe('GET /games/:id/achievements y /curiosities', () => {
  it('los logros traen lo desbloqueado y el completado por fuente', async () => {
    const { service } = makeService();
    const { celeste } = seedWorld(service);
    const result = await value<GameAchievements>(service, `/games/${celeste}/achievements`);
    assert.equal(result.gameId, celeste);
    assert.deepEqual(
      result.entries.map((entry) => [entry.apiName, entry.unlockedAt !== null]),
      [
        ['ACH_1', true],
        ['ACH_2', false],
      ],
    );
    assert.equal(result.entries[0].unlockedAt, T0 - 35 * HOUR);
    assert.equal(result.completion[0].source, 'steam');
    assert.equal(result.completion[0].unlocked, 1);
    assert.equal(result.completion[0].total, 2);
  });

  it('un juego sin logros da una lista vacía; uno que no existe, not_found', async () => {
    const { service } = makeService();
    const { hades } = seedWorld(service);
    const result = await value<GameAchievements>(service, `/games/${hades}/achievements`);
    assert.deepEqual(result.entries, []);
    assert.deepEqual(await get(service, '/games/no-existe/achievements'), {
      ok: false,
      code: 'not_found',
    });
  });

  it('las curiosidades son la lista de frases del juego', async () => {
    const { service } = makeService();
    const { celeste, hades } = seedWorld(service);
    assert.deepEqual(await value(service, `/games/${celeste}/curiosities`), [
      'Se hizo en cuatro días.',
      'Otra más.',
    ]);
    assert.deepEqual(await value(service, `/games/${hades}/curiosities`), []);
    assert.deepEqual(await get(service, '/games/no-existe/curiosities'), {
      ok: false,
      code: 'not_found',
    });
  });
});

describe('GET /sessions', () => {
  it('pagina con el total, la más reciente primero', async () => {
    const { service } = makeService();
    const { celeste } = seedWorld(service);
    const first = await value<SessionPage>(service, '/sessions', { limit: '2', offset: '0' });
    assert.equal(first.total, 3);
    assert.equal(first.limit, 2);
    assert.equal(first.offset, 0);
    assert.equal(first.sessions.length, 2);
    assert.equal(first.sessions[0].gameTitle, 'Hades');
    assert.equal(first.sessions[0].endedAt, null);
    assert.equal(first.sessions[1].gameId, celeste);

    const second = await value<SessionPage>(service, '/sessions', { limit: '2', offset: '2' });
    assert.equal(second.total, 3);
    assert.equal(second.sessions.length, 1);
    const ids = [...first.sessions, ...second.sessions].map((session) => session.id);
    assert.equal(new Set(ids).size, 3);
  });

  it('sin parámetros, una página por defecto; fuera de rango, vacía', async () => {
    const { service } = makeService();
    seedWorld(service);
    const page = await value<SessionPage>(service, '/sessions');
    assert.equal(page.limit, 20);
    assert.equal(page.sessions.length, 3);
    const past = await value<SessionPage>(service, '/sessions', { offset: '50' });
    assert.deepEqual(past.sessions, []);
    assert.equal(past.total, 3);
  });

  it('parámetros inválidos son invalid_request', async () => {
    const { service } = makeService();
    const invalid: Record<string, string>[] = [
      { limit: '0' },
      { limit: '101' },
      { limit: 'abc' },
      { limit: '-1' },
      { limit: '1.5' },
      { offset: '-1' },
      { offset: 'x' },
    ];
    for (const query of invalid) {
      assert.deepEqual(
        await get(service, '/sessions', query),
        { ok: false, code: 'invalid_request' },
        JSON.stringify(query),
      );
    }
  });
});

describe('GET /stats/summary', () => {
  it('resume la biblioteca y la sesión abierta', async () => {
    const { service } = makeService();
    const { hades } = seedWorld(service);
    const stats = await value<StatsSummary>(service, '/stats/summary');
    assert.equal(stats.totalGames, 2);
    assert.equal(stats.totalSessions, 3);
    assert.equal(stats.beaten, 1);
    assert.equal(stats.playing + stats.unplayed + stats.beaten, 2);
    assert.equal(stats.year, 2026);
    assert.equal(stats.hoursThisYear, 0, 'las sesiones de la semilla son de diciembre de 2025');
    assert.equal(stats.live?.gameId, hades);
    assert.equal(stats.live?.since, T0 - HOUR);
  });

  it('las horas del año cuentan las sesiones de este año', async () => {
    const { service, time } = makeService();
    const { celeste } = seedWorld(service);
    time.now = T0 + 10 * 24 * HOUR;
    write(service, (ctx) => {
      const [playthrough] = ctx.db
        .select()
        .from(playthroughs)
        .where(eq(playthroughs.gameId, celeste))
        .all();
      return seedSession(ctx, { playthroughId: playthrough.id, startedAt: new Date(T0 + HOUR) });
    });
    const stats = await value<StatsSummary>(service, '/stats/summary');
    assert.equal(stats.hoursThisYear, 1);
    assert.equal(stats.gamesThisYear, 1);
  });

  it('el año se lee en la zona que pide quien mira; una zona inventada es invalid_request', async () => {
    const { service, time } = makeService();
    seedWorld(service);
    // 31 de diciembre de 2026, 23:30 UTC: en Madrid ya es 2027.
    time.now = Date.UTC(2026, 11, 31, 23, 30);
    assert.equal((await value<StatsSummary>(service, '/stats/summary', { tz: 'UTC' })).year, 2026);
    assert.equal(
      (await value<StatsSummary>(service, '/stats/summary', { tz: 'Europe/Madrid' })).year,
      2027,
    );
    assert.deepEqual(await get(service, '/stats/summary', { tz: 'Marte/Olimpo' }), {
      ok: false,
      code: 'invalid_request',
    });
  });
});

// ---------- F-31: nada de rutas locales ----------

describe('F-31: ninguna respuesta lleva rutas locales', () => {
  const FORBIDDEN_KEYS = [
    'executablePath',
    'installDirectory',
    'installSizeBytes',
    'localInstallDirectory',
    'saveCustomPaths',
    'saveLudusaviName',
  ];

  it('ni las claves ni los valores de ninguna lectura enseñan un PC', async () => {
    const { service } = makeService();
    const ids = seedWorld(service);
    // Una instalación con ruta de verdad: tiene que quedarse en el hub.
    write(service, (ctx) =>
      seedInstall(ctx, {
        gameId: ids.hades,
        executablePath: 'C:\\Users\\inventado\\Games\\Hades\\hades.exe',
        installDirectory: 'D:\\Juegos\\Hades',
      }),
    );
    const paths = [
      '/library',
      '/plan',
      `/games/${ids.celeste}`,
      `/games/${ids.hades}`,
      `/games/${ids.silksong}`,
      `/games/${ids.celeste}/achievements`,
      `/games/${ids.celeste}/curiosities`,
      '/sessions',
      '/stats/summary',
    ];
    for (const path of paths) {
      const json = JSON.stringify(await value(service, path));
      for (const key of FORBIDDEN_KEYS) {
        assert.ok(!json.includes(`"${key}"`), `${path} lleva la clave ${key}`);
      }
      assert.ok(!/[A-Za-z]:\\\\/.test(json), `${path} lleva una ruta de disco`);
      assert.ok(!json.includes('hades.exe'), `${path} lleva un ejecutable`);
      assert.ok(!json.includes('Juegos'), `${path} lleva una carpeta de instalación`);
    }
  });
});

// ---------- Caché por secuencia (§9.7) ----------

/** Cuenta las lecturas que de verdad llegan a las consultas. */
function countReads(service: TenantService): { reads: number } {
  const counter = { reads: 0 };
  const queries = service.queries();
  const original = queries.read.bind(queries);
  queries.read = ((fn) => {
    counter.reads += 1;
    return original(fn);
  }) as typeof queries.read;
  return counter;
}

describe('la caché de las lecturas', () => {
  it('mientras la secuencia no cambie, no se vuelve a leer nada', async () => {
    const { service } = makeService();
    const { celeste } = seedWorld(service);
    const counter = countReads(service);

    const first = await value(service, '/library');
    const second = await value(service, '/library');
    assert.equal(counter.reads, 1);
    assert.deepEqual(second, first);

    await value(service, '/plan');
    await value(service, '/plan');
    await value(service, `/games/${celeste}`);
    await value(service, `/games/${celeste}`);
    await value(service, '/sessions', { limit: '5' });
    await value(service, '/sessions', { limit: '5' });
    await value(service, '/stats/summary');
    await value(service, '/stats/summary');
    assert.equal(counter.reads, 5, 'una lectura por clave distinta');
    // Otra página es otra clave.
    await value(service, '/sessions', { limit: '5', offset: '5' });
    assert.equal(counter.reads, 6);
  });

  it('cuando cambia la secuencia, se recalcula y se ve lo nuevo', async () => {
    const { service } = makeService();
    seedWorld(service);
    const counter = countReads(service);
    const before = await value<LibraryGame[]>(service, '/library');
    await value(service, '/library');
    assert.equal(counter.reads, 1);

    const seqBefore = service.hub.currentSeq();
    write(service, (ctx) => seedGame(ctx, { title: 'Dead Cells' }));
    assert.ok(service.hub.currentSeq() > seqBefore);

    const after = await value<LibraryGame[]>(service, '/library');
    assert.equal(counter.reads, 2);
    assert.equal(after.length, before.length + 1);
    assert.ok(after.some((game) => game.title === 'Dead Cells'));
    // Y vuelve a servirse de la caché con la secuencia nueva.
    await value(service, '/library');
    assert.equal(counter.reads, 2);
  });

  it('un cambio de secuencia invalida TODAS las lecturas, no solo la biblioteca', async () => {
    const { service } = makeService();
    const { hades } = seedWorld(service);
    const counter = countReads(service);
    await value(service, '/plan');
    await value(service, `/games/${hades}`);
    assert.equal(counter.reads, 2);
    write(service, (ctx) => seedGame(ctx, { title: 'Otro' }));
    await value(service, '/plan');
    await value(service, `/games/${hades}`);
    assert.equal(counter.reads, 4);
  });

  it('un error no se guarda: al aparecer el juego, deja de ser not_found', async () => {
    const { service } = makeService();
    assert.deepEqual(await get(service, '/games/abc'), { ok: false, code: 'not_found' });
    const id = write(service, (ctx) => seedGame(ctx, { title: 'Nuevo' }));
    assert.equal((await value<GameDetail>(service, `/games/${id}`)).title, 'Nuevo');
  });

  it('el año de las estadísticas cambia aunque la secuencia no lo haga', async () => {
    const { service, time } = makeService();
    seedWorld(service);
    assert.equal((await value<StatsSummary>(service, '/stats/summary')).year, 2026);
    time.now = Date.UTC(2027, 0, 5);
    assert.equal((await value<StatsSummary>(service, '/stats/summary')).year, 2027);
  });
});

// ---------- Por HTTP ----------

describe('/api/v2 de lectura por el Worker', () => {
  it('entra por el router con Access y devuelve JSON', async () => {
    const world = makeWorld();
    const response = await world.call('/api/v2/library', { email: HOST });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    const missing = await world.call('/api/v2/games/no-existe', { email: HOST });
    assert.equal(missing.status, 404);
    assert.equal(((await missing.json()) as { error: string }).error, 'not_found');
    const bad = await world.call('/api/v2/sessions?limit=0', { email: HOST });
    assert.equal(bad.status, 400);
  });
});
