import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { BOTTOM, MAX_AHEAD_MS, parseClock } from '../../../src/shared/sync/clock';
import { CLOCK_AHEAD_MESSAGE } from '../../../src/main/sync/engine';
import { applyRefreshGameResult } from '../../../src/main/db/v2/queries/external/refreshGame';
import { readExternalSnapshot } from '../../../src/main/db/v2/queries/external/snapshot';
import { addSpendEvent } from '../../../src/main/db/v2/queries/playthroughs/spend';
import { closeSession } from '../../../src/main/db/v2/queries/sessions/close';
import { seedGame } from '../../../src/main/db/v2/queries/common/__tests__/fixtures';
import { syncTables } from '../../../src/main/sync/tables';
import {
  addGame,
  detail,
  gameIdForIgdb,
  libraryIds,
  libraryTitles,
  openSession,
  play,
  removeGame,
  setCoverOverride,
  setNotes,
  visibleSessions,
} from '../actions';
import { FUTURE_COLUMN, FUTURE_TABLE, futureHubTables } from '../futureHub';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  RawDevice,
  World,
  convergenceProblems,
  version,
} from '../harness';

// Escenarios de aceptación de §17.3 que corresponden a la fase 3 (sync y hub).
// Cada uno monta un hub real y clientes reales (ver `harness.ts`); el
// "Resultado exigido" se comprueba con las consultas de lectura de la 2.0
// (`getGames`, `getGameById`, `getAllSessions`) y, además, que todas las bases
// acaben idénticas al hub.

let world: World | null = null;

const start = (options?: ConstructorParameters<typeof World>[0]): World => {
  world = new World(options);
  return world;
};

afterEach(() => {
  world?.close();
  world = null;
});

/** Sincroniza hasta aquietar y exige bases idénticas al hub, sin pendientes ni fallos del hub. */
async function settle(w: World): Promise<void> {
  await w.quiesce();
  assert.deepEqual(convergenceProblems(w), []);
}

const countRows = (w: World, table: string): number => w.hubRows(table).size;

describe('E-03: A y B crean offline una sesión cada uno, de juegos distintos', () => {
  it('existen las dos, cada una colgando de su juego', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const g1 = addGame(a, 101, { title: 'Hollow Heart' });
    const g2 = addGame(a, 102, { title: 'Celeste Moon' });
    await settle(w);
    assert.deepEqual(libraryIds(b).sort(), [g1, g2].sort());

    a.cut();
    b.cut();
    const sessionA = play(w, a, g1, 45);
    w.advance(5 * MINUTE_MS);
    const sessionB = play(w, b, g2, 90);
    assert.ok(sessionA && sessionB);
    await a.sync(); // sin red: no pasa nada, nada se pierde
    assert.equal(a.results.at(-1)?.status, 'error');
    a.restore();
    b.restore();
    await settle(w);

    for (const client of [a, b]) {
      const sessions = visibleSessions(client);
      assert.equal(sessions.length, 2, `${client.name} ve las dos sesiones`);
      assert.equal(sessions.find((s) => s.id === sessionA)?.gameId, g1);
      assert.equal(sessions.find((s) => s.id === sessionB)?.gameId, g2);
      // La ficha de cada juego también las ve colgando de su juego.
      const sessionsOf = (id: string): string[] =>
        (detail(client, id)?.iterations ?? []).flatMap((it) => it.sessions.map((s) => s.id));
      assert.deepEqual(sessionsOf(g1), [sessionA]);
      assert.deepEqual(sessionsOf(g2), [sessionB]);
    }
    // Cada sesión conserva su dueño y su duración propia.
    const hub = w.hubRows('sessions');
    assert.equal(hub.size, 2);
    assert.equal(hub.get(sessionA!)?.fields.deviceId, a.deviceId);
    assert.equal(hub.get(sessionB!)?.fields.deviceId, b.deviceId);
    assert.equal(hub.get(sessionA!)?.fields.durationSec, 45 * 60);
    assert.equal(hub.get(sessionB!)?.fields.durationSec, 90 * 60);
  });
});

describe('E-04: A y B añaden offline el mismo juego de IGDB', () => {
  it('una sola fila de juego; los playthroughs de ambos cuelgan de ella', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    await settle(w);
    a.cut();
    b.cut();
    const idA = addGame(a, 20001, { title: 'Silksong', gameNotes: 'apuntes que escribió A' });
    w.advance(MINUTE_MS);
    const idB = addGame(b, 20001, { title: 'Silksong', gameNotes: null });
    assert.equal(idA, idB, 'el id sale del igdbId, no del PC (§7.2)');
    assert.equal(idA, gameIdForIgdb(20001));
    a.restore();
    b.restore();
    await settle(w);

    assert.equal(countRows(w, 'games'), 1, 'una sola fila de juego en el hub');
    for (const client of [a, b]) {
      assert.deepEqual(
        libraryIds(client),
        [idA],
        `${client.name}: una sola entrada en la biblioteca`,
      );
      const game = detail(client, idA);
      assert.ok(game);
      assert.equal(
        game.iterations.length,
        2,
        `${client.name}: los dos playthroughs cuelgan del juego`,
      );
      assert.equal(
        new Set(game.iterations.map((it) => it.id)).size,
        2,
        'dos playthroughs distintos (ids aleatorios)',
      );
      // El alta de B no pisó con "nada" lo que escribió A (BOTTOM, §8.3).
      assert.equal(game.notes, 'apuntes que escribió A');
    }
    const playthroughs = [...w.hubRows('playthroughs').values()];
    assert.equal(playthroughs.length, 2);
    assert.ok(playthroughs.every((p) => p.fields.gameId === idA));
    assert.equal(countRows(w, 'devices'), 2);
  });
});

describe('E-05: A edita las notas de un juego; B refresca su carátula, ambos offline', () => {
  it('se conservan los dos cambios (campos distintos de la MISMA fila de games)', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const id = addGame(a, 20002, { title: 'Hades Redux' });
    await settle(w);

    a.cut();
    b.cut();
    setNotes(a, id, 'Notas de A: probar la build de escudo');
    w.advance(MINUTE_MS);
    setCoverOverride(b, id, 'https://covers.invented/hades-b.jpg');
    a.restore();
    b.restore();
    await settle(w);

    for (const client of [a, b]) {
      const game = detail(client, id);
      assert.equal(game?.notes, 'Notas de A: probar la build de escudo');
      assert.equal(game?.coverUrl, 'https://covers.invented/hades-b.jpg');
    }
  });

  it('también con el refresco externo: la caché (game_metadata) y las notas conviven', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const id = addGame(a, 20003, { title: 'Dredge Deep', enrichment: { hltbMain: 10 } });
    await settle(w);

    a.cut();
    b.cut();
    setNotes(a, id, 'A anota algo');
    w.advance(MINUTE_MS);
    const snapshot = readExternalSnapshot(b.ctx, id);
    assert.ok(snapshot);
    const outcome = applyRefreshGameResult(b.ctx, snapshot, {
      hltb: { hltbMain: 14, hltbMainExtras: 20, hltbCompletionist: 30 },
    });
    assert.equal(outcome.status, 'applied');
    a.restore();
    b.restore();
    await settle(w);

    for (const client of [a, b]) {
      const game = detail(client, id);
      assert.equal(game?.notes, 'A anota algo');
      assert.equal(game?.hltbMain, 14);
    }
  });
});

describe('E-06: A borra un juego; B, offline, le añade una sesión', () => {
  it('el juego queda borrado y la sesión no aparece; nada falla (playthrough ya sincronizado)', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const id = addGame(a, 20004, { title: 'Pizza Tower' });
    const keep = addGame(a, 20005, { title: 'Se queda' });
    await settle(w);

    a.cut();
    b.cut();
    assert.ok(removeGame(a, id));
    const session = play(w, b, id, 20);
    assert.ok(session, 'B todavía ve el juego y puede jugar');
    a.restore();
    b.restore();
    await settle(w);

    for (const client of [a, b]) {
      assert.deepEqual(libraryIds(client), [keep], `${client.name}: el juego borrado no está`);
      assert.equal(detail(client, id), null);
      assert.deepEqual(visibleSessions(client), [], `${client.name}: la sesión no aparece`);
    }
    // Ningún ciclo falló.
    for (const client of [a, b]) {
      assert.ok(
        client.results.every((r) => r.status === 'ok' || r.error?.code === 'network'),
        `${client.name}: ${JSON.stringify(client.results.map((r) => r.status))}`,
      );
    }
    // El hub conserva la sesión (fila viva con padre borrado): la regla F-11 es de lectura.
    assert.equal(w.hubRows('games').get(id)?.fields.syncDeleted != null, true);
    assert.equal(w.hubRows('sessions').get(session)?.fields.syncDeleted, null);
  });

  it('el juego no tenía playthrough sincronizado: B crea playthrough y sesión bajo un juego borrado', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const id = seedGame(a.ctx, { title: 'Sin playthrough' });
    await settle(w);

    a.cut();
    b.cut();
    assert.ok(removeGame(a, id));
    const session = play(w, b, id, 15);
    assert.ok(session);
    a.restore();
    b.restore();
    await settle(w);

    for (const client of [a, b]) {
      assert.deepEqual(libraryTitles(client), []);
      assert.equal(detail(client, id), null);
      assert.deepEqual(visibleSessions(client), []);
    }
    assert.equal(countRows(w, 'playthroughs'), 1, 'el playthrough de B existe pero está oculto');
  });

  it('B tenía la sesión abierta cuando llega el borrado; cerrarla después no falla', async () => {
    const w = start();
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const id = addGame(a, 20006, { title: 'Sesión abierta' });
    await settle(w);

    b.cut();
    const sessionId = openSession(b, id);
    assert.ok(sessionId);
    assert.ok(removeGame(a, id));
    await a.syncOk();
    b.restore();
    await b.syncOk();
    await a.syncOk();

    // El watcher de B cierra la sesión que ya no existe para el usuario.
    w.advance(30 * MINUTE_MS);
    assert.doesNotThrow(() =>
      closeSession(b.ctx, sessionId, { endedAt: b.ctx.now(), closedBy: 'owner' }),
    );
    await settle(w);
    for (const client of [a, b]) {
      assert.deepEqual(libraryIds(client), []);
      assert.deepEqual(visibleSessions(client), []);
    }
  });
});

describe('E-14: B tiene una versión anterior de la app (esquema menor)', () => {
  // QUÉ CUBRE: el hub está en el esquema 2 (columna `games.futureNote` y tabla
  // `future_things` que los clientes de este build no tienen) y un dispositivo
  // "nuevo" (RawDevice, solo protocolo) las usa. Los clientes REALES A y B,
  // con el esquema 1 de este build, hacen de "versión anterior".
  // QUÉ NO CUBRE: el cliente no tiene seam para inyectar formas de tabla
  // (`syncTables` sale del registro), así que no hay un cliente real con DOS
  // formas distintas; el lado "nuevo" es un emisor de filas en tránsito.
  it('sincroniza lo que entiende y no pierde ni corrompe lo que no', async () => {
    const w = start({ hub: { tables: futureHubTables(), maxSchema: 2 } });
    const a = await w.addClient('a');
    const b = await w.addClient('b');
    const fresh = new RawDevice(w, 'nuevo', 2);
    await fresh.enroll();

    const id = addGame(a, 20007, { title: 'Juego compartido' });
    await a.syncOk();
    w.advance(MINUTE_MS); // que sus relojes no empaten con el de creación del juego

    // El PC nuevo escribe la columna futura, una columna conocida y una fila de una tabla futura.
    const clock = fresh.tick();
    const pushed = await fresh.push([
      {
        table: 'games',
        id,
        created: clock,
        deleted: null,
        fields: { [FUTURE_COLUMN]: 'dato del futuro', notes: 'notas del PC nuevo' },
        clocks: { [FUTURE_COLUMN]: clock, notes: clock },
      },
      {
        table: FUTURE_TABLE,
        id: 'cosa-1',
        created: fresh.tick(),
        deleted: null,
        fields: { label: 'etiqueta futura' },
        clocks: { label: fresh.tick() },
      },
    ]);
    assert.deepEqual(pushed.rejected, []);

    // B (versión anterior) baja todo: entiende el juego, ignora lo demás.
    const down = await b.syncOk();
    assert.ok(down.pulled >= 2, 'recibe también la fila de la tabla desconocida');
    assert.equal(detail(b, id)?.notes, 'notas del PC nuevo');
    const tables = b.local.db.$client
      .prepare(`SELECT name FROM sqlite_master WHERE name = ?`)
      .all(FUTURE_TABLE);
    assert.equal(tables.length, 0, 'B no crea la tabla que no conoce');
    assert.equal(
      Object.hasOwn(b.raw('games', id) ?? {}, FUTURE_COLUMN),
      false,
      'ni la columna que no conoce',
    );

    // B edita lo suyo (más tarde) y sube la fila SIN la columna futura.
    w.advance(MINUTE_MS);
    setNotes(b, id, 'notas de B, versión anterior');
    const second = addGame(b, 20008, { title: 'Creado por B' });
    await b.syncOk();

    const hubGame = w.hubRaw('games', id);
    assert.equal(hubGame?.[FUTURE_COLUMN], 'dato del futuro', 'el hub conserva la columna futura');
    assert.equal(hubGame?.notes, 'notas de B, versión anterior', 'y recibe la edición de B');
    const stored = JSON.parse(String(hubGame?.syncFields)) as Record<string, string>;
    assert.equal(stored[FUTURE_COLUMN], clock, 'con su reloj original');
    // Una fila nacida en B (que no conoce la columna) la tiene vacía con reloj BOTTOM (§8.3).
    const hubSecond = w.hubRaw('games', second);
    assert.equal(hubSecond?.[FUTURE_COLUMN], null);
    assert.equal(JSON.parse(String(hubSecond?.syncFields))[FUTURE_COLUMN], BOTTOM);
    assert.equal(w.hubRaw(FUTURE_TABLE, 'cosa-1')?.label, 'etiqueta futura');

    // El PC nuevo sigue viendo su dato y gana a ese BOTTOM en la fila de B.
    const later = fresh.tick();
    await fresh.push([
      {
        table: 'games',
        id: second,
        created: later,
        deleted: null,
        fields: { [FUTURE_COLUMN]: 'puesto después' },
        clocks: { [FUTURE_COLUMN]: later },
      },
    ]);
    assert.equal(w.hubRaw('games', second)?.[FUTURE_COLUMN], 'puesto después');

    await a.syncOk();
    await b.syncOk();
    assert.equal(detail(a, id)?.notes, 'notas de B, versión anterior');
    assert.deepEqual(convergenceProblems(w), [], 'las columnas que B entiende convergen');
    // La app se actualiza a la versión del hub: vuelve a bajar todo desde cero (§8.7).
    b.upgrade(2);
    const upgraded = await b.syncOk();
    assert.equal(upgraded.reset, 'schema_changed');
    assert.equal(upgraded.applied, 0, 'la fusión es idempotente: no cambia nada');
    assert.deepEqual(convergenceProblems(w), []);
  });
});

describe('un cliente por delante del hub (§8.7)', () => {
  it('el ciclo da hub_behind y se reintenta, no pide actualizar la app; al desplegar el hub sigue', async () => {
    const w = start({ hub: { maxSchema: 1 } });
    const a = await w.addClient('a', { schemaVersion: 1 });
    await a.syncOk();
    a.upgrade(2); // la app se actualiza antes de que se despliegue el hub
    const result = await a.sync();
    assert.equal(result.status, 'error');
    assert.equal(result.retry, true);
    assert.equal(result.error?.code, 'hub_behind');
    assert.equal(a.syncState().blockedMinSchema, null);
  });
});

describe('E-15: B está por debajo del mínimo admitido', () => {
  it('deja de sincronizar, sigue en local, lo avisa; al actualizarse vuelve', async () => {
    const w = start({ hub: { maxSchema: 2 } });
    const a = await w.addClient('a', { schemaVersion: 2 });
    const b = await w.addClient('b', { schemaVersion: 1 });
    const shared = addGame(a, 20009, { title: 'Antes del corte' });
    await settle(w);

    // El hub sube el mínimo (cambio incompatible).
    w.hub.setMinSchema(2);

    const own = addGame(b, 20010, { title: 'Solo en B' });
    const blocked = await b.sync();
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.retry, false);
    assert.equal(blocked.error?.code, 'schema_too_old');
    assert.equal(blocked.minSchema, 2);
    assert.match(blocked.error?.message ?? '', /actualiza Afterplay/);
    // Lo deja guardado para la interfaz.
    const state = b.syncState();
    assert.equal(state.blockedMinSchema, 2);
    assert.equal(state.lastErrorCode, 'schema_too_old');
    assert.match(state.lastError ?? '', /actualiza Afterplay/);

    // Sigue en local: lee y escribe con normalidad.
    assert.deepEqual(libraryTitles(b), ['Antes del corte', 'Solo en B']);
    assert.ok(play(w, b, shared, 10));
    assert.ok(b.dirtyCount() > 0);

    // No vuelve a molestar al hub mientras siga bloqueado.
    const callsBefore = b.transport.calls.length;
    const again = await b.sync();
    assert.equal(again.status, 'blocked');
    assert.equal(b.transport.calls.length, callsBefore, 'ni una sola petición más');

    // Nada de B llegó al hub ni a A (nunca escribe a ciegas, F-15).
    await a.syncOk();
    assert.equal(w.hubRows('games').has(own), false);
    assert.deepEqual(libraryTitles(a), ['Antes del corte']);

    // Se actualiza: se desbloquea, sube lo acumulado y converge.
    b.upgrade(2);
    const resumed = await b.syncOk();
    assert.ok(resumed.pushed > 0);
    assert.equal(b.syncState().blockedMinSchema, null);
    await settle(w);
    assert.deepEqual(libraryTitles(a), ['Antes del corte', 'Solo en B']);
  });
});

describe('E-23: el reloj de A está adelantado un día', () => {
  it('el hub rechaza sus cambios y A lo muestra; no "gana siempre"', async () => {
    const w = start();
    const a = await w.addClient('a', { skewMs: DAY_MS });
    const b = await w.addClient('b');
    const id = addGame(b, 20011, { title: 'Reloj de B' });
    await b.syncOk();
    // Bajar no depende del reloj, pero la fila de su propio dispositivo ya viaja con él.
    const first = await a.sync();
    assert.equal(first.status, 'clock_ahead');
    assert.ok(first.applied > 0, 'aun así recibe lo de los demás');

    // A edita con su reloj adelantado y B edita después, en tiempo real.
    setNotes(a, id, 'A, un día en el futuro');
    const ownGame = addGame(a, 20012, { title: 'Creado por A' });
    w.advance(HOUR_MS);
    setNotes(b, id, 'B, hora correcta');

    const rejected = await a.sync();
    assert.equal(rejected.status, 'clock_ahead');
    assert.equal(rejected.retry, true);
    assert.equal(rejected.error?.message, CLOCK_AHEAD_MESSAGE);
    assert.ok(rejected.rejected.length > 0);
    assert.ok(rejected.rejected.every((r) => r.reason === 'clock_ahead'));
    assert.equal(rejected.pushed, 0);
    assert.equal(a.syncState().lastErrorCode, 'clock_ahead', 'queda guardado para mostrarlo');
    assert.equal(a.syncState().lastError, CLOCK_AHEAD_MESSAGE);
    assert.ok(a.dirtyCount() > 0, 'sus cambios siguen pendientes');

    await b.syncOk();
    // El hub no aceptó nada de A.
    assert.equal(w.hubRows('games').has(ownGame), false);
    assert.equal(w.hubRows('games').get(id)?.fields.notes, 'B, hora correcta');
    // Y ningún reloj del hub supera su hora más la tolerancia.
    const limit = w.hubTime.now + MAX_AHEAD_MS;
    for (const table of syncTables) {
      for (const row of w.hubRows(table.name).values()) {
        for (const clock of [row.created, ...Object.values(row.clocks)]) {
          assert.ok(parseClock(clock).ms <= limit, `${table.name}/${row.id}: ${clock}`);
        }
      }
    }
  });

  it('al corregir la hora, A se recupera, sube lo pendiente y su día de adelanto no pesa', async () => {
    const w = start();
    const a = await w.addClient('a', { skewMs: DAY_MS });
    const b = await w.addClient('b');
    const id = addGame(b, 20013, { title: 'Reloj corregido' });
    await b.syncOk();
    assert.ok((await a.sync()).applied > 0);
    setNotes(a, id, 'A, escrito con el reloj adelantado');
    assert.equal((await a.sync()).status, 'clock_ahead');

    // El usuario corrige la hora del sistema.
    a.wall.set(w.hubTime.now);
    const recovered = await a.syncOk();
    assert.equal(recovered.clockRecovered, true);
    assert.ok(recovered.pushed > 0);
    await b.syncOk();
    assert.equal(detail(b, id)?.notes, 'A, escrito con el reloj adelantado');

    // Una edición POSTERIOR de B gana: el reloj adelantado de A ya no domina.
    w.advance(MINUTE_MS);
    setNotes(b, id, 'B, después');
    await settle(w);
    assert.equal(detail(a, id)?.notes, 'B, después');
    assert.equal(w.hubRows('games').get(id)?.fields.notes, 'B, después');
  });

  it('un adelanto dentro de la tolerancia (5 min) no molesta', async () => {
    const w = start();
    const a = await w.addClient('a', { skewMs: 5 * MINUTE_MS });
    const g = addGame(a, 20014, { title: 'Casi en hora' });
    const result = await a.syncOk();
    assert.deepEqual(result.rejected, []);
    assert.ok(w.hubRows('games').has(g));
  });
});

describe('E-24: hub vacío; un PC con todos los datos sincroniza', () => {
  /** Una vida de datos realista en un solo PC. */
  function populate(w: World, client: Awaited<ReturnType<World['addClient']>>): void {
    const g1 = addGame(client, 30001, { title: 'Uno', gameNotes: 'notas del uno' });
    const g2 = addGame(client, 30002, { title: 'Dos' });
    const g3 = addGame(client, 30003, { title: 'Borrado' });
    const g4 = seedGame(client.ctx, { title: 'Del Plan', planned: true });
    play(w, client, g1, 50);
    play(w, client, g1, 20);
    play(w, client, g2, 75);
    openSession(client, g2);
    addSpendEvent(client.ctx, {
      gameId: g1,
      type: 'purchase',
      amount: 19.99,
      datePrecision: 'day',
    });
    setCoverOverride(client, g2, 'https://covers.invented/dos.jpg');
    removeGame(client, g3);
    assert.ok(g4);
  }

  it('el hub queda completo: mismas filas (lápidas incluidas) con los mismos relojes', async () => {
    const w = start();
    const a = await w.addClient('a');
    populate(w, a);
    assert.equal(w.hubSeq(), 0);

    const result = await a.syncOk();
    assert.equal(a.dirtyCount(), 0);
    let total = 0;
    for (const table of syncTables) total += a.rows(table.name).size;
    assert.equal(result.pushed, total, 'se subió cada fila una vez');
    assert.equal(w.hubSeq(), total, 'una secuencia por fila');
    assert.deepEqual(convergenceProblems(w), []);

    // Un PC nuevo que se empareja después recibe todo y ve lo mismo que A.
    const c = await w.addClient('c');
    await settle(w);
    assert.deepEqual(libraryTitles(c), libraryTitles(a));
    assert.deepEqual(visibleSessions(c), visibleSessions(a));
    assert.deepEqual(libraryTitles(a), ['Dos', 'Uno']);
  });

  it('el hub se pierde y se recrea vacío: A lo vuelve a subir todo', async () => {
    const w = start();
    const a = await w.addClient('a');
    populate(w, a);
    await a.syncOk();
    const before = new Map(syncTables.map((t) => [t.name, a.rows(t.name).size]));

    w.replaceHub(); // otro hubId, sin filas ni tokens
    await a.enroll(); // el PC vuelve a emparejarse (§9.3)
    const result = await a.syncOk();
    assert.equal(result.reset, 'new_hub');
    for (const table of syncTables) {
      assert.equal(w.hubRows(table.name).size, before.get(table.name), table.name);
    }
    assert.deepEqual(convergenceProblems(w), []);
  });

  it('el hub sube de época sin perder nada: A resube todo y no cambia nada', async () => {
    const w = start();
    const a = await w.addClient('a');
    populate(w, a);
    await a.syncOk();
    const seq = w.hubSeq();

    w.hub.bumpEpoch();
    const result = await a.syncOk();
    assert.equal(result.reset, 'new_hub');
    assert.ok(result.pushed > 0);
    assert.equal(w.hubSeq(), seq, 'subir lo ya conocido no mueve la secuencia (§8.4)');
    assert.deepEqual(convergenceProblems(w), []);
  });
});

describe('alta de varios PCs con el secreto de la migración (§9.3, §19.6)', () => {
  it('B y C se emparejan con el secreto que emitió A, bajan todo y convergen con tokens propios', async () => {
    const w = start();
    const a = await w.addClient('a');
    addGame(a, 20101, { title: 'Hades' });
    addGame(a, 20102, { title: 'Celeste' });
    await a.syncOk();

    const { secret } = await w.hub.createEnrollmentSecret();
    const b = await w.addClient('b', { enroll: false });
    const c = await w.addClient('c', { enroll: false });
    await b.enrollWithSecret(secret);
    await c.enrollWithSecret(secret);
    await b.syncOk();
    await c.syncOk();

    assert.deepEqual(libraryTitles(b), ['Celeste', 'Hades']);
    assert.deepEqual(libraryTitles(c), ['Celeste', 'Hades']);
    const tokens = w.storage.exec(
      'SELECT COUNT(*) AS n FROM device_tokens WHERE revokedAt IS NULL',
    );
    assert.equal(tokens[0].n, 3, 'un token vivo por PC');
    // Una segunda vuelta: cada PC baja la fila de dispositivo de los que llegaron después.
    await a.syncOk();
    await b.syncOk();
    await c.syncOk();
    assert.deepEqual(convergenceProblems(w), []);
  });

  it('un secreto sustituido deja fuera a quien llega tarde, que tiene que pedir el nuevo', async () => {
    const w = start();
    const old = await w.hub.createEnrollmentSecret();
    const fresh = await w.hub.createEnrollmentSecret();
    const late = await w.addClient('late', { enroll: false });
    await assert.rejects(late.enrollWithSecret(old.secret), /enroll_code_invalid|desconocido/);
    await late.enrollWithSecret(fresh.secret);
    assert.equal(late.enrolled, true);
  });
});

// Evita que el linter marque `version` como no usado si se retira un escenario.
void version;
