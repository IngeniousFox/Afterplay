// Repetición "con ritmo" del perfil cloud sobre un tenant YA sembrado (BENCH_TENANT).
// `wrangler tail` descarta eventos si llegan en ráfaga; con ~3 s entre peticiones no se pierde ninguno.
// Variables: HUB_URL, HUB_KEY (secreto), BENCH_TENANT, BENCH_PUSH_FROM (índice de logro desde el que editar).
import { clock, syntheticRows } from '../src/synthetic';

const BASE = process.env.HUB_URL!;
const KEY = process.env.HUB_KEY!;
const TENANT = process.env.BENCH_TENANT!;
const GAP = Number(process.env.BENCH_GAP_MS ?? 3000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: string, path: string, op: string, body?: unknown) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}tenant=${TENANT}&op=${op}`, {
    method,
    body: payload,
    headers: { 'x-spike-key': KEY, ...(payload ? { 'content-type': 'application/json' } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  await sleep(GAP);
  return JSON.parse(text);
}

const log: unknown[] = [];
const rec = (op: string, r: any) => log.push({ op, meter: r.meter, accepted: r.accepted, rows: r.rows?.length });

// 1) biblioteca: una en frío (tras 30 s de inactividad) + 19 en caliente
await sleep(30_000);
for (let i = 0; i < 20; i++) rec(i === 0 ? 'library-cold' : 'library', await call('GET', '/library?full=1', i === 0 ? 'library-cold' : 'library'));

// 2) pull completo, página de 1000
let since = 0;
for (;;) {
  const r = await call('GET', `/pull?since=${since}&limit=1000`, 'pull1000');
  rec('pull1000', r);
  since = r.next;
  if (!r.more) break;
}

// 3) push: ediciones de logros ya sembrados (relojes crecientes => escrituras reales)
const from = Number(process.env.BENCH_PUSH_FROM ?? 2000);
const pool = [...syntheticRows('achievements')].slice(from, from + 2000);
let cursor = 0;
let tick = Date.now() + 100_000;
for (const [size, reps] of [[100, 2], [200, 1], [500, 1]] as const) {
  for (let k = 0; k < reps; k++) {
    tick += 10_000;
    const rows = pool.slice(cursor, cursor + size).map((a, i) => ({
      table: 'achievements' as const,
      id: a.id,
      created: a.created,
      deleted: null,
      fields: { globalPercent: 20 + (i % 70) + 0.25 },
      clocks: { globalPercent: clock(tick + i, 0, 'dev002') },
    }));
    cursor += size;
    rec(`push${size}`, await call('POST', '/push', `push${size}`, { rows }));
  }
}
console.log(JSON.stringify(log.map((l: any) => [l.op, l.meter?.rowsRead, l.meter?.rowsWritten, l.accepted ?? l.rows])));
