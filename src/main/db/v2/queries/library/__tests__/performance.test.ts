import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { isNull } from 'drizzle-orm';
import type { CreateValues } from '../../../store';
import type { SyncedTableName } from '../../../registry';
import { insertSynced, openQueryDb, type QueryFixture } from '../../common/__tests__/fixtures';
import { gameViewRows, viewPlan } from '../../common/gameView';
import { getGameById } from '../getGameById';
import { getGames } from '../getGames';
import { getPlannedGames } from '../getPlannedGames';
import { countWork, type QueryStats } from './helpers';

// EL BANCO GRANDE (riesgo R-18 de CONSULTAS.md §5.2): ¿cuesta la biblioteca
// 2.0 —con la vista del juego y sus uniones (`game_metadata`,
// `game_installs`, `plan_entries`, curiosidades y siete `external_checks`) y
// el `NOT EXISTS` del Plan por fila— mucho más que la 1.x?
//
// Mismo banco que tenía el benchmark de la 1.x (scripts/benchmark-db.ts, ya borrado): 600 juegos (300 de la
// biblioteca y 300 planeados), 3 playthroughs por juego (1.800) con un
// `started` cada uno, y 18.000 sesiones repartidas entre los 900 playthroughs
// de la biblioteca. Además, lo que en la 1.x eran columnas de `games` y en
// 2.0 son filas aparte: la caché de cada juego, la instalación de este PC en
// los de la biblioteca, la entrada del Plan de los planeados y cuatro
// comprobaciones externas por juego (2.400 filas en `external_checks`).
//
// Las aserciones son DETERMINISTAS (resultados, consultas y filas). Los
// tiempos solo se informan (diagnóstico del test), nunca se afirman: un
// assert sobre milisegundos falla en una máquina cargada.

let fx: QueryFixture;
const LIBRARY = 300;
const PLANNED = 300;
const PER_GAME = 3;
const SESSIONS = 18_000;

const gameIds: string[] = [];

before(() => {
  fx = openQueryDb();
  const client = fx.local.db.$client;
  const put = <N extends SyncedTableName>(table: N, values: CreateValues<N>): string =>
    insertSynced(fx.ctx, table, values, 'pcaaaa');
  // Una transacción para sembrar: sin ella, cada INSERT es un commit.
  client.exec('BEGIN');
  const libraryPts: string[] = [];
  for (let g = 0; g < LIBRARY + PLANNED; g++) {
    const planned = g >= LIBRARY;
    const gameId = put('games', {
      title: `Game ${g + 1}`,
      addedAt: new Date(1_700_000_000_000 + g * 60_000),
      saveKey: `k${g}`,
    });
    gameIds.push(gameId);
    put('game_metadata', {
      gameId,
      coverUrl: `https://img/${g}.jpg`,
      genres: ['Action'],
      releaseYear: 2000 + (g % 25),
      hltbMain: 10,
    });
    for (const source of ['igdb', 'igdb_ratings', 'steam_appid', 'hltb'] as const) {
      put('external_checks', {
        gameId,
        source,
        status: 'ok',
        checkedAt: new Date(1_700_000_000_000),
      });
    }
    if (planned) {
      put('plan_entries', { gameId, plannedAt: new Date(1_700_000_000_000) });
    } else {
      put('game_installs', {
        gameId,
        deviceId: fx.ctx.deviceId,
        executablePath: `C:\\Games\\${g}\\game.exe`,
      });
    }
    for (let p = 0; p < PER_GAME; p++) {
      const ptId = put('playthroughs', {
        gameId,
        playedPlatform: 'PC',
        origin: 'steam',
        manualHours: 12.5,
      });
      if (!planned) libraryPts.push(ptId);
      put('state_events', {
        playthroughId: ptId,
        type: 'started',
        occurredAt: new Date('2024-01-01T12:00:00Z'),
        datePrecision: 'datetime',
      });
    }
  }
  for (let s = 0; s < SESSIONS; s++) {
    const startedAt = new Date(1704110400000 + s * 3_600_000);
    put('sessions', {
      playthroughId: libraryPts[s % libraryPts.length],
      deviceId: fx.ctx.deviceId,
      startedBy: 'watcher',
      source: 'measured',
      startedAt,
      endedAt: new Date(startedAt.getTime() + 1_800_000),
      durationSec: 1800,
      datePrecision: 'datetime',
    });
  }
  client.exec('COMMIT');
  client.exec('ANALYZE');
});
after(() => fx.close());

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
};

const time = (fn: () => unknown, runs = 15): number => {
  fn(); // calentamiento: la primera compila las sentencias
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return median(times);
};

it('banco de 300 + 300 juegos y 18.000 sesiones: resultados, trabajo y tiempos', (t) => {
  const work = countWork(fx);
  let stats: Record<string, QueryStats>;
  try {
    const [games, listWork] = work.measure(() => getGames(fx.ctx));
    const detailId = gameIds[100];
    const [detail, detailWork] = work.measure(() => getGameById(fx.ctx, detailId));
    const [planned, plannedWork] = work.measure(() => getPlannedGames(fx.ctx));
    stats = { getGames: listWork, getGameById: detailWork, getPlannedGames: plannedWork };

    // Resultados: los 300 de la biblioteca, todas las sesiones, las horas.
    assert.equal(games.length, LIBRARY);
    assert.equal(
      games.reduce((sum, g) => sum + g.sessionCount, 0),
      SESSIONS,
    );
    // 3 × 12,5 manuales + 20 sesiones de media hora × 3 playthroughs.
    assert.equal(games[0].totalHours, 37.5 + 30);
    assert.ok(games.every((g) => g.executablePath !== null));
    assert.equal(planned.length, PLANNED);
    assert.ok(detail);
    assert.equal(detail.iterations.length, 3);
    assert.equal(
      detail.iterations.reduce((sum, i) => sum + i.sessions.length, 0),
      60,
    );
    assert.equal(detail.totalHours, 67.5);

    // Trabajo: tres consultas; filas = juegos + playthroughs + eventos.
    assert.deepEqual(listWork, { queries: 3, rows: LIBRARY + 2 * LIBRARY * PER_GAME });
    assert.ok(detailWork.queries <= 8);
  } finally {
    work.restore();
  }

  const timings = {
    getGamesMs: time(() => getGames(fx.ctx)),
    // La vista del juego sola (la consulta 1 de getGames), para separar el
    // coste de sus uniones del de los agregados.
    gameViewLibraryMs: time(() => gameViewRows(fx.ctx, isNull(viewPlan.id))),
    getGameByIdMs: time(() => getGameById(fx.ctx, gameIds[100])),
    getPlannedGamesMs: time(() => getPlannedGames(fx.ctx)),
  };
  t.diagnostic(JSON.stringify({ stats, timings }));
});
