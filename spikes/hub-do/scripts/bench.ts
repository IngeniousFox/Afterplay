// Banco de medidas contra `wrangler dev` LOCAL (http://127.0.0.1:8799).
// Uso: (con el servidor arrancado) ..\..\node_modules\.bin\tsx scripts/bench.ts
// Escribe results/bench-<fecha>.json y un resumen por consola.
import { mkdirSync, writeFileSync } from 'node:fs';
import { clock, gameId, playthroughId, syntheticRows, type TransitRow } from '../src/synthetic';
import { tableOrder } from '../src/schema';

const BASE = process.env.HUB_URL ?? 'http://127.0.0.1:8799';
const TENANT = `bench-${Date.now()}`; // DO nuevo por ejecución
// Perfil "cloud": para no pasar de 100.000 filas escritas/día en el plan gratuito.
// BENCH_ACH_LIMIT=5000 BENCH_CLOUD=1 -> ~36k escrituras (sin siembras internas ni experimento).
const ACH_LIMIT = Number(process.env.BENCH_ACH_LIMIT ?? Infinity);
const CLOUD = process.env.BENCH_CLOUD === '1';
// Secreto compartido (cabecera x-spike-key). Solo por variable de entorno; nunca se imprime ni se guarda.
const KEY = process.env.HUB_KEY ?? '';
// Tope de seguridad de filas escritas (cupo diario compartido con producción).
const WRITE_BUDGET = Number(process.env.BENCH_WRITE_BUDGET ?? 41_000);
let writtenSoFar = 0;
const opLog: { op: string; path: string; clientMs: number; rowsRead: number; rowsWritten: number; reqBytes: number; resBytes: number; at: string }[] = [];
type Meter = { rowsRead: number; rowsWritten: number; statements: number };

async function call(method: string, path: string, body?: unknown, op = '') {
  if (writtenSoFar > WRITE_BUDGET) throw new Error(`presupuesto de escrituras agotado (${writtenSoFar} > ${WRITE_BUDGET})`);
  const sep = path.includes('?') ? '&' : '?';
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const t0 = performance.now();
  const at = new Date().toISOString();
  const res = await fetch(`${BASE}${path}${sep}tenant=${TENANT}${op ? `&op=${op}` : ''}`, {
    method,
    body: payload,
    headers: { ...(payload ? { 'content-type': 'application/json' } : {}), ...(KEY ? { 'x-spike-key': KEY } : {}) },
  });
  const text = await res.text();
  const clientMs = performance.now() - t0;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  const out = { ...JSON.parse(text), clientMs, reqBytes: payload?.length ?? 0, resBytes: text.length };
  writtenSoFar += out.meter?.rowsWritten ?? 0;
  if (op) opLog.push({ op, path: path.split('?')[0], clientMs, rowsRead: out.meter?.rowsRead ?? 0, rowsWritten: out.meter?.rowsWritten ?? 0, reqBytes: out.reqBytes, resBytes: out.resBytes, at });
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const results: Record<string, unknown> = { tenant: TENANT, startedAt: new Date().toISOString() };
const rows: string[][] = [];
const add = (op: string, m: Meter, clientMs: number, serverMs?: number, extra = '') =>
  rows.push([op, String(m.rowsRead), String(m.rowsWritten), r1(clientMs).toString(), serverMs === undefined ? '' : r1(serverMs).toString(), extra]);
const sum = (a: Meter, b: Meter): Meter => ({
  rowsRead: a.rowsRead + b.rowsRead,
  rowsWritten: a.rowsWritten + b.rowsWritten,
  statements: a.statements + b.statements,
});
const zero = (): Meter => ({ rowsRead: 0, rowsWritten: 0, statements: 0 });

async function pushAll(batch: number, filter?: (t: string) => boolean) {
  const perTable: Record<string, { rows: number; meter: Meter; clientMs: number; serverMs: number; batches: number; maxReqBytes: number; maxClientMs: number }> = {};
  for (const t of tableOrder) {
    if (filter && !filter(t)) continue;
    const acc = { rows: 0, meter: zero(), clientMs: 0, serverMs: 0, batches: 0, maxReqBytes: 0, maxClientMs: 0 };
    let buf: TransitRow[] = [];
    const flush = async () => {
      const r = await call('POST', '/push', { rows: buf }, 'seed');
      if (r.accepted + r.unchanged !== buf.length) throw new Error(`push rejected: ${JSON.stringify(r).slice(0, 300)}`);
      acc.rows += buf.length;
      acc.meter = sum(acc.meter, r.meter);
      acc.clientMs += r.clientMs;
      acc.serverMs += r.serverMs;
      acc.batches++;
      acc.maxReqBytes = Math.max(acc.maxReqBytes, r.reqBytes);
      acc.maxClientMs = Math.max(acc.maxClientMs, r.clientMs);
      buf = [];
    };
    let n = 0;
    for (const row of syntheticRows(t)) {
      if (t === 'achievements' && ++n > ACH_LIMIT) break;
      buf.push(row);
      if (buf.length >= batch) await flush();
    }
    if (buf.length) await flush();
    perTable[t] = acc;
  }
  return perTable;
}

const edit = (table: TransitRow['table'], id: string, created: string, fields: Record<string, unknown>, ms: number, counter = 0): TransitRow => ({
  table,
  id,
  created,
  deleted: null,
  fields,
  clocks: Object.fromEntries(Object.keys(fields).map((f) => [f, clock(ms, counter, 'dev002')])),
});

async function cloudProfile() {
  // Perfil reducido para Cloudflare real: solo lo que se quiere medir (CPU), con presupuesto de escrituras.
  // 1) Biblioteca en frío: el DO se evacua tras unos segundos sin tráfico.
  const idle = Number(process.env.BENCH_IDLE_MS ?? 30_000);
  console.log(`espera ${idle} ms para que el DO se evacue (primera /library en frío)...`);
  await new Promise((r) => setTimeout(r, idle));
  const libs = [];
  for (let i = 0; i < 20; i++) libs.push(await call('GET', '/library?full=1', undefined, i === 0 ? 'library-cold' : 'library'));
  results.libraryRowCounts = libs[0].rowCounts;
  results.libraryServerMs = libs.map((l) => r1(l.serverMs));
  results.libraryClientMs = libs.map((l) => r1(l.clientMs));
  const best = libs.reduce((a, b) => (a.serverMs < b.serverMs ? a : b));
  add('biblioteca (mejor de 20)', best.meter, best.clientMs, best.serverMs, `${best.games.length} juegos, ${(best.resBytes / 1e3).toFixed(0)} KB; server ms ${results.libraryServerMs}`);

  // 2) Pull completo con página de 1000 (cada página es una muestra).
  let since = 0;
  let pages = 0;
  const pullMs: number[] = [];
  for (;;) {
    const r = await call('GET', `/pull?since=${since}&limit=1000`, undefined, 'pull1000');
    pages++;
    pullMs.push(r1(r.clientMs));
    add(`pull página ${pages} (limit 1000)`, r.meter, r.clientMs, r.serverMs, `${r.rows.length} filas, ${(r.resBytes / 1e3).toFixed(0)} KB`);
    since = r.next;
    if (!r.more) break;
  }
  results.pullClientMs = pullMs;

  // 3) Push de lotes de 100/200/500 filas: ediciones de logros YA sembrados (campo globalPercent),
  //    con relojes crecientes para que cada una sea una escritura real (no un eco).
  const pool = [...syntheticRows('achievements')].slice(0, ACH_LIMIT);
  const repsBySize: Record<number, number> = { 100: 4, 200: 3, 500: 2 }; // presupuesto de escrituras
  let cursor = 0;
  let tick = Date.now() + 5000;
  for (const size of [100, 200, 500]) {
    for (let k = 0; k < repsBySize[size]; k++) {
      const slice = pool.slice(cursor, cursor + size);
      cursor += size;
      tick += 10_000;
      const batch = slice.map((a, i) => edit('achievements', a.id, a.created, { globalPercent: 10 + ((k + i) % 80) + 0.5 }, tick + i));
      const r = await call('POST', '/push', { rows: batch }, `push${size}`);
      add(`push ${size} filas (edición logros) #${k + 1}`, r.meter, r.clientMs, r.serverMs, `accepted ${r.accepted}, unchanged ${r.unchanged}, ${(r.reqBytes / 1e3).toFixed(0)} KB`);
    }
  }
  results.writtenTotal = writtenSoFar;
  results.opLog = opLog;
}

async function legacySteps() {
  // 2. Re-subir un lote idéntico (eco): debe escribir 0 salvo tenant_meta
  const echoRows = [...syntheticRows('achievements')].slice(0, 500);
  const echo = await call('POST', '/push', { rows: echoRows });
  add('eco: re-push 500 logros idénticos', echo.meter, echo.clientMs, echo.serverMs, `accepted ${echo.accepted}, unchanged ${echo.unchanged}`);

  // 3. Lotes de 100 filas
  const now = Date.now();
  const newSessions: TransitRow[] = Array.from({ length: 100 }, (_, i) => ({
    table: 'sessions',
    id: `0194c2f0-new0-7000-8000-${String(i).padStart(12, '0')}`,
    created: clock(now - 100_000 + i, 0, 'dev002'),
    deleted: null,
    fields: {
      playthroughId: playthroughId(i),
      deviceId: 'dev002',
      startedBy: 'watcher',
      source: 'measured',
      startedAt: now - 100_000 + i,
      datePrecision: 'datetime',
      lastSeenAt: now - 100_000 + i,
    },
    clocks: {},
  }));
  const b1 = await call('POST', '/push', { rows: newSessions });
  add('lote 100: sesiones NUEVAS', b1.meter, b1.clientMs, b1.serverMs);
  const b2 = await call('POST', '/push', {
    rows: newSessions.map((s, i) => edit('sessions', s.id, s.created, { lastSeenAt: now + i }, now + i)),
  });
  add('lote 100: latido (lastSeenAt)', b2.meter, b2.clientMs, b2.serverMs);
  const b3 = await call('POST', '/push', {
    rows: newSessions.map((s, i) => edit('sessions', s.id, s.created, { endedAt: now + 1000, durationSec: 100, closedBy: 'owner' }, now + 1000 + i)),
  });
  add('lote 100: cierre de sesión (endedAt: col. indexada)', b3.meter, b3.clientMs, b3.serverMs);
  const ach = [...syntheticRows('achievements')].slice(1000, 1100);
  const b4 = await call('POST', '/push', {
    rows: ach.map((a, i) => edit('achievements', a.id, a.created, { globalPercent: 12.3 }, now + 2000 + i)),
  });
  add('lote 100: logros, cambia globalPercent', b4.meter, b4.clientMs, b4.serverMs);
  const games100 = [...syntheticRows('games')].slice(0, 100);
  const b5 = await call('POST', '/push', {
    rows: games100.map((g, i) => edit('games', g.id, g.created, { notes: `editado ${i}` }, now + 3000 + i)),
  });
  add('lote 100: juegos, cambia notes', b5.meter, b5.clientMs, b5.serverMs);

  // 4. Día "normal" ≈ 300 cambios
  const day: TransitRow[][] = [];
  const t = now + 10_000;
  const daySessions = Array.from({ length: 6 }, (_, i) => `0194c2f0-day0-7000-8000-${String(i).padStart(12, '0')}`);
  daySessions.forEach((id, i) => {
    const created = clock(t + i, 0, 'dev002');
    day.push([{ table: 'sessions', id, created, deleted: null, fields: { playthroughId: playthroughId(200 + i), deviceId: 'dev002', startedBy: 'watcher', source: 'measured', startedAt: t + i, datePrecision: 'datetime', lastSeenAt: t + i }, clocks: {} }]);
    for (let k = 1; k <= 40; k++) day.push([edit('sessions', id, created, { lastSeenAt: t + i + k * 60_000 }, t + i + k, k)]);
    day.push([edit('sessions', id, created, { endedAt: t + 41 * 60_000, durationSec: 2460, closedBy: 'owner' }, t + i + 50, 50)]);
  });
  for (let i = 0; i < 12; i++)
    day.push([{ table: 'state_events', id: `0194c2f0-dayE-7000-8000-${String(i).padStart(12, '0')}`, created: clock(t + 100 + i, 0, 'dev002'), deleted: null, fields: { playthroughId: playthroughId(300 + i), type: 'completed', occurredAt: t, datePrecision: 'day', deviceId: 'dev002' }, clocks: {} }]);
  const someGames = [...syntheticRows('games')].slice(200, 220);
  someGames.forEach((g, i) => day.push([edit('games', g.id, g.created, { notes: `día ${i}` }, t + 200 + i)]));
  const somePts = [...syntheticRows('playthroughs')].slice(200, 216);
  somePts.forEach((p, i) => day.push([edit('playthroughs', p.id, p.created, { rating: 4 }, t + 300 + i)]));
  const dayRows = day.flat();
  results.dayChanges = dayRows.length;

  // 4a. un push por cambio (peor caso: cada latido viaja solo)
  let dayA = zero();
  let dayAms = 0;
  for (const b of day) {
    const r = await call('POST', '/push', { rows: b });
    dayA = sum(dayA, r.meter);
    dayAms += r.clientMs;
  }
  add(`día normal: ${dayRows.length} cambios, 1 push por cambio`, dayA, dayAms, undefined, `${day.length} peticiones`);
  // 4b. el mismo día con relojes posteriores, todo en un solo lote
  const dayB = dayRows.map((r) => ({ ...r, clocks: Object.fromEntries(Object.entries(r.clocks).map(([k, c]) => [k, clock(Number(c.slice(0, 13)) + 500_000, Number(c.slice(14, 18)), 'dev003')])) }));
  // las inserciones (clocks vacíos) ya existen: se vuelven ecos
  const rB = await call('POST', '/push', { rows: dayB });
  add(`día normal: mismos cambios en 1 lote`, rB.meter, rB.clientMs, rB.serverMs, `accepted ${rB.accepted}, unchanged ${rB.unchanged}`);

  // 5. Pull completo desde 0 con varios tamaños de página
  for (const limit of [500, 1000, 2000]) {
    let since = 0;
    let m = zero();
    let ms = 0;
    let srv = 0;
    let pages = 0;
    let bytes = 0;
    let maxPageMs = 0;
    let maxBytes = 0;
    let got = 0;
    for (;;) {
      const r = await call('GET', `/pull?since=${since}&limit=${limit}`);
      pages++;
      m = sum(m, r.meter);
      ms += r.clientMs;
      srv += r.serverMs;
      bytes += r.resBytes;
      maxBytes = Math.max(maxBytes, r.resBytes);
      maxPageMs = Math.max(maxPageMs, r.clientMs);
      got += r.rows.length;
      since = r.next;
      if (!r.more) break;
    }
    add(`pull completo desde 0, página ${limit}`, m, ms, srv, `${pages} páginas, ${got} filas, ${(bytes / 1e6).toFixed(1)} MB; página máx ${(maxBytes / 1e3).toFixed(0)} KB / ${r1(maxPageMs)} ms`);
  }
  const st2 = await call('GET', '/stats');
  const inc = await call('GET', `/pull?since=${st2.seq - 300}&limit=500`);
  add('pull incremental (últimos 300 cambios)', inc.meter, inc.clientMs, inc.serverMs, `${inc.rows.length} filas`);

  // 6. Biblioteca (S-03), 5 repeticiones
  const libs = [];
  for (let i = 0; i < 5; i++) libs.push(await call('GET', '/library?full=1'));
  results.libraryRowCounts = libs[0].rowCounts;
  results.libraryServerMs = libs.map((l) => r1(l.serverMs));
  results.libraryClientMs = libs.map((l) => r1(l.clientMs));
  const best = libs.reduce((a, b) => (a.serverMs < b.serverMs ? a : b));
  add('biblioteca (mejor de 5)', best.meter, best.clientMs, best.serverMs, `${best.games.length} juegos, ${(best.resBytes / 1e3).toFixed(0)} KB; server ms ${results.libraryServerMs}`);

  // 7. Siembra interna con distintos tamaños de lote y modo de inserción
  const internal: Record<string, unknown> = {};
  for (const [batch, multi] of CLOUD ? [] : ([[100, 0], [1000, 0], [5000, 0], [1000, 1], [40452, 0]] as const)) {
    await call('POST', '/reset');
    const r = await call('POST', `/seed?batch=${batch}&multi=${multi}`);
    internal[`${batch}${multi ? '-multi' : ''}`] = r.perTable;
    const a = r.perTable.achievements;
    add(`siembra interna logros, lote ${batch}${multi ? ' multi-fila' : ''}`, { rowsRead: a.rowsRead, rowsWritten: a.rowsWritten, statements: 0 }, r.clientMs, a.serverMs, `${a.batches} lotes, ${r1(a.serverMs / a.batches)} ms/lote`);
  }
  results.internalSeed = internal;
  results.dbSizeAfterSeed = (await call('GET', '/stats')).databaseSize;

  // 8. Catálogo de logros agrupado por juego
  const g = CLOUD ? null : await call('POST', '/experiment/grouped-achievements');
  results.grouped = g;
  if (g) add(`logros AGRUPADOS (${g.groupedRows} filas JSON)`, { rowsRead: 0, rowsWritten: g.rowsWritten, statements: 0 }, g.clientMs, undefined, `JSON medio ${g.avgJsonBytes} B; refrescar 1 juego = ${g.oneGameRefresh.rowsWritten} esc`);

  // 9. ¿Qué pasa con los datos si una transacción deja una FK rota?
  if (!CLOUD) {
    const before = (await call('GET', '/stats')).counts;
    let fkErr = '';
    try {
      await call('POST', '/limits?only=fk_child_without_parent_deferred_commit');
    } catch (e) {
      fkErr = String((e as Error).message).slice(0, 200);
    }
    const after = (await call('GET', '/stats')).counts;
    results.fkReset = { before, after, error: fkErr, dataPreserved: JSON.stringify(before) === JSON.stringify(after) };
  }

}

async function main() {
  // 0. Migración inicial (DO nuevo)
  const reset = await call('POST', '/reset');
  results.migration = reset.migration;
  add('migración inicial (DDL)', reset.migration, reset.clientMs, reset.migration.serverMs);

  // 1. Siembra por la ruta real (push), lotes de 500
  const seed = await pushAll(500);
  results.seedPush500 = seed;
  let total = zero();
  let totalMs = 0;
  for (const [t, a] of Object.entries(seed)) {
    add(`siembra push×500: ${t} (${a.rows} filas, ${a.batches} lotes)`, a.meter, a.clientMs, a.serverMs, `${r1(a.meter.rowsWritten / a.rows)} esc/fila; lote máx ${a.maxReqBytes} B, ${r1(a.maxClientMs)} ms`);
    total = sum(total, a.meter);
    totalMs += a.clientMs;
  }
  add('siembra push×500: TOTAL', total, totalMs);
  const stats = await call('GET', '/stats');
  results.statsAfterSeed = stats;

  if (CLOUD) await cloudProfile();
  else await legacySteps();

  results.table = rows;
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true });
  const file = new URL(`../results/bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify(results, null, 2));

  console.log('| Operación | Filas leídas | Filas escritas | ms cliente | ms servidor | Notas |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
  console.log('\nFK reset:', JSON.stringify(results.fkReset));
  console.log('library rowCounts:', JSON.stringify(results.libraryRowCounts));
  console.log('db size after seed:', results.dbSizeAfterSeed);
  console.log('Guardado en', file.pathname);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
