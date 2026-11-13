import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { and, eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { registry, syncedEntries, type SyncedTableName } from '../../../registry';
import { playthroughs, sessions, stateEvents } from '../../../schema';
import { liveRow, liveSession, liveStateEvent } from '../alive';
import type { QueryContext } from '../context';
import {
  openQueryDb,
  seedCatalog,
  seedEmulator,
  seedGame,
  seedInstall,
  seedPlanEntry,
  seedPlaythrough,
  seedSession,
  seedSpendEvent,
  seedStateEvent,
  seedUnlock,
  tombstoneOnly,
  type QueryFixture,
} from './fixtures';

// La regla F-11 en lectura (§7.7): un hijo cuyo padre (o abuelo) tiene lápida
// se trata como borrado, aunque su propia lápida no haya llegado.

let fx: QueryFixture;
let ctx: QueryContext;
beforeEach(() => {
  fx = openQueryDb();
  ctx = fx.ctx;
});
afterEach(() => fx.close());

/** ¿Ve la condición de la tabla esta fila? */
const visible = (table: SyncedTableName, id: string): boolean => {
  // Todas las tablas sincronizadas tienen `id`; el tipo concreto da igual aquí.
  const t = registry[table].table as typeof playthroughs;
  const condition = (liveRow[table] as () => SQL)();
  return (
    ctx.db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.id, id), condition))
      .all().length === 1
  );
};

/**
 * Un caso por enlace `children` del registro: crea padre e hijo vivos, pone la
 * lápida SOLO al padre y devuelve [tabla hija, id del hijo].
 */
type Scenario = () => [SyncedTableName, string];

const scenarios: Record<string, Scenario> = {
  'games→playthroughs.gameId': () => {
    const gameId = seedGame(ctx, { title: 'Celeste' });
    const id = seedPlaythrough(ctx, { gameId });
    tombstoneOnly(ctx, 'games', gameId);
    return ['playthroughs', id];
  },
  'games→plan_entries.gameId': () => {
    const gameId = seedGame(ctx, { title: 'Hades' });
    const id = seedPlanEntry(ctx, { gameId });
    tombstoneOnly(ctx, 'games', gameId);
    return ['plan_entries', id];
  },
  'games→spend_events.gameId': () => {
    const gameId = seedGame(ctx, { title: 'Hades' });
    const id = seedSpendEvent(ctx, { gameId });
    tombstoneOnly(ctx, 'games', gameId);
    return ['spend_events', id];
  },
  'games→game_installs.gameId': () => {
    const gameId = seedGame(ctx, { title: 'Hades' });
    const id = seedInstall(ctx, { gameId });
    tombstoneOnly(ctx, 'games', gameId);
    return ['game_installs', id];
  },
  'games→achievement_unlocks.gameId': () => {
    const gameId = seedGame(ctx, { title: 'Hades' });
    seedCatalog(ctx, { gameId });
    const id = seedUnlock(ctx, { gameId, apiName: 'ACH_1' });
    tombstoneOnly(ctx, 'games', gameId);
    return ['achievement_unlocks', id];
  },
  'emulators→emulator_installs.emulatorId': () => {
    const emulatorId = seedEmulator(ctx, { name: 'Dolphin' });
    tombstoneOnly(ctx, 'emulators', emulatorId);
    const [install] = ctx.db.$client
      .prepare('SELECT id FROM emulator_installs WHERE emulatorId = ?')
      .all(emulatorId);
    return ['emulator_installs', String(install.id)];
  },
  'emulators→sessions.emulatorId': () => {
    const emulatorId = seedEmulator(ctx, { name: 'PCSX2' });
    const id = seedSession(ctx, { emulatorId });
    tombstoneOnly(ctx, 'emulators', emulatorId);
    return ['sessions', id];
  },
  'playthroughs→state_events.playthroughId': () => {
    const playthroughId = seedPlaythrough(ctx, { gameId: seedGame(ctx, { title: 'Tunic' }) });
    const id = seedStateEvent(ctx, { playthroughId });
    tombstoneOnly(ctx, 'playthroughs', playthroughId);
    return ['state_events', id];
  },
  'playthroughs→sessions.playthroughId': () => {
    const playthroughId = seedPlaythrough(ctx, { gameId: seedGame(ctx, { title: 'Tunic' }) });
    const id = seedSession(ctx, { playthroughId });
    tombstoneOnly(ctx, 'playthroughs', playthroughId);
    return ['sessions', id];
  },
};

describe('F-11: cada enlace del registro tiene su condición', () => {
  const links = syncedEntries.flatMap((entry) =>
    entry.children.map((child) => `${entry.name}→${child.table}.${child.column}`),
  );

  it('hay un caso para cada enlace `children` del registro', () => {
    assert.deepEqual(
      links.filter((link) => !(link in scenarios)),
      [],
    );
  });

  for (const link of links) {
    it(`${link}: el hijo vivo de un padre con lápida no se ve`, () => {
      const scenario = scenarios[link];
      assert.ok(scenario, `falta el caso de ${link}`);
      const [table, id] = scenario();
      assert.equal(visible(table, id), false);
    });
  }
});

describe('F-11: cadenas largas y casos límite', () => {
  it('el abuelo también cuenta: juego borrado → evento y sesión invisibles', () => {
    const gameId = seedGame(ctx, { title: 'Outer Wilds' });
    const playthroughId = seedPlaythrough(ctx, { gameId });
    const eventId = seedStateEvent(ctx, { playthroughId });
    const sessionId = seedSession(ctx, { playthroughId });
    assert.equal(visible('state_events', eventId), true);
    assert.equal(visible('sessions', sessionId), true);

    tombstoneOnly(ctx, 'games', gameId);
    assert.equal(visible('playthroughs', playthroughId), false);
    assert.equal(visible('state_events', eventId), false);
    assert.equal(visible('sessions', sessionId), false);
  });

  it('la sesión YA asignada no depende de su emulador (referencia keep)', () => {
    const emulatorId = seedEmulator(ctx, { name: 'Dolphin' });
    const playthroughId = seedPlaythrough(ctx, { gameId: seedGame(ctx, { title: 'Metroid' }) });
    const sessionId = seedSession(ctx, { playthroughId, emulatorId });
    tombstoneOnly(ctx, 'emulators', emulatorId);
    assert.equal(visible('sessions', sessionId), true);
  });

  it('la lápida propia manda siempre', () => {
    const gameId = seedGame(ctx, { title: 'Celeste' });
    ctx.store.remove('games', gameId);
    assert.equal(visible('games', gameId), false);
  });

  it('las cachés de un juego borrado tampoco se enseñan', () => {
    const gameId = seedGame(ctx, { title: 'Celeste', metadata: { summary: 'x' } });
    assert.equal(visible('game_metadata', gameId), true);
    tombstoneOnly(ctx, 'games', gameId);
    assert.equal(visible('game_metadata', gameId), false);
  });

  it('funciona con la tabla con alias y con el padre unido en la misma consulta', () => {
    const playthroughId = seedPlaythrough(ctx, { gameId: seedGame(ctx, { title: 'Tunic' }) });
    const alive = seedStateEvent(ctx, { playthroughId });
    const s = alias(stateEvents, 'se');
    const rows = ctx.db
      .select({ id: s.id })
      .from(s)
      .innerJoin(playthroughs, eq(playthroughs.id, s.playthroughId))
      .where(liveStateEvent(s))
      .all();
    assert.deepEqual(
      rows.map((row) => row.id),
      [alive],
    );

    const open = seedSession(ctx, { playthroughId, endedAt: null });
    const x = alias(sessions, 'x');
    assert.deepEqual(
      ctx.db
        .select({ id: x.id })
        .from(x)
        .where(liveSession(x))
        .all()
        .map((row) => row.id),
      [open],
    );
  });
});
