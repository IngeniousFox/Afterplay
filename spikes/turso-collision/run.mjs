// Spike S-06 (docs/AFTERPLAY-2.0.md §4.3, F-07 / F-08): ¿qué hace de verdad
// @tursodatabase/sync 0.7.2 cuando dos réplicas escriben sin sincronizar?
//
// Ejecutar desde la raíz del repo:   node spikes/turso-collision/run.mjs
// Opciones:  --keep   no borra .tmp/ al terminar (las tablas remotas SÍ se borran)
//
// Cerrojos (en código, no en la cabeza):
//   · credenciales SOLO de D:\Dev\Afterplay\.env (DATABASE_URL / DATABASE_AUTH_TOKEN);
//     nunca se imprimen.
//   · aborta si el primer segmento del host no empieza por "afterplay-test".
//   · solo crea/lee/borra tablas "spike_f07_*" (assertSpikeTable en cada SQL remoto
//     que nombra tabla); try/finally borra todas y comprueba que no queda ninguna.
//
// Nota honesta: el motor de sync hace bootstrap de la base remota ENTERA en
// cada réplica local (.tmp/*.db). El script no consulta ninguna otra tabla,
// pero los ficheros de .tmp/ sí contienen una copia física de la base de
// pruebas; por eso se borran al final salvo --keep.

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createClient } from '@libsql/client';
import { connect } from '@tursodatabase/sync';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const TMP = join(HERE, '.tmp');
const KEEP = process.argv.includes('--keep');
const PREFIX = 'spike_f07_';

// ---------------------------------------------------------------- credenciales
const readEnvFile = (path) => {
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
};

// Modo --local-server: la base remota NO existe (ver informe) y se usa en su
// lugar el servidor de sync del propio Turso 0.7.2 (tursodb --sync-server),
// escuchando SOLO en 127.0.0.1 y sobre un fichero nuevo en .tmp/. No lee .env.
const LOCAL = process.argv.includes('--local-server');
const PORT = 18765;
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

let URL_;
let TOKEN;
let server = null;
if (LOCAL) {
  URL_ = `http://127.0.0.1:${PORT}`;
  if (new URL(URL_).hostname !== '127.0.0.1') process.exit(2);
  server = spawn('tursodb', ['--sync-server', `127.0.0.1:${PORT}`, join(TMP, 'server.db')], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[tursodb] ${d}`));
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(URL_ + '/v2/pipeline', { method: 'POST', body: '{"requests":[]}' })
      .then(() => true)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('modo --local-server: tursodb --sync-server en 127.0.0.1 (fichero nuevo en .tmp/)');
} else {
  const env = readEnvFile(join(REPO, '.env'));
  URL_ = env.DATABASE_URL;
  TOKEN = env.DATABASE_AUTH_TOKEN;
  if (!URL_ || !TOKEN) {
    console.error('ABORTO: faltan DATABASE_URL o DATABASE_AUTH_TOKEN en .env');
    process.exit(2);
  }
  const firstHostSegment = new URL(URL_).hostname.split('.')[0];
  if (!firstHostSegment.startsWith('afterplay-test')) {
    console.error('ABORTO: el host de DATABASE_URL no empieza por "afterplay-test". No toco esa base.');
    process.exit(2);
  }
  console.log('cerrojo OK: el host empieza por "afterplay-test"');
}

// ---------------------------------------------------------------- utilidades
const assertSpikeTable = (name) => {
  if (!name.startsWith(PREFIX)) throw new Error(`cerrojo: tabla no permitida ${name}`);
  return name;
};

// El sync-server local solo entiende un pipeline mínimo (execute/batch, sin
// "close"), y @libsql/client manda "close": con él falla con 500. Para ese
// modo, cliente hrana mínimo con la misma forma { execute, close }.
const hranaValue = (v) =>
  v === null || v === undefined
    ? { type: 'null' }
    : typeof v === 'number' || typeof v === 'bigint'
      ? Number.isInteger(Number(v))
        ? { type: 'integer', value: String(v) }
        : { type: 'float', value: Number(v) }
      : { type: 'text', value: String(v) };
const fromHrana = (v) =>
  v.type === 'null' ? null : v.type === 'integer' ? Number(v.value) : v.value;
const minimalHrana = {
  async execute(q) {
    const stmt = typeof q === 'string' ? { sql: q } : { sql: q.sql, args: (q.args ?? []).map(hranaValue) };
    const res = await fetch(`${URL_}/v2/pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt }] }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    const r = JSON.parse(text).results[0];
    if (r.type !== 'ok') throw new Error(`hrana error: ${JSON.stringify(r.error ?? r)}`);
    const result = r.response.result;
    const cols = result.cols.map((c) => c.name);
    return {
      rows: result.rows.map((row) => Object.fromEntries(row.map((v, i) => [cols[i], fromHrana(v)]))),
      lastInsertRowid: result.last_insert_rowid == null ? undefined : Number(result.last_insert_rowid),
    };
  },
  close() {},
};
const rawRemote = LOCAL ? minimalHrana : createClient({ url: URL_, authToken: TOKEN });
// La base de pruebas puede estar dormida (502 al despertar): reintento corto.
const remote = {
  async execute(q) {
    let last;
    for (let i = 0; i < 6; i++) {
      try {
        return await rawRemote.execute(q);
      } catch (e) {
        last = e;
        if (!/50[234]|fetch failed|ECONNRESET/i.test(String(e?.message))) throw e;
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
    throw last;
  },
  close: () => rawRemote.close(),
};
const plain = (rows) => rows.map((r) => ({ ...r }));
const rq = async (sql, args = []) => plain((await remote.execute({ sql, args })).rows);

const ALL_TABLES = []; // en orden de creación; se borran al revés
const createTable = async (name, ddl) => {
  assertSpikeTable(name);
  ALL_TABLES.push(name);
  await remote.execute(`CREATE TABLE ${name} (${ddl})`);
};

const errMsg = (e) => {
  const parts = [];
  let cur = e;
  for (let i = 0; i < 4 && cur; i++) {
    parts.push(cur instanceof Error ? `${cur.name}: ${cur.message}` : String(cur));
    cur = cur?.cause;
  }
  return parts.join(' <- ');
};

// fetch instrumentado: registra ruta, estado y, en push, el cuerpo legible
// (solo lleva las mutaciones de NUESTRAS tablas). Nunca registra cabeceras.
const netLog = [];
const loggedFetch = (label) => async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  const path = new URL(url).pathname;
  let bodyText = null;
  if (init?.body) {
    try {
      const b = init.body;
      const txt = typeof b === 'string' ? b : Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString('utf8');
      bodyText = txt.replace(/[^\x20-\x7e]+/g, ' ').slice(0, 12000);
    } catch {
      bodyText = '(no legible)';
    }
  }
  const res = await fetch(input, init);
  const entry = { label, path, status: res.status, body: bodyText };
  if (!res.ok) {
    try {
      entry.response = (await res.clone().text()).slice(0, 800);
    } catch {}
  }
  netLog.push(entry);
  return res;
};

const replicas = [];
const newReplica = async (scen, label) => {
  const path = join(TMP, `${scen}-${label}.db`);
  const db = await connect({
    path,
    url: URL_,
    authToken: TOKEN,
    clientName: `spike-${scen}-${label}`,
    fetch: loggedFetch(`${scen}/${label}`),
  });
  await db.exec('PRAGMA foreign_keys = ON'); // como enableForeignKeys() de la app
  const r = { scen, label, db };
  replicas.push(r);
  return r;
};

const lq = async (r, sql, ...args) => (await r.db.prepare(sql)).all(...args);
const lrun = async (r, sql, ...args) => (await r.db.prepare(sql)).run(...args);

const results = [];
let current = null;
const step = async (desc, fn) => {
  const mark = netLog.length;
  try {
    const v = await fn();
    current.steps.push({ step: desc, ok: true, value: v === undefined ? undefined : v });
  } catch (e) {
    current.steps.push({ step: desc, ok: false, error: errMsg(e) });
  }
  const net = netLog.slice(mark);
  if (net.length) current.steps.at(-1).net = net;
};

const snapshot = async (tables, A, B) => {
  const snap = {};
  for (const t of tables) {
    assertSpikeTable(t);
    const sel = `SELECT * FROM ${t} ORDER BY id`;
    snap[t] = { remote: await rq(sel) };
    for (const r of [A, B]) {
      try {
        snap[t][r.label] = await lq(r, sel);
      } catch (e) {
        snap[t][r.label] = `ERROR ${errMsg(e)}`;
      }
    }
  }
  const seqSel = `SELECT name, seq FROM sqlite_sequence WHERE name IN (${tables.map((t) => `'${t}'`).join(',')}) ORDER BY name`;
  snap.sqlite_sequence = { remote: await rq(seqSel) };
  for (const r of [A, B]) {
    snap.sqlite_sequence[r.label] = await lq(r, seqSel).catch((e) => `ERROR ${errMsg(e)}`);
    snap[`stats_${r.label}`] = await r.db
      .stats()
      .then((s) => ({ cdcOperations: s.cdcOperations }))
      .catch((e) => `ERROR ${errMsg(e)}`);
  }
  return snap;
};

const scenario = async (id, title, fn) => {
  current = { id, title, steps: [] };
  results.push(current);
  console.log(`\n=== ${id}: ${title}`);
  try {
    await fn();
  } catch (e) {
    current.fatal = errMsg(e);
  }
  for (const s of current.steps) {
    console.log(`  ${s.ok ? 'ok ' : 'ERR'} ${s.step}${s.ok ? '' : `\n      -> ${s.error}`}`);
    for (const n of s.net ?? []) {
      console.log(`      [net ${n.label}] ${n.path} ${n.status}${n.response ? ` resp=${n.response}` : ''}`);
      if (n.body && n.body.trim()) console.log(`        body: ${n.body}`);
    }
  }
  if (current.fatal) console.log(`  FATAL: ${current.fatal}`);
  for (const [k, v] of Object.entries(current)) {
    if (k.startsWith('snap')) console.log(`  --- ${k}\n${JSON.stringify(v)}`);
  }
};

const pushPull = async (r, op) => step(`${op} ${r.label}`, () => (op === 'push' ? r.db.push() : r.db.pull()));

// ---------------------------------------------------------------- escenarios
const main = async () => {
  // Restos de una ejecución anterior que muriera antes del finally.
  const leftovers = await rq(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${PREFIX}%'`);
  for (const { name } of leftovers) await remote.execute(`DROP TABLE IF EXISTS ${assertSpikeTable(name)}`);
  if (leftovers.length) console.log(`(borradas ${leftovers.length} tablas de una ejecución anterior)`);

  // Todo el DDL DIRECTO en la remota, como hace la app (pushMigrationsToRemote),
  // ANTES de que las réplicas hagan bootstrap.
  await remote.execute('PRAGMA foreign_keys = ON').catch(() => {});
  for (const s of ['s1', 's2', 's2c', 's6']) {
    await createTable(`${PREFIX}${s}_parent`, 'id integer primary key autoincrement, name text not null');
    await createTable(
      `${PREFIX}${s}_child`,
      `id integer primary key autoincrement, parentId integer not null references ${PREFIX}${s}_parent(id), note text`,
    );
  }
  await createTable(`${PREFIX}s3_game`, 'id integer primary key autoincrement, extId integer not null unique, name text');
  await createTable(
    `${PREFIX}s3_child`,
    `id integer primary key autoincrement, gameId integer not null references ${PREFIX}s3_game(id), note text`,
  );
  await createTable(`${PREFIX}s4_row`, 'id integer primary key autoincrement, a text, b text');
  await createTable(`${PREFIX}s5_row`, 'id integer primary key autoincrement, v text');
  await createTable(`${PREFIX}s5_parent`, 'id integer primary key autoincrement, name text');
  await createTable(
    `${PREFIX}s5_child`,
    `id integer primary key autoincrement, parentId integer not null references ${PREFIX}s5_parent(id), note text`,
  );

  // Semillas (escritas directo en remota, como el Worker).
  await remote.execute(`INSERT INTO ${PREFIX}s2_parent (name) VALUES ('base')`);
  await remote.execute(`INSERT INTO ${PREFIX}s2_child (parentId, note) VALUES (1, 'hijo-de-base')`);
  await remote.execute(`INSERT INTO ${PREFIX}s4_row (a, b) VALUES ('a0','b0'), ('a0','b0')`);
  await remote.execute(`INSERT INTO ${PREFIX}s5_row (v) VALUES ('v0'), ('v0')`);
  await remote.execute(`INSERT INTO ${PREFIX}s5_parent (name) VALUES ('padre-1'), ('padre-2')`);

  const P = (s) => `${PREFIX}${s}_parent`;
  const C = (s) => `${PREFIX}${s}_child`;

  // 1. F-07 básico
  await scenario('E1', 'colisión de id padre/hijo; sube A, sube B, baja A, baja B', async () => {
    const A = await newReplica('e1', 'A');
    const B = await newReplica('e1', 'B');
    await step('A inserta juego-A + hijo', async () => {
      const r = await lrun(A, `INSERT INTO ${P('s1')} (name) VALUES ('juego-A')`);
      await lrun(A, `INSERT INTO ${C('s1')} (parentId, note) VALUES (?, 'hijo-de-A')`, r.lastInsertRowid);
      return { parentId: Number(r.lastInsertRowid) };
    });
    await step('B inserta juego-B + hijo', async () => {
      const r = await lrun(B, `INSERT INTO ${P('s1')} (name) VALUES ('juego-B')`);
      await lrun(B, `INSERT INTO ${C('s1')} (parentId, note) VALUES (?, 'hijo-de-B')`, r.lastInsertRowid);
      return { parentId: Number(r.lastInsertRowid) };
    });
    await pushPull(A, 'push');
    await pushPull(B, 'push');
    await pushPull(A, 'pull');
    await pushPull(B, 'pull');
    current.snapAfterFirstRound = await snapshot([P('s1'), C('s1')], A, B);
    // Segundo ciclo completo, por si algo converge o se atasca.
    await pushPull(A, 'push');
    await pushPull(A, 'pull');
    await pushPull(B, 'push');
    await pushPull(B, 'pull');
    current.snap = await snapshot([P('s1'), C('s1')], A, B);
  });

  // 2. Orden invertido y más filas, con una fila previa común
  await scenario('E2', 'orden invertido (sube B, sube A) y más filas sobre base común', async () => {
    const A = await newReplica('e2', 'A');
    const B = await newReplica('e2', 'B');
    await step('A inserta 3 padres x 2 hijos', async () => {
      const ids = [];
      for (let i = 1; i <= 3; i++) {
        const r = await lrun(A, `INSERT INTO ${P('s2')} (name) VALUES (?)`, `A-juego-${i}`);
        ids.push(Number(r.lastInsertRowid));
        for (let j = 1; j <= 2; j++)
          await lrun(A, `INSERT INTO ${C('s2')} (parentId, note) VALUES (?, ?)`, r.lastInsertRowid, `A-hijo-${i}.${j}`);
      }
      return { parentIds: ids };
    });
    await step('B inserta 2 padres x 1 hijo', async () => {
      const ids = [];
      for (let i = 1; i <= 2; i++) {
        const r = await lrun(B, `INSERT INTO ${P('s2')} (name) VALUES (?)`, `B-juego-${i}`);
        ids.push(Number(r.lastInsertRowid));
        await lrun(B, `INSERT INTO ${C('s2')} (parentId, note) VALUES (?, ?)`, r.lastInsertRowid, `B-hijo-${i}`);
      }
      return { parentIds: ids };
    });
    await pushPull(B, 'push');
    await pushPull(A, 'push');
    await pushPull(B, 'pull');
    await pushPull(A, 'pull');
    current.snapAfterFirstRound = await snapshot([P('s2'), C('s2')], A, B);
    await pushPull(B, 'push');
    await pushPull(B, 'pull');
    await pushPull(A, 'push');
    await pushPull(A, 'pull');
    current.snap = await snapshot([P('s2'), C('s2')], A, B);
  });

  // 2c. Como E2 pero el ÚLTIMO en subir tiene MENOS filas: ¿hijos colgando del padre ajeno?
  await scenario('E2c', 'sube A (3 padres x 2 hijos) y después B (2 padres x 1 hijo)', async () => {
    const A = await newReplica('e2c', 'A');
    const B = await newReplica('e2c', 'B');
    await step('A inserta 3 padres x 2 hijos', async () => {
      for (let i = 1; i <= 3; i++) {
        const r = await lrun(A, `INSERT INTO ${P('s2c')} (name) VALUES (?)`, `A-juego-${i}`);
        for (let j = 1; j <= 2; j++)
          await lrun(A, `INSERT INTO ${C('s2c')} (parentId, note) VALUES (?, ?)`, r.lastInsertRowid, `A-hijo-${i}.${j}`);
      }
    });
    await step('B inserta 2 padres x 1 hijo', async () => {
      for (let i = 1; i <= 2; i++) {
        const r = await lrun(B, `INSERT INTO ${P('s2c')} (name) VALUES (?)`, `B-juego-${i}`);
        await lrun(B, `INSERT INTO ${C('s2c')} (parentId, note) VALUES (?, ?)`, r.lastInsertRowid, `B-hijo-${i}`);
      }
    });
    await pushPull(A, 'push');
    await pushPull(B, 'push');
    await pushPull(A, 'pull');
    await pushPull(B, 'pull');
    current.snap = await snapshot([P('s2c'), C('s2c')], A, B);
  });

  // El ciclo tal como lo hace runSyncCycle (db/index.ts): push y, SOLO si no
  // lanza, pull. Si push lanza, el catch se lo traga y el pull no ocurre.
  const appCycle = async (r) => {
    const before = current.steps.length;
    await pushPull(r, 'push');
    if (current.steps[before].ok) await pushPull(r, 'pull');
    else current.steps.push({ step: `(pull ${r.label} omitido: push falló, como en runSyncCycle)`, ok: true });
  };

  // 3. F-08: UNIQUE natural con ids distintos
  await scenario('E3', 'UNIQUE(extId): mismo extId, ids distintos; 3 ciclos como runSyncCycle y luego pull a mano', async () => {
    const A = await newReplica('e3', 'A');
    const B = await newReplica('e3', 'B');
    const G = `${PREFIX}s3_game`;
    const GC = `${PREFIX}s3_child`;
    await step('A inserta juego extId=42 (id auto) + hijo', async () => {
      const r = await lrun(A, `INSERT INTO ${G} (extId, name) VALUES (42, 'juego-A')`);
      await lrun(A, `INSERT INTO ${GC} (gameId, note) VALUES (?, 'hijo-de-A')`, r.lastInsertRowid);
      return { id: Number(r.lastInsertRowid) };
    });
    await step('B inserta juego extId=42 con id=1000 + hijo id=1000 + otra fila sin conflicto (extId=7, id=1001)', async () => {
      await lrun(B, `INSERT INTO ${G} (id, extId, name) VALUES (1000, 42, 'juego-B')`);
      await lrun(B, `INSERT INTO ${GC} (id, gameId, note) VALUES (1000, 1000, 'hijo-de-B')`);
      await lrun(B, `INSERT INTO ${G} (id, extId, name) VALUES (1001, 7, 'otro-juego-de-B')`);
    });
    for (let cycle = 1; cycle <= 3; cycle++) {
      await appCycle(A);
      await appCycle(B);
      current[`snapCycle${cycle}`] = await snapshot([G, GC], A, B);
    }
    await pushPull(B, 'pull');
    current.snapTrasPullManualDeB = await snapshot([G, GC], A, B);
    await pushPull(B, 'push');
    current.snapTrasPushPosterior = await snapshot([G, GC], A, B);
  });

  // 4. Misma fila actualizada en ambos lados
  await scenario('E4', 'UPDATE concurrente: fila1 columnas distintas, fila2 misma columna; sube A, sube B', async () => {
    const A = await newReplica('e4', 'A');
    const B = await newReplica('e4', 'B');
    const T = `${PREFIX}s4_row`;
    await step('A: fila1 a=A ; fila2 a=A2', async () => {
      await lrun(A, `UPDATE ${T} SET a='A' WHERE id=1`);
      await lrun(A, `UPDATE ${T} SET a='A2' WHERE id=2`);
    });
    await step('B: fila1 b=B ; fila2 a=B2', async () => {
      await lrun(B, `UPDATE ${T} SET b='B' WHERE id=1`);
      await lrun(B, `UPDATE ${T} SET a='B2' WHERE id=2`);
    });
    await pushPull(A, 'push');
    await pushPull(B, 'push');
    await pushPull(A, 'pull');
    await pushPull(B, 'pull');
    current.snap = await snapshot([T], A, B);
  });

  // 5. Borrado en A, edición en B, en los dos órdenes
  await scenario('E5a', 'DELETE fila1 en A vs UPDATE fila1 en B; sube A primero', async () => {
    const T = `${PREFIX}s5_row`;
    const A = await newReplica('e5a', 'A');
    const B = await newReplica('e5a', 'B');
    await step('A: DELETE fila1', () => lrun(A, `DELETE FROM ${T} WHERE id=1`));
    await step('B: UPDATE fila1 v=B1', () => lrun(B, `UPDATE ${T} SET v='B1' WHERE id=1`));
    await pushPull(A, 'push');
    await pushPull(B, 'push');
    await pushPull(A, 'pull');
    await pushPull(B, 'pull');
    current.snap = await snapshot([T], A, B);
  });

  await scenario('E5b', 'DELETE fila2 en A vs UPDATE fila2 en B; sube B primero', async () => {
    const T = `${PREFIX}s5_row`;
    const A = await newReplica('e5b', 'A');
    const B = await newReplica('e5b', 'B');
    await step('A: DELETE fila2', () => lrun(A, `DELETE FROM ${T} WHERE id=2`));
    await step('B: UPDATE fila2 v=B2', () => lrun(B, `UPDATE ${T} SET v='B2' WHERE id=2`));
    await pushPull(B, 'push');
    await pushPull(A, 'push');
    await pushPull(B, 'pull');
    await pushPull(A, 'pull');
    current.snap = await snapshot([T], A, B);
  });

  await scenario('E5c', 'A borra padre-1; B inserta offline un hijo de padre-1 y otra fila suelta; ciclos como runSyncCycle', async () => {
    const A = await newReplica('e5c', 'A');
    const B = await newReplica('e5c', 'B');
    await step('A: DELETE padre-1', () => lrun(A, `DELETE FROM ${P('s5')} WHERE id=1`));
    await step('B: INSERT hijo de padre-1 + INSERT hijo de padre-2', async () => {
      await lrun(B, `INSERT INTO ${C('s5')} (parentId, note) VALUES (1, 'hijo-de-padre-1')`);
      await lrun(B, `INSERT INTO ${C('s5')} (parentId, note) VALUES (2, 'hijo-de-padre-2')`);
    });
    await appCycle(A);
    await appCycle(B);
    await appCycle(B);
    current.snapTrasCiclos = await snapshot([P('s5'), C('s5')], A, B);
    await pushPull(B, 'pull');
    current.snapTrasPullManualDeB = await snapshot([P('s5'), C('s5')], A, B);
  });

  // 6. Tercer escritor: inserción directa en remota (Worker) mientras A está offline
  await scenario('E6', 'Worker inserta directo en remota mientras A inserta offline; sube A', async () => {
    const A = await newReplica('e6', 'A');
    const B = await newReplica('e6', 'B');
    await step('A inserta juego-A + hijo (offline)', async () => {
      const r = await lrun(A, `INSERT INTO ${P('s6')} (name) VALUES ('juego-A')`);
      await lrun(A, `INSERT INTO ${C('s6')} (parentId, note) VALUES (?, 'hijo-de-A')`, r.lastInsertRowid);
    });
    await step('Worker (SQL directo a la remota) inserta juego-W + hijo', async () => {
      await remote.execute(`INSERT INTO ${P('s6')} (name) VALUES ('juego-W')`);
      const [{ id }] = await rq(`SELECT id FROM ${P('s6')} WHERE name='juego-W'`);
      await remote.execute({ sql: `INSERT INTO ${C('s6')} (parentId, note) VALUES (?, 'hijo-de-W')`, args: [id] });
      return { workerParentId: id };
    });
    await pushPull(A, 'push');
    await pushPull(A, 'pull');
    await pushPull(B, 'pull');
    current.snap = await snapshot([P('s6'), C('s6')], A, B);
  });
};

// ---------------------------------------------------------------- ejecución
let exitCode = 0;
try {
  await main();
} catch (e) {
  exitCode = 1;
  console.error('FALLO en main:', errMsg(e));
} finally {
  for (const r of replicas) await r.db.close().catch(() => {});
  for (const t of [...ALL_TABLES].reverse()) {
    try {
      await remote.execute(`DROP TABLE IF EXISTS ${assertSpikeTable(t)}`);
    } catch (e) {
      exitCode = 1;
      console.error(`no se pudo borrar ${t}:`, errMsg(e));
    }
  }
  const left = await rq(`SELECT name FROM sqlite_master WHERE name LIKE '${PREFIX}%'`).catch((e) => {
    exitCode = 1;
    console.log(`\nLIMPIEZA NO VERIFICABLE (la remota no responde): ${errMsg(e)}`);
    return null;
  });
  const leftSeq = await rq(`SELECT name FROM sqlite_sequence WHERE name LIKE '${PREFIX}%'`).catch(() => null);
  if (left) {
    console.log(
      `\nLIMPIEZA: objetos ${PREFIX}* en sqlite_master de la remota = ${left.length}; filas en sqlite_sequence = ${leftSeq ? leftSeq.length : '?'}`,
    );
  }
  if (left?.length) {
    exitCode = 1;
    console.log('  quedan:', left.map((x) => x.name).join(', '));
  }
  remote.close();
  if (server) {
    server.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!KEEP) rmSync(TMP, { recursive: true, force: true });
  console.log(`.tmp/ ${existsSync(TMP) ? 'conservado (--keep)' : 'borrado'}`);
  process.exitCode = exitCode;
}
