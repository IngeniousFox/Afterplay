// S-01, lado "escritorio": el MISMO src/schema.ts y la MISMA src/library.ts,
// ahora sobre @libsql/client en modo fichero (driver local propuesto en §8.9).
// Si HUB_URL responde, compara la biblioteca con la del Durable Object sembrado
// con los mismos datos sintéticos.
// Uso: ..\..\node_modules\.bin\tsx scripts/libsql-shared-schema.ts
import { createClient } from '@libsql/client';
import { count, eq, getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLibrary } from '../src/library';
import { mergeRow } from '../src/merge';
import { syncedTables, tableOrder } from '../src/schema';
import { syntheticRows } from '../src/synthetic';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function main() {
  const dir = here('../.data/');
  mkdirSync(dir, { recursive: true });
  const file = `${dir}client.db`;
  rmSync(file, { force: true });
  const client = createClient({ url: `file:${file}` });
  const db = drizzle({ client });

  let t0 = performance.now();
  await migrate(db, { migrationsFolder: here('../drizzle/client') });
  console.log(`migración libsql: ${(performance.now() - t0).toFixed(0)} ms`);

  // Inserción con la misma función de fusión que el hub, marcando syncDirty=1
  // (en el PC "pendiente de subir").
  t0 = performance.now();
  for (const t of tableOrder) {
    const table = syncedTables[t];
    const values = [];
    for (const r of syntheticRows(t)) {
      const m = mergeRow(undefined, r)!;
      values.push({ ...m.values, syncDirty: 1 });
    }
    const perStmt = Math.floor(32766 / Object.keys(getTableColumns(table)).length);
    await db.transaction(async (tx) => {
      for (let i = 0; i < values.length; i += perStmt)
        await tx.insert(table).values(values.slice(i, i + perStmt) as never);
    });
  }
  console.log(`siembra libsql (44.035 filas): ${(performance.now() - t0).toFixed(0)} ms`);

  for (const t of tableOrder) {
    const table = syncedTables[t];
    const [{ n }] = await db.select({ n: count() }).from(table);
    const [{ d }] = await db.select({ d: count() }).from(table).where(eq(table.syncDirty, 1));
    console.log(`  ${t}: ${n} filas, ${d} sucias`);
  }
  const plan = await client.execute('explain query plan select id from achievements where syncDirty = 1');
  console.log('  plan syncDirty:', plan.rows.map((r) => r.detail).join(' / '));

  t0 = performance.now();
  const lib = await buildLibrary(db);
  console.log(`biblioteca libsql: ${(performance.now() - t0).toFixed(1)} ms, ${lib.games.length} juegos, filas por consulta ${JSON.stringify(lib.rowCounts)}`);

  // Comparación con el DO (mismos datos generados DENTRO del DO por /seed)
  const hub = process.env.HUB_URL ?? 'http://127.0.0.1:8799';
  try {
    const tenant = `libsql-compare-${Date.now()}`;
    await fetch(`${hub}/reset?tenant=${tenant}`, { method: 'POST' });
    const seeded = await (await fetch(`${hub}/seed?batch=1000&tenant=${tenant}`, { method: 'POST' })).json();
    const doLib = (await (await fetch(`${hub}/library?full=1&tenant=${tenant}`)).json()) as typeof lib;
    const strip = (g: (typeof lib.games)[number]) => ({ ...g, isLive: false });
    const same = JSON.stringify(doLib.games.map(strip)) === JSON.stringify(lib.games.map(strip));
    console.log(
      `comparación con el DO: counts ${JSON.stringify(seeded.counts)}; biblioteca idéntica: ${same}; hoursThisYear DO=${doLib.hoursThisYear} libsql=${lib.hoursThisYear}`,
    );
    if (!same) process.exitCode = 2;
  } catch (e) {
    console.log('hub no disponible, se omite la comparación:', String(e));
  }
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
