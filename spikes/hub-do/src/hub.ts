// TenantHub del spike: UN Durable Object con SQLite, Drizzle encima y las
// mismas definiciones de tabla que el "escritorio" (src/schema.ts).
import { DurableObject } from 'cloudflare:workers';
import { asc, eq, getTableColumns, gt, inArray } from 'drizzle-orm';
import { drizzle, type DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';
import migrations from '../drizzle/hub/migrations.js';
import { syncedTables, tableOrder, tenantMeta, type SyncedTableName } from './hub-schema';
import { buildLibrary } from './library';
import { mergeRow, type StoredRow } from './merge';
import { syntheticRows, type TransitRow } from './synthetic';

// ---------- Contador de filas leídas/escritas ----------
// Cada `sql.exec` devuelve un SqlStorageCursor con rowsRead/rowsWritten (lo que
// se factura). Envolvemos ctx.storage.sql para recoger TODOS los cursores que
// abre Drizzle y sumarlos al final de cada operación.
class Meter {
  cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
  reset() {
    this.cursors = [];
  }
  totals() {
    let rowsRead = 0;
    let rowsWritten = 0;
    for (const c of this.cursors) {
      rowsRead += c.rowsRead;
      rowsWritten += c.rowsWritten;
    }
    return { rowsRead, rowsWritten, statements: this.cursors.length };
  }
}

function meteredStorage(storage: DurableObjectStorage, meter: Meter): DurableObjectStorage {
  const sqlProxy = new Proxy(storage.sql, {
    get(target, prop) {
      if (prop === 'exec')
        return (query: string, ...bindings: unknown[]) => {
          const cursor = target.exec(query, ...bindings);
          meter.cursors.push(cursor);
          return cursor;
        };
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return {
    sql: sqlProxy,
    transactionSync: <T>(fn: () => T) => storage.transactionSync(fn),
  } as unknown as DurableObjectStorage;
}

const MAX_PARAMS = 100; // límite documentado de la API SQL de los DO
const MAX_CLOCK_SKEW_MS = 10 * 60_000;

type Env = Record<string, unknown>;

export class TenantHub extends DurableObject<Env> {
  meter = new Meter();
  db: DrizzleSqliteDODatabase;
  migrationInfo: unknown = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(meteredStorage(ctx.storage, this.meter));
    // Migraciones dentro del DO, antes de atender ninguna petición.
    ctx.blockConcurrencyWhile(async () => {
      this.migrationInfo = this.runMigrations();
    });
  }

  runMigrations() {
    this.meter.reset();
    const t0 = performance.now();
    migrate(this.db, migrations);
    const exists = this.db.select().from(tenantMeta).where(eq(tenantMeta.key, 'main')).get();
    if (!exists) this.db.insert(tenantMeta).values({ key: 'main', seq: 0, createdAt: Date.now() }).run();
    return { ...this.meter.totals(), serverMs: performance.now() - t0 };
  }

  measure<T>(fn: () => T): T & { meter: ReturnType<Meter['totals']>; serverMs: number } {
    this.meter.reset();
    const t0 = performance.now();
    const out = fn();
    return { ...(out as object), meter: this.meter.totals(), serverMs: performance.now() - t0 } as never;
  }

  async measureAsync<T extends object>(fn: () => Promise<T>) {
    this.meter.reset();
    const t0 = performance.now();
    const out = await fn();
    return { ...out, meter: this.meter.totals(), serverMs: performance.now() - t0 };
  }

  // ---------- push: upsert con fusión y secuencia, en UNA transacción ----------
  applyBatch(rows: TransitRow[], opts: { multiRowInsert?: boolean } = {}) {
    const now = Date.now();
    const rejected: { id: string; reason: string }[] = [];
    let accepted = 0;
    let unchanged = 0;

    const seq = this.db.transaction((tx) => {
      let seq = tx.select().from(tenantMeta).where(eq(tenantMeta.key, 'main')).get()!.seq;
      const byTable = new Map<SyncedTableName, TransitRow[]>();
      for (const r of rows) {
        const skew = Math.max(
          Number(r.created.slice(0, 13)),
          ...Object.values(r.clocks).map((c) => Number(c.slice(0, 13))),
        );
        if (skew > now + MAX_CLOCK_SKEW_MS) {
          rejected.push({ id: r.id, reason: 'clock_ahead' });
          continue;
        }
        if (!(r.table in syncedTables)) {
          rejected.push({ id: r.id, reason: 'unknown_table' });
          continue;
        }
        const list = byTable.get(r.table) ?? [];
        list.push(r);
        byTable.set(r.table, list);
      }

      for (const tableName of tableOrder) {
        const list = byTable.get(tableName);
        if (!list) continue;
        const table = syncedTables[tableName];
        const nCols = Object.keys(getTableColumns(table)).length;
        // Leer las existentes en trozos: inArray con >100 ids revienta el límite de parámetros.
        const existing = new Map<string, StoredRow>();
        for (let i = 0; i < list.length; i += MAX_PARAMS - 1) {
          const ids = list.slice(i, i + MAX_PARAMS - 1).map((r) => r.id);
          for (const row of tx.select().from(table).where(inArray(table.id, ids)).all())
            existing.set(row.id, row as unknown as StoredRow);
        }
        const inserts: Record<string, unknown>[] = [];
        for (const r of list) {
          const m = mergeRow(existing.get(r.id), r);
          if (!m) {
            unchanged++;
            continue;
          }
          seq++;
          accepted++;
          m.values.syncSeq = seq;
          if (m.kind === 'insert') {
            if (opts.multiRowInsert) inserts.push(m.values);
            else tx.insert(table).values(m.values as never).run();
            existing.set(r.id, { ...(m.values as StoredRow) });
          } else {
            tx.update(table).set(m.values as never).where(eq(table.id, r.id)).run();
          }
        }
        // Inserción multi-fila: filas por sentencia = floor(100 / columnas).
        const perStmt = Math.max(1, Math.floor(MAX_PARAMS / nCols));
        for (let i = 0; i < inserts.length; i += perStmt)
          tx.insert(table).values(inserts.slice(i, i + perStmt) as never).run();
      }
      tx.update(tenantMeta).set({ seq }).where(eq(tenantMeta.key, 'main')).run();
      return seq;
    });
    return { accepted, unchanged, rejected: rejected.length, rejectedSample: rejected.slice(0, 3), seq };
  }

  // ---------- pull: filas con syncSeq > since, en orden global, paginado ----------
  pull(since: number, limit: number) {
    const page: (TransitRow & { seq: number })[] = [];
    let more = false;
    for (const tableName of tableOrder) {
      const table = syncedTables[tableName];
      const rows = this.db
        .select()
        .from(table)
        .where(gt(table.syncSeq, since))
        .orderBy(asc(table.syncSeq))
        .limit(limit + 1)
        .all() as unknown as (StoredRow & { syncSeq: number })[];
      if (rows.length > limit) more = true;
      for (const r of rows) {
        const { id, syncCreated, syncUpdated, syncFields, syncDeleted, syncDirty, syncSeq, ...fields } = r;
        page.push({
          table: tableName,
          id,
          created: syncCreated,
          deleted: syncDeleted,
          fields,
          clocks: JSON.parse(syncFields),
          seq: syncSeq,
        });
      }
    }
    page.sort((a, b) => a.seq - b.seq);
    if (page.length > limit) more = true;
    const rows = page.slice(0, limit);
    return { rows, next: rows.length ? rows[rows.length - 1].seq : since, more };
  }

  stats() {
    const counts: Record<string, number> = {};
    for (const t of tableOrder)
      counts[t] = Number(this.ctx.storage.sql.exec(`select count(*) as n from "${t}"`).one().n);
    const seq = this.ctx.storage.sql.exec(`select seq from tenant_meta where key='main'`).one().seq;
    return { counts, seq, databaseSize: this.ctx.storage.sql.databaseSize };
  }

  // ---------- sondas de límites de la API SQL ----------
  async limits(only: string | null) {
    const sql = this.ctx.storage.sql;
    const out: Record<string, unknown> = {};
    // Las sondas de FK pueden RESETEAR el DO: solo se ejecutan si se piden por nombre.
    const tryIt = (name: string, fn: () => unknown) => {
      if (only ? !only.split(',').includes(name) : name.startsWith('fk_')) return;
      try {
        out[name] = { ok: true, value: fn() };
      } catch (e) {
        out[name] = { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
      }
    };
    const params = (n: number) => () =>
      sql.exec(`select ${Array.from({ length: n }, () => '?').join('+')} as s`, ...Array(n).fill(1)).one().s;
    tryIt('expr_depth_100', params(100));
    tryIt('expr_depth_101', params(101));
    const inList = (n: number) => () =>
      sql.exec(`select count(*) as c from games where id in (${Array(n).fill('?').join(',')})`, ...Array.from({ length: n }, (_, i) => `x${i}`)).one().c;
    tryIt('params_in_100', inList(100));
    tryIt('params_in_101', inList(101));
    tryIt('params_in_999', inList(999));
    const stmt = (bytes: number) => () => {
      const head = 'select 1 as x /*';
      const body = 'x'.repeat(bytes - head.length - 2);
      return sql.exec(`${head}${body}*/`).one().x;
    };
    tryIt('stmt_100000_bytes', stmt(100_000));
    tryIt('stmt_100001_bytes', stmt(100_001));
    tryIt('stmt_102400_bytes', stmt(102_400));
    tryIt('stmt_102401_bytes', stmt(102_401));
    tryIt('stmt_200000_bytes', stmt(200_000));
    tryIt('exec_BEGIN', () => sql.exec('BEGIN TRANSACTION').toArray());
    tryIt('exec_SAVEPOINT', () => sql.exec('SAVEPOINT sp1').toArray());
    tryIt('pragma_foreign_keys', () => sql.exec('PRAGMA foreign_keys').toArray());
    tryIt('multi_statement_exec', () =>
      sql.exec('create temp table if not exists _t(a); insert into _t values (1); select count(*) as n from _t').one(),
    );
    // FK: hijo sin padre fuera de transacción
    tryIt('fk_violation_immediate', () => {
      const c = sql.exec(
        `insert into playthroughs (id, syncCreated, syncUpdated, gameId) values ('fk-probe-pt','0','0','no-such-game')`,
      );
      sql.exec(`delete from playthroughs where id='fk-probe-pt'`);
      return { rowsWritten: c.rowsWritten };
    });
    // FK: hijo antes que padre DENTRO de transactionSync con defer_foreign_keys
    tryIt('fk_child_before_parent_deferred', () =>
      this.ctx.storage.transactionSync(() => {
        sql.exec('PRAGMA defer_foreign_keys = ON');
        sql.exec(
          `insert into playthroughs (id, syncCreated, syncUpdated, gameId) values ('fk-probe-pt2','0','0','fk-probe-game')`,
        );
        sql.exec(
          `insert into games (id, syncCreated, syncUpdated, title, addedAt) values ('fk-probe-game','0','0','probe',0)`,
        );
        sql.exec(`delete from playthroughs where id='fk-probe-pt2'`);
        sql.exec(`delete from games where id='fk-probe-game'`);
        return 'committed';
      }),
    );
    tryIt('fk_child_without_parent_deferred_commit', () =>
      this.ctx.storage.transactionSync(() => {
        sql.exec('PRAGMA defer_foreign_keys = ON');
        sql.exec(
          `insert into playthroughs (id, syncCreated, syncUpdated, gameId) values ('fk-probe-pt3','0','0','missing')`,
        );
        return 'committed?!';
      }),
    );
    out.fk_probe_leftover = sql.exec(`select count(*) as n from playthroughs where id like 'fk-probe%'`).one().n;
    // transactionSync con callback async
    if (!only) try {
      const r = this.ctx.storage.transactionSync((async () => {
        sql.exec('select 1');
      }) as never);
      out.transactionSync_async_callback = { ok: true, returned: Object.prototype.toString.call(r) };
      await r;
    } catch (e) {
      out.transactionSync_async_callback = { ok: false, error: String((e as Error).message ?? e).slice(0, 300) };
    }
    // Drizzle: inArray con 150 ids -> 150 parámetros
    tryIt('drizzle_inArray_150_ids', () =>
      this.db
        .select({ id: syncedTables.games.id })
        .from(syncedTables.games)
        .where(inArray(syncedTables.games.id, Array.from({ length: 150 }, (_, i) => `x${i}`)))
        .all().length,
    );
    // Plan de consulta del pull: ¿usa el índice parcial de syncSeq?
    tryIt('explain_pull_achievements', () =>
      sql
        .exec('explain query plan select * from achievements where syncSeq > ? order by syncSeq limit 500', 0)
        .toArray()
        .map((r) => r.detail),
    );
    tryIt('explain_library_events', () =>
      sql
        .exec(
          `explain query plan select p.gameId, e.type from state_events e join playthroughs p on e.playthroughId = p.id join games g on p.gameId = g.id where g.syncDeleted is null and p.syncDeleted is null and e.syncDeleted is null`,
        )
        .toArray()
        .map((r) => r.detail),
    );
    // ¿Avanza el reloj dentro del DO en local? (en producción no, salvo E/S)
    const t0 = performance.now();
    let x = 0;
    for (let i = 0; i < 5_000_000; i++) x += i % 7;
    out.timer_advances_during_cpu = { busyLoopMs: performance.now() - t0, x };
    return out;
  }

  // Alternativa: catálogo de logros AGRUPADO (una fila por juego con JSON).
  // Tabla solo de experimento; se crea y se borra aquí.
  groupedAchievementsExperiment() {
    const sql = this.ctx.storage.sql;
    sql.exec('drop table if exists exp_achievement_catalogs');
    sql.exec(
      `create table exp_achievement_catalogs (id text primary key, syncCreated text not null, syncUpdated text not null, syncFields text not null default '{}', syncDeleted text, syncDirty integer not null default 0, syncSeq integer, gameId text not null, items text not null)`,
    );
    sql.exec('create index exp_ac_seq on exp_achievement_catalogs(syncSeq) where syncSeq is not null');
    sql.exec('create index exp_ac_dirty on exp_achievement_catalogs(syncDirty) where syncDirty = 1');
    const byGame = new Map<string, unknown[]>();
    for (const r of syntheticRows('achievements')) {
      const g = r.fields.gameId as string;
      const list = byGame.get(g) ?? [];
      const { gameId: _g, ...rest } = r.fields;
      list.push(rest);
      byGame.set(g, list);
    }
    let rowsWritten = 0;
    let bytes = 0;
    let seq = 1_000_000;
    this.ctx.storage.transactionSync(() => {
      for (const [g, items] of byGame) {
        const json = JSON.stringify(items);
        bytes += json.length;
        rowsWritten += sql.exec(
          `insert into exp_achievement_catalogs (id, syncCreated, syncUpdated, gameId, items, syncSeq) values (?,?,?,?,?,?)`,
          g,
          '0000000000000-0000-dev001',
          '0000000000000-0000-dev001',
          g,
          json,
          ++seq,
        ).rowsWritten;
      }
    });
    // Coste de "refrescar" UN juego (reescribir su JSON entero)
    const [g0, items0] = byGame.entries().next().value!;
    const upd = sql.exec(
      `update exp_achievement_catalogs set items = ?, syncSeq = ? where id = ?`,
      JSON.stringify(items0),
      ++seq,
      g0,
    );
    const sizeWith = this.ctx.storage.sql.databaseSize;
    sql.exec('drop table exp_achievement_catalogs');
    return {
      groupedRows: byGame.size,
      rowsWritten,
      jsonBytes: bytes,
      avgJsonBytes: Math.round(bytes / byGame.size),
      oneGameRefresh: { rowsWritten: upd.rowsWritten, itemsInGame: items0.length },
      databaseSizeWithTable: sizeWith,
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /stats':
          return json({ ...this.stats(), migrationAtStartup: this.migrationInfo });
        case 'POST /reset': {
          await this.ctx.storage.deleteAll();
          const migration = this.runMigrations();
          return json({ migration, ...this.stats() });
        }
        case 'POST /seed': {
          // Siembra generada DENTRO del DO, por lotes de `batch`, tabla a tabla.
          const batch = Number(url.searchParams.get('batch') ?? 500);
          const multi = url.searchParams.get('multi') === '1';
          const perTable: Record<string, unknown> = {};
          for (const t of tableOrder) {
            this.meter.reset();
            const t0 = performance.now();
            let buf: TransitRow[] = [];
            let rows = 0;
            let batches = 0;
            let rr = 0;
            let rw = 0;
            const flush = () => {
              this.meter.reset();
              this.applyBatch(buf, { multiRowInsert: multi });
              const m = this.meter.totals();
              rr += m.rowsRead;
              rw += m.rowsWritten;
              rows += buf.length;
              batches++;
              buf = [];
            };
            for (const r of syntheticRows(t)) {
              buf.push(r);
              if (buf.length >= batch) flush();
            }
            if (buf.length) flush();
            perTable[t] = {
              rows,
              batches,
              rowsRead: rr,
              rowsWritten: rw,
              writtenPerRow: +(rw / rows).toFixed(2),
              serverMs: performance.now() - t0,
            };
          }
          return json({ batch, multiRowInsert: multi, perTable, ...this.stats() });
        }
        case 'POST /push': {
          const body = (await req.json()) as { rows: TransitRow[]; multiRowInsert?: boolean };
          return json(this.measure(() => this.applyBatch(body.rows, { multiRowInsert: body.multiRowInsert })));
        }
        case 'GET /pull': {
          const since = Number(url.searchParams.get('since') ?? 0);
          const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 5000);
          return json(this.measure(() => this.pull(since, limit)));
        }
        case 'GET /library': {
          const r = await this.measureAsync(() => buildLibrary(this.db));
          const full = url.searchParams.get('full') === '1';
          return json(full ? r : { ...r, games: r.games.slice(0, 3), gamesTotal: r.games.length });
        }
        case 'POST /limits':
          return json(await this.limits(url.searchParams.get('only')));
        case 'POST /experiment/grouped-achievements':
          return json(this.groupedAchievementsExperiment());
        default:
          return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      const err = e as Error & { cause?: Error };
      return json({ error: String(err.message).slice(0, 500), cause: String(err.cause?.message ?? '') }, 500);
    }
  }
}
