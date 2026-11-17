import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { countLocalPendingChanges, pendingChangesIn } from '../legacyPending';

// La cola CDC de la réplica local, con datos inventados. Los nombres de las
// tablas del replicador son los supuestos de `legacyPending.ts`.

const memory = (statements: string[]): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  for (const sql of statements) db.exec(sql);
  return db;
};

describe('legacyPending: cambios de la 1.x sin subir', () => {
  it('cuenta las filas de la cola por encima de la marca de lo subido', () => {
    const db = memory([
      'CREATE TABLE turso_cdc (change_id INTEGER PRIMARY KEY, payload TEXT)',
      'CREATE TABLE turso_sync_last_change_id (change_id INTEGER)',
      "INSERT INTO turso_cdc VALUES (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd')",
      'INSERT INTO turso_sync_last_change_id VALUES (2)',
    ]);
    assert.equal(pendingChangesIn(db), 2);
    db.close();
  });

  it('sin marca de lo subido, toda la cola está pendiente', () => {
    const db = memory([
      'CREATE TABLE turso_cdc (change_id INTEGER PRIMARY KEY)',
      'INSERT INTO turso_cdc VALUES (1), (2)',
    ]);
    assert.equal(pendingChangesIn(db), 2);
    db.close();
  });

  it('sin cola CDC o con otra forma, no se puede saber (null)', () => {
    assert.equal(pendingChangesIn(memory(['CREATE TABLE games (id INTEGER)'])), null);
    assert.equal(pendingChangesIn(memory(['CREATE TABLE turso_cdc (otra TEXT)'])), null);
    assert.equal(
      pendingChangesIn(
        memory([
          'CREATE TABLE turso_cdc (change_id INTEGER)',
          'CREATE TABLE turso_sync_last_change_id (rara TEXT)',
        ]),
      ),
      null,
    );
  });

  it('countLocalPendingChanges mira una copia: devuelve la cuenta y no toca el original', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'afterplay-cutover-'));
    try {
      const path = join(dir, 'Afterplay.db');
      const db = new DatabaseSync(path);
      db.exec(
        `CREATE TABLE turso_cdc (change_id INTEGER PRIMARY KEY);
         INSERT INTO turso_cdc VALUES (1), (2), (3);`,
      );
      db.close();
      assert.equal(await countLocalPendingChanges(path, join(dir, 'backups')), 3);
      assert.equal(
        await countLocalPendingChanges(join(dir, 'no-existe.db'), join(dir, 'backups')),
        null,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
