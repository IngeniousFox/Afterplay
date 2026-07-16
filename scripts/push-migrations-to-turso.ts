import { createClient } from '@libsql/client';
import { config as loadEnv } from 'dotenv';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushPendingMigrations } from '../src/main/db/migrationSync';

// Envoltorio manual de pushPendingMigrations (ver migrationSync.ts) para
// correrlo a mano cuando haga falta — el arranque normal de la app ya lo
// hace solo desde runMigrations() en src/main/db/index.ts.
//
// Uso: npm run db:push:remote (usa DATABASE_URL/DATABASE_AUTH_TOKEN del
// .env activo — cambia de REAL a TEST comentando el bloque que corresponda).

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');
loadEnv({ path: join(projectRoot, '.env') });

const main = async (): Promise<void> => {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  if (!url || !authToken) {
    console.error('[push] faltan DATABASE_URL / DATABASE_AUTH_TOKEN en .env');
    process.exitCode = 1;
    return;
  }

  console.log(`[push] conectando directo a ${url} (sin pasar por sync)`);
  const client = createClient({ url, authToken });

  try {
    const { applied } = await pushPendingMigrations(client, join(projectRoot, 'drizzle'));
    if (applied.length === 0) {
      console.log('[push] el remoto ya tiene todas las migraciones locales aplicadas.');
    } else {
      console.log(`[push] aplicadas y registradas: ${applied.join(', ')}`);
    }
  } catch (error) {
    console.error('[push]', error);
    process.exitCode = 1;
  } finally {
    client.close();
  }
};

main();
