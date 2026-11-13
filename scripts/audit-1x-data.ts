import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

// AUDITORÍA DE UNA BASE 1.x, antes de migrarla a la 2.0
// (docs/AFTERPLAY-2.0.md §19.4 y apéndice B).
//
//   tsx scripts/audit-1x-data.ts C:\ruta\a\una\COPIA.db
//
// Solo lee, y solo sobre una COPIA: una copia de seguridad de la app
// (userData/backups/Afterplay-*.db) llevada a otra carpeta. Se niega a abrir
// una base que viva en la carpeta de datos de la app, en uso o no — abrirla
// con otro driver puede dejarle ficheros al lado que el motor de sync no
// espera, y eso ya costó una base.
//
// Lo que busca son las cosas que el importador tendrá que sanear: huellas de
// los fallos entre PCs (F-01, F-07), restos del modelo v1 y ambigüedades.
// Imprime recuentos y, como mucho, unos pocos ejemplos.

const target = process.argv[2];
if (!target || !existsSync(target)) {
  console.error('Uso: tsx scripts/audit-1x-data.ts <ruta a una COPIA de la base>');
  process.exit(1);
}

const absolute = resolve(target);
const folder = basename(dirname(absolute)).toLowerCase();
const parent = basename(dirname(dirname(absolute))).toLowerCase();
const inAppData = /^afterplay(-dev-.*)?$/.test(folder) || /^afterplay(-dev-.*)?$/.test(parent);
if (inAppData) {
  console.error(
    'Esa base está dentro de la carpeta de datos de la app. Copia el fichero a otra carpeta y audita la copia.',
  );
  process.exit(1);
}

const client = createClient({ url: `file:${absolute}` });

type Row = Record<string, unknown>;
const rows = async (sql: string): Promise<Row[]> => (await client.execute(sql)).rows as Row[];
const count = async (sql: string): Promise<number> => Number((await rows(sql))[0]?.n ?? 0);

const line = (label: string, value: unknown): void =>
  console.log(`  ${label.padEnd(58)} ${String(value)}`);

const section = (title: string): void => console.log(`\n── ${title}`);

const main = async (): Promise<void> => {
  section('Volumen por tabla (apéndice B15)');
  for (const table of [
    'games',
    'iterations',
    'sessions',
    'state_events',
    'spend_events',
    'achievements',
    'achievement_unlocks',
    'save_backups',
    'curiosities',
    'generated_memories',
    'radar_games',
    'emulators',
    'plan_mailbox',
  ]) {
    line(table, await count(`SELECT count(*) AS n FROM ${table}`));
  }
  line(
    'juegos planeados (planned = 1)',
    await count('SELECT count(*) AS n FROM games WHERE planned = 1'),
  );

  section('Sesiones (B1-B3)');
  line(
    'sesiones "manuales" del modelo v1 (isManual = 1)',
    await count('SELECT count(*) AS n FROM sessions WHERE "isManual" = 1'),
  );
  line(
    'sesiones abiertas ahora mismo',
    await count('SELECT count(*) AS n FROM sessions WHERE "endedAt" IS NULL'),
  );
  line(
    'sesiones con fin anterior al inicio',
    await count('SELECT count(*) AS n FROM sessions WHERE "endedAt" < "startedAt"'),
  );
  line(
    'sesiones sin playthrough ni emulador',
    await count(
      'SELECT count(*) AS n FROM sessions WHERE "iterationId" IS NULL AND "emulatorId" IS NULL',
    ),
  );
  line(
    'sesiones de emulador sin asignar (bandeja Pending)',
    await count(
      'SELECT count(*) AS n FROM sessions WHERE "iterationId" IS NULL AND "emulatorId" IS NOT NULL',
    ),
  );
  line(
    'sesiones de cronómetro (startedBy = timer)',
    await count(`SELECT count(*) AS n FROM sessions WHERE "startedBy" = 'timer'`),
  );

  section('Huella de F-01: sesiones medidas de dos minutos o menos (B4)');
  const measured = await count(
    'SELECT count(*) AS n FROM sessions WHERE "isManual" = 0 AND "endedAt" IS NOT NULL',
  );
  const short = await count(
    'SELECT count(*) AS n FROM sessions WHERE "isManual" = 0 AND "durationSec" BETWEEN 0 AND 130',
  );
  const zero = await count(
    'SELECT count(*) AS n FROM sessions WHERE "isManual" = 0 AND "durationSec" = 0',
  );
  line('sesiones medidas y cerradas', measured);
  line(
    '  de ellas, de 130 s o menos',
    `${short} (${measured ? ((short / measured) * 100).toFixed(1) : '0'} %)`,
  );
  line('  de ellas, de duración 0', zero);
  // El discriminador: cuando el proceso del juego muere, la sesión se cierra a
  // la hora de ese instante. Cuando la cierra un barrido o la recuperación del
  // arranque, se cierra EXACTAMENTE en su último latido. Una sesión corta
  // cerrada en su latido es la firma de "la cerró otro" (F-01) o de un corte.
  line(
    'cerradas exactamente en su último latido (todas)',
    await count(
      'SELECT count(*) AS n FROM sessions WHERE "isManual" = 0 AND "endedAt" IS NOT NULL AND "endedAt" = "lastHeartbeatAt"',
    ),
  );
  line(
    '  de ellas, de 130 s o menos',
    await count(
      'SELECT count(*) AS n FROM sessions WHERE "isManual" = 0 AND "endedAt" = "lastHeartbeatAt" AND "durationSec" BETWEEN 0 AND 130',
    ),
  );
  line(
    'cortas (130 s o menos) cerradas al morir el proceso',
    await count(
      'SELECT count(*) AS n FROM sessions WHERE "isManual" = 0 AND "endedAt" IS NOT NULL AND ("lastHeartbeatAt" IS NULL OR "endedAt" <> "lastHeartbeatAt") AND "durationSec" BETWEEN 0 AND 130',
    ),
  );
  const byMonth = await rows(`
    SELECT strftime('%Y-%m', "startedAt" / 1000, 'unixepoch') AS mes,
           sum(CASE WHEN "durationSec" BETWEEN 0 AND 130 THEN 1 ELSE 0 END) AS cortas,
           count(*) AS total
    FROM sessions WHERE "isManual" = 0 AND "endedAt" IS NOT NULL
    GROUP BY mes ORDER BY mes`);
  for (const month of byMonth)
    line(`  ${String(month.mes)}`, `${String(month.cortas)} cortas de ${String(month.total)}`);

  section('Sesiones medidas que se solapan en el tiempo (B5)');
  line(
    'pares de sesiones solapadas',
    await count(`
    SELECT count(*) AS n FROM sessions a JOIN sessions b
      ON a.id < b.id AND a."startedAt" < b."endedAt" AND b."startedAt" < a."endedAt"
    WHERE a."isManual" = 0 AND b."isManual" = 0`),
  );
  line(
    '  de ellos, del MISMO juego',
    await count(`
    SELECT count(*) AS n FROM sessions a
    JOIN sessions b ON a.id < b.id AND a."startedAt" < b."endedAt" AND b."startedAt" < a."endedAt"
    JOIN iterations ia ON ia.id = a."iterationId"
    JOIN iterations ib ON ib.id = b."iterationId"
    WHERE a."isManual" = 0 AND b."isManual" = 0 AND ia."gameId" = ib."gameId"`),
  );

  section('Indicios de colisión de ids, F-07 (B6-B8)');
  line(
    'logros asignados a un playthrough de OTRO juego',
    await count(`
    SELECT count(*) AS n FROM achievement_unlocks u
    JOIN achievements a ON a.id = u."achievementId"
    JOIN iterations i ON i.id = u."iterationId"
    WHERE i."gameId" <> a."gameId"`),
  );
  line(
    'logros cuya sesión no es de su playthrough',
    await count(`
    SELECT count(*) AS n FROM achievement_unlocks u
    JOIN sessions s ON s.id = u."sessionId"
    WHERE u."iterationId" IS NOT NULL AND s."iterationId" <> u."iterationId"`),
  );
  line(
    'sesiones cuyo playthrough no existe',
    await count(
      'SELECT count(*) AS n FROM sessions s WHERE s."iterationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM iterations i WHERE i.id = s."iterationId")',
    ),
  );
  line(
    'eventos cuyo playthrough no existe',
    await count(
      'SELECT count(*) AS n FROM state_events e WHERE NOT EXISTS (SELECT 1 FROM iterations i WHERE i.id = e."iterationId")',
    ),
  );
  line(
    'playthroughs cuyo juego no existe',
    await count(
      'SELECT count(*) AS n FROM iterations i WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.id = i."gameId")',
    ),
  );
  line(
    'gastos cuyo juego no existe',
    await count(
      'SELECT count(*) AS n FROM spend_events s WHERE NOT EXISTS (SELECT 1 FROM games g WHERE g.id = s."gameId")',
    ),
  );
  line(
    'desbloqueos cuyo logro no existe',
    await count(
      'SELECT count(*) AS n FROM achievement_unlocks u WHERE NOT EXISTS (SELECT 1 FROM achievements a WHERE a.id = u."achievementId")',
    ),
  );
  const foreignKeys = await rows('PRAGMA foreign_key_check');
  line('filas que incumplen una clave foránea (PRAGMA)', foreignKeys.length);

  section('Ambigüedades que el importador tiene que resolver');
  line(
    'playthroughs con horas manuales Y sesiones (B9)',
    await count(`
    SELECT count(*) AS n FROM (
      SELECT i.id FROM iterations i JOIN sessions s ON s."iterationId" = i.id
      WHERE i."manualTotalPlayed" > 0 GROUP BY i.id)`),
  );
  line(
    'playthroughs solo con horas manuales',
    await count(`
    SELECT count(*) AS n FROM iterations i
    WHERE i."manualTotalPlayed" > 0 AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s."iterationId" = i.id)`),
  );
  line(
    'juegos planeados con sesiones (B10)',
    await count(`
    SELECT count(*) AS n FROM (
      SELECT g.id FROM games g JOIN iterations i ON i."gameId" = g.id
      JOIN sessions s ON s."iterationId" = i.id WHERE g.planned = 1 GROUP BY g.id)`),
  );
  line(
    'juegos emulados con ejecutable propio (B11)',
    await count(
      'SELECT count(*) AS n FROM games WHERE "isEmulated" = 1 AND "executablePath" IS NOT NULL',
    ),
  );
  line(
    'juegos con ejecutable configurado',
    await count('SELECT count(*) AS n FROM games WHERE "executablePath" IS NOT NULL'),
  );
  line('juegos sin igdbId', await count('SELECT count(*) AS n FROM games WHERE "igdbId" IS NULL'));
  line(
    'appids de Steam compartidos por varios juegos (B12)',
    await count(`
    SELECT count(*) AS n FROM (SELECT "steamAppId" FROM games WHERE "steamAppId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1)`),
  );
  line(
    'appid de Steam fijado a mano',
    await count('SELECT count(*) AS n FROM games WHERE "steamAppIdManual" = 1'),
  );
  line(
    'juegos con más de un playthrough "en curso" (B14, indicio)',
    await count(`
    SELECT count(*) AS n FROM (
      SELECT i."gameId" FROM iterations i
      WHERE (SELECT e.type FROM state_events e
              WHERE e."iterationId" = i.id AND e.type <> 'plan_to_play'
              ORDER BY e."occurredAt" DESC, e.id DESC LIMIT 1) = 'started'
      GROUP BY i."gameId" HAVING count(*) > 1)`),
  );
  line(
    'eventos plan_to_play',
    await count(`SELECT count(*) AS n FROM state_events WHERE type = 'plan_to_play'`),
  );
  line(
    'playthroughs sin ningún evento ni sesión (vacíos)',
    await count(`
    SELECT count(*) AS n FROM iterations i
    WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s."iterationId" = i.id)
      AND NOT EXISTS (SELECT 1 FROM state_events e WHERE e."iterationId" = i.id AND e.type <> 'plan_to_play')`),
  );

  section('Partidas guardadas y logros');
  line(
    'claves de objeto repetidas en save_backups (B13)',
    await count(
      'SELECT count(*) AS n FROM (SELECT "r2Key" FROM save_backups GROUP BY 1 HAVING count(*) > 1)',
    ),
  );
  line(
    'máquinas distintas en save_backups',
    await count('SELECT count(DISTINCT "machineId") AS n FROM save_backups'),
  );
  for (const source of ['steam', 'emu', 'ra']) {
    line(
      `desbloqueos de origen ${source}`,
      await count(`SELECT count(*) AS n FROM achievement_unlocks WHERE source = '${source}'`),
    );
  }
  line(
    'desbloqueos con fecha no fiable',
    await count('SELECT count(*) AS n FROM achievement_unlocks WHERE "dateReliable" = 0'),
  );

  section('Buzón del móvil');
  line(
    'órdenes pendientes',
    await count('SELECT count(*) AS n FROM plan_mailbox WHERE "processedAt" IS NULL'),
  );
  line(
    'órdenes con error',
    await count('SELECT count(*) AS n FROM plan_mailbox WHERE error IS NOT NULL'),
  );

  console.log('');
};

main()
  .catch((error: unknown) => {
    console.error(
      '\nNo se pudo completar la auditoría:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => client.close());
