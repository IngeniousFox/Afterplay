import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { BOTTOM, isDeviceShortId, parseClock } from '../../../../shared/sync/clock';
import { maxStoredClock, randomShortDeviceId } from '../connection';
import { localSyncState } from '../schema';
import {
  LOCAL,
  MIGRATIONS_FOLDER,
  T0,
  count,
  fakeWall,
  insertSynced,
  openTestDb,
  rawRow,
  seedBasics,
  sqliteError,
  tempDir,
} from './helpers';
import { openLocalDatabase } from '../connection';

// Conexión local 2.0 (§8.9): migrador, PRAGMA, id corto del reloj y arranque
// del reloj por encima de la base (§8.2).

const dirs: { cleanup: () => void }[] = [];
after(() => {
  for (const dir of dirs) dir.cleanup();
});

const newFile = (): string => {
  const dir = tempDir();
  dirs.push(dir);
  return join(dir.path, 'Afterplay2.db');
};

describe('conexión 2.0: migrador', () => {
  it('migra una base vacía en memoria y deja todas las tablas', () => {
    const local = openTestDb();
    try {
      const tables = local.db.$client
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'",
        )
        .get();
      assert.equal(tables?.n, 24);
      assert.equal(count(local, '__drizzle_migrations'), 1);
    } finally {
      local.close();
    }
  });

  it('reabrir un fichero ya migrado no vuelve a migrar ni pierde datos', () => {
    const path = newFile();
    const first = openTestDb({ path });
    seedBasics(first.store);
    first.close();

    const second = openTestDb({ path });
    try {
      assert.equal(count(second, '__drizzle_migrations'), 1);
      assert.equal(count(second, 'games'), 1);
      assert.equal(count(second, 'devices'), 2);
    } finally {
      second.close();
    }
  });

  it('fija WAL, claves foráneas, synchronous FULL y busy_timeout en un fichero', () => {
    const local = openTestDb({ path: newFile() });
    try {
      const get = (name: string): unknown =>
        Object.values(local.db.$client.prepare(`PRAGMA ${name}`).get() ?? {})[0];
      assert.equal(get('journal_mode'), 'wal');
      assert.equal(get('foreign_keys'), 1);
      assert.equal(get('synchronous'), 2);
      assert.equal(get('busy_timeout'), 5000);
    } finally {
      local.close();
    }
  });

  it('las claves foráneas siguen activas para las escrituras normales', () => {
    const local = openTestDb();
    try {
      seedBasics(local.store);
      assert.throws(
        () =>
          local.store.create('playthroughs', {
            gameId: 'no-existe',
            playedPlatform: 'PC',
            origin: 'Steam',
          }),
        sqliteError(/FOREIGN KEY constraint failed/),
      );
      assert.equal(count(local, 'playthroughs'), 1);
    } finally {
      local.close();
    }
  });

  it('rechaza un deviceId con ":" (rompería los ids compuestos)', () => {
    assert.throws(
      () =>
        openLocalDatabase({
          path: ':memory:',
          deviceId: 'a:b',
          migrationsFolder: MIGRATIONS_FOLDER,
        }),
      /deviceId inválido/,
    );
  });

  it('una carpeta de migraciones inexistente falla y no deja la conexión abierta', () => {
    const path = newFile();
    assert.throws(() =>
      openLocalDatabase({ path, deviceId: LOCAL, migrationsFolder: 'no-existe' }),
    );
    // Si la conexión siguiera abierta, en Windows el fichero quedaría
    // bloqueado; reabrirlo y migrar de verdad debe funcionar.
    const local = openTestDb({ path });
    local.close();
  });

  it('close es idempotente', () => {
    const local = openTestDb();
    local.close();
    local.close();
  });
});

describe('conexión 2.0: id corto del reloj', () => {
  it('se sortea la primera vez, con el formato de §8.2, y se conserva al reabrir', () => {
    const path = newFile();
    const first = openTestDb({ path });
    const id = first.shortDeviceId;
    first.close();
    assert.ok(isDeviceShortId(id));
    assert.notEqual(id, '000000');

    const second = openTestDb({ path });
    try {
      assert.equal(second.shortDeviceId, id);
      assert.equal(second.clock.dev, id);
    } finally {
      second.close();
    }
  });

  it('si lo guardado no es válido (o es el reservado) se sortea otro', () => {
    const path = newFile();
    const first = openTestDb({ path });
    first.db
      .update(localSyncState)
      .set({ shortDeviceId: '000000' })
      .where(eq(localSyncState.id, 1))
      .run();
    first.close();
    const second = openTestDb({ path });
    try {
      assert.notEqual(second.shortDeviceId, '000000');
      assert.ok(isDeviceShortId(second.shortDeviceId));
    } finally {
      second.close();
    }
  });

  it('el sorteo usa todo el alfabeto y nunca el id reservado', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = randomShortDeviceId();
      assert.ok(isDeviceShortId(id) && id !== '000000');
      for (const char of id) seen.add(char);
    }
    assert.equal(seen.size, 36);
  });
});

describe('conexión 2.0: arranque del reloj (§8.2)', () => {
  it('sin filas el máximo es BOTTOM y el reloj sigue al de pared', () => {
    const local = openTestDb();
    try {
      assert.equal(maxStoredClock(local.db), BOTTOM);
      assert.equal(parseClock(local.clock.now()).ms, T0);
    } finally {
      local.close();
    }
  });

  it('al reabrir un fichero arranca por encima del mayor reloj, aunque sea futuro', () => {
    const path = newFile();
    const first = openTestDb({ path });
    const { gameId } = seedBasics(first.store);
    // Una fila restaurada de una copia hecha con un reloj adelantado (o
    // llegada por sync): su reloj va una hora por delante del de pared.
    const future = `${T0 + 3_600_000}-0007-zzzzzz`;
    insertSynced(first, 'plan_entries', { id: gameId, gameId, plannedAt: T0 }, future);
    first.close();

    const second = openTestDb({ path, wall: fakeWall(T0).wall });
    try {
      assert.equal(maxStoredClock(second.db), future);
      const next = second.clock.now();
      assert.ok(next > future, `${next} debería superar ${future}`);
      // Y una escritura sobre esa fila no falla por "reloj no posterior".
      const { changed } = second.store.patch('plan_entries', gameId, { note: 'restaurada' });
      assert.deepEqual(changed, ['note']);
      assert.ok(String(rawRow(second, 'plan_entries', gameId)?.syncUpdated) > future);
    } finally {
      second.close();
    }
  });

  it('el máximo considera las lápidas (viven en syncUpdated)', () => {
    const local = openTestDb();
    try {
      const { gameId } = seedBasics(local.store);
      local.store.remove('games', gameId);
      const tombstone = String(rawRow(local, 'games', gameId)?.syncDeleted);
      assert.equal(maxStoredClock(local.db), tombstone);
    } finally {
      local.close();
    }
  });

  it('un reloj corrupto en la base hace fallar la apertura en vez de arrastrar el reloj', () => {
    const local = openTestDb();
    try {
      insertSynced(local, 'emulators', { id: 'emu', name: 'x' }, '9999999999999-9999-zzzzzz-roto');
      assert.throws(() => maxStoredClock(local.db), /reloj mal formado/);
    } finally {
      local.close();
    }
  });
});
