import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// S-02 (docs/AFTERPLAY-2.0.md §20.1): ¿vale `@libsql/client` en modo fichero
// como driver local de la 2.0?
//
//   tsx spikes/local-driver/bench.ts C:\ruta\a\una\COPIA.db
//
// Se ejecuta sobre una COPIA de una base 1.x con datos reales (misma forma y
// volumen que tendrá la 2.0). Escribe en esa copia: no pasarle nunca la base
// de la app. Mide lo que el diseño va a pedirle al driver:
//   - la lectura más pesada (biblioteca con estado y horas);
//   - escrituras sueltas, que es el patrón del latido de 5 s;
//   - lotes en transacción, que es aplicar una página descargada del hub.

const target = process.argv[2];
if (!target || !existsSync(target)) {
  console.error('Uso: tsx spikes/local-driver/bench.ts <ruta a una COPIA de la base>');
  process.exit(1);
}

const client = createClient({ url: `file:${resolve(target)}` });

const time = async (label: string, work: () => Promise<unknown>, runs = 1): Promise<void> => {
  const samples: number[] = [];
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    await work();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(
    `  ${label.padEnd(64)} ${median.toFixed(1).padStart(8)} ms${runs > 1 ? `  (mediana de ${runs}, max ${samples[samples.length - 1].toFixed(1)})` : ''}`,
  );
};

const main = async (): Promise<void> => {
  await client.execute('PRAGMA journal_mode = WAL');
  console.log('\n── Lecturas');
  await time(
    'biblioteca: juegos + horas + último evento por playthrough',
    () =>
      client.execute(`
        SELECT g.id, g.title,
               (SELECT coalesce(sum(s."durationSec"), 0) FROM sessions s
                  JOIN iterations i ON i.id = s."iterationId" WHERE i."gameId" = g.id) AS seconds,
               (SELECT e.type FROM state_events e JOIN iterations i ON i.id = e."iterationId"
                 WHERE i."gameId" = g.id ORDER BY e."occurredAt" DESC, e.id DESC LIMIT 1) AS lastEvent
        FROM games g`),
    15,
  );
  await time('todas las sesiones', () => client.execute('SELECT * FROM sessions'), 15);
  await time(
    'catálogo completo de logros (40k filas)',
    () => client.execute('SELECT * FROM achievements'),
    5,
  );
  await time(
    'logros de un juego con sus desbloqueos',
    () =>
      client.execute(`
        SELECT a.*, u."unlockedAt" FROM achievements a
        LEFT JOIN achievement_unlocks u ON u."achievementId" = a.id
        WHERE a."gameId" = (SELECT "gameId" FROM achievements LIMIT 1)`),
    15,
  );

  console.log('\n── Escrituras');
  await client.execute(
    'CREATE TABLE IF NOT EXISTS spike_bench (id TEXT PRIMARY KEY, a TEXT, b INTEGER, fields TEXT)',
  );
  await client.execute('DELETE FROM spike_bench');
  await client.execute({
    sql: 'INSERT INTO spike_bench VALUES (?, ?, ?, ?)',
    args: ['beat', 'x', 0, '{}'],
  });

  await time(
    'latido: 1 UPDATE suelto (autocommit)',
    () =>
      client.execute({
        sql: 'UPDATE spike_bench SET b = ? WHERE id = ?',
        args: [Date.now(), 'beat'],
      }),
    200,
  );

  const page = (size: number, offset: number): { sql: string; args: (string | number)[] }[] =>
    Array.from({ length: size }, (_, index) => ({
      sql: `INSERT INTO spike_bench VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET a = excluded.a, b = excluded.b, fields = excluded.fields`,
      args: [
        `row-${offset + index}`,
        'valor de texto de tamaño medio',
        index,
        '{"a":"1763020800123-0000-a1b2c3"}',
      ],
    }));

  await time(
    'aplicar una página de 500 filas (upsert, una transacción)',
    () => client.batch(page(500, 0), 'write'),
    10,
  );
  await time('aplicar 5.000 filas en 10 páginas', async () => {
    for (let index = 0; index < 10; index++)
      await client.batch(page(500, 10_000 + index * 500), 'write');
  });
  await time('aplicar 40.000 filas en 80 páginas (catálogo de logros)', async () => {
    for (let index = 0; index < 80; index++)
      await client.batch(page(500, 100_000 + index * 500), 'write');
  });

  await client.execute('DROP TABLE spike_bench');
  console.log('');
};

main()
  .catch((error: unknown) => {
    console.error('Fallo:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.close());
