import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { TenantHub } from '../../core/hub';
import { DoSqlStorage, splitStatements, type DoStorageLike } from '../src/do/sqlStorage';

/**
 * Doble de `ctx.storage` con la forma de Cloudflare: `sql.exec` devuelve un
 * cursor con `toArray()`, y `transactionSync` es anidable y NO deja pasar
 * BEGIN/SAVEPOINT escritos a mano (se hace con un contador, como un DO).
 * Va sobre node:sqlite.
 */
function fakeDoStorage(): {
  storage: DoStorageLike;
  log: string[];
  db: DatabaseSync;
} {
  const db = new DatabaseSync(':memory:');
  const log: string[] = [];
  let depth = 0;
  const storage: DoStorageLike = {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        log.push(query);
        if (/^\s*(BEGIN|SAVEPOINT|COMMIT|ROLLBACK)\b/i.test(query)) {
          throw new Error('un DO no admite transacciones escritas a mano');
        }
        // Una sentencia por llamada, como con parámetros en la API real.
        const rows = db
          .prepare(query)
          .all(...(bindings as never[]))
          .map((row) => ({ ...row })) as Record<string, unknown>[];
        return { toArray: () => rows };
      },
    },
    transactionSync<T>(closure: () => T): T {
      const outer = depth === 0;
      if (outer) db.exec('BEGIN');
      depth++;
      try {
        const result = closure();
        depth--;
        if (outer) db.exec('COMMIT');
        return result;
      } catch (error) {
        depth--;
        if (outer) db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { storage, log, db };
}

describe('splitStatements', () => {
  it('parte por ; respetando comillas y comentarios', () => {
    assert.deepEqual(
      splitStatements(`CREATE TABLE a (x TEXT DEFAULT 'a;b'); -- ; fuera
        /* ; */ CREATE TABLE "b;c" (y);
        CREATE INDEX i ON a (x)`),
      [
        `CREATE TABLE a (x TEXT DEFAULT 'a;b')`,
        `CREATE TABLE "b;c" (y)`,
        `CREATE INDEX i ON a (x)`,
      ],
    );
    assert.deepEqual(splitStatements('  ;; '), []);
  });
});

describe('DoSqlStorage', () => {
  it('exec pasa parámetros y devuelve las filas del cursor', () => {
    const { storage } = fakeDoStorage();
    const sql = new DoSqlStorage(storage);
    sql.execScript('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER); CREATE INDEX t_v ON t (v);');
    sql.exec('INSERT INTO t (k, v) VALUES (?, ?)', 'a', 1);
    assert.deepEqual(sql.exec('SELECT k, v FROM t WHERE k = ?', 'a'), [{ k: 'a', v: 1 }]);
  });

  it('execScript ejecuta una sentencia por llamada', () => {
    const { storage, log } = fakeDoStorage();
    new DoSqlStorage(storage).execScript('CREATE TABLE a (x); CREATE TABLE b (y);');
    assert.deepEqual(log, ['CREATE TABLE a (x)', 'CREATE TABLE b (y)']);
  });

  it('transactionSync se anida, devuelve el valor y deshace si lanza', () => {
    const { storage } = fakeDoStorage();
    const sql = new DoSqlStorage(storage);
    sql.execScript('CREATE TABLE t (n INTEGER)');
    const value = sql.transactionSync(() => {
      sql.exec('INSERT INTO t VALUES (1)');
      return sql.transactionSync(() => {
        sql.exec('INSERT INTO t VALUES (2)');
        return 'ok';
      });
    });
    assert.equal(value, 'ok');
    assert.throws(() =>
      sql.transactionSync(() => {
        sql.exec('INSERT INTO t VALUES (3)');
        throw new Error('boom');
      }),
    );
    assert.deepEqual(sql.exec('SELECT n FROM t ORDER BY n'), [{ n: 1 }, { n: 2 }]);
  });

  it('el núcleo del hub funciona sobre el adaptador (esquema, emparejado, estado)', async () => {
    const { storage, log } = fakeDoStorage();
    const hub = new TenantHub(new DoSqlStorage(storage), () => 1_700_000_000_000, {
      tenantId: 'abc123',
    });
    const { code } = await hub.createEnrollmentCode({ ttlMinutes: 10 });
    assert.match(code, /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    assert.equal(hub.listTokens().length, 0);
    assert.ok(log.length > 10);
    // Reabrir sobre el mismo almacenamiento no rompe (ensureSchema idempotente).
    new TenantHub(new DoSqlStorage(storage), () => 1_700_000_000_000, { tenantId: 'abc123' });
  });
});
