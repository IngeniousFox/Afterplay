import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { countLocalPendingChanges, pendingChangesIn } from '../legacyPending';

// La cola CDC de la réplica local, con datos inventados pero con la forma de una
// réplica real de la 1.8: cada transacción deja sus filas y una marca de fin
// (`table_name` nulo).

const CDC =
  'CREATE TABLE turso_cdc (change_id INTEGER PRIMARY KEY, change_type INTEGER, table_name TEXT, id INTEGER)';
const MARKS = 'CREATE TABLE turso_sync_last_change_id (client_id TEXT, change_id INTEGER)';
const META = 'CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT, updatedAt INTEGER)';

const memory = (statements: string[]): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  for (const sql of statements) db.exec(sql);
  return db;
};

// Lo que hay en la cola justo después de una subida: la marca que reescribe el
// replicador y el device_status que la 1.8 publica después, cada uno con su fin.
const bookkeeping = [
  CDC,
  MARKS,
  META,
  "INSERT INTO turso_sync_last_change_id VALUES ('client-old', 22000), ('client-now', 0)",
  "INSERT INTO app_meta (rowid, key, value, updatedAt) VALUES (1, 'device_status:pc-a', '{}', 1)",
  `INSERT INTO turso_cdc VALUES
     (1, 0, 'turso_sync_last_change_id', 2), (2, 2, NULL, NULL),
     (3, 0, 'app_meta', 1), (4, 2, NULL, NULL)`,
];

describe('legacyPending: cambios de la 1.x sin subir', () => {
  it('la contabilidad del sync no cuenta: una réplica al día da 0', () => {
    const db = memory(bookkeeping);
    assert.equal(pendingChangesIn(db), 0);
    db.close();
  });

  it('cuenta las filas de datos aunque una marca vieja sea más alta que toda la cola', () => {
    const db = memory([
      ...bookkeeping,
      `INSERT INTO turso_cdc VALUES
         (5, 1, 'sessions', 40), (6, 0, 'games', 7), (7, 2, NULL, NULL),
         (8, -1, 'notes', 3), (9, 2, NULL, NULL)`,
    ]);
    assert.equal(pendingChangesIn(db), 3);
    db.close();
  });

  it('app_meta que no es device_status sí cuenta, y también una fila de app_meta ya borrada', () => {
    const db = memory([
      ...bookkeeping,
      "INSERT INTO app_meta (rowid, key, value, updatedAt) VALUES (2, 'otra', '{}', 1)",
      "INSERT INTO turso_cdc VALUES (5, 0, 'app_meta', 2), (6, -1, 'app_meta', 99), (7, 2, NULL, NULL)",
    ]);
    assert.equal(pendingChangesIn(db), 2);
    db.close();
  });

  it('sin cola CDC o con otra forma, no se puede saber (null)', () => {
    assert.equal(pendingChangesIn(memory(['CREATE TABLE games (id INTEGER)'])), null);
    assert.equal(pendingChangesIn(memory(['CREATE TABLE turso_cdc (otra TEXT)'])), null);
    assert.equal(
      pendingChangesIn(memory(['CREATE TABLE turso_cdc (change_id INTEGER, id INTEGER)'])),
      null,
    );
  });

  it('countLocalPendingChanges mira una copia: devuelve la cuenta y no toca el original', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'afterplay-cutover-'));
    try {
      const path = join(dir, 'Afterplay.db');
      const db = new DatabaseSync(path);
      db.exec(
        `${CDC};
         INSERT INTO turso_cdc VALUES (1, 1, 'games', 1), (2, 1, 'games', 2), (3, 2, NULL, NULL);`,
      );
      db.close();
      assert.equal(await countLocalPendingChanges(path, join(dir, 'backups')), 2);
      assert.equal(
        await countLocalPendingChanges(join(dir, 'no-existe.db'), join(dir, 'backups')),
        null,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
