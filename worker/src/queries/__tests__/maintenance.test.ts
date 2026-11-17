import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { TenantDb } from '../../db';
import { isInMaintenance } from '../maintenance';

// Modo mantenimiento del Worker (puente 1.8, AFTERPLAY-2.0 §19.3): con una fila
// `cutover` en app_meta —en cualquier estado— el index.ts contesta 503
// 'maintenance' a los POST y a GET /api/timer. Aquí se prueba la decisión
// contra una base de verdad con las migraciones reales.

const dirs: string[] = [];
const clients: Client[] = [];
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(HERE, '..', '..', '..', '..', 'drizzle');

const open = (): { client: Client; db: TenantDb } => {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-worker-maint-'));
  dirs.push(dir);
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  clients.push(client);
  return { client, db: drizzle({ client }) as unknown as TenantDb };
};

const freshDb = async (): Promise<{ client: Client; db: TenantDb }> => {
  const opened = open();
  await migrate(drizzle({ client: opened.client }), { migrationsFolder: MIGRATIONS_FOLDER });
  return opened;
};

after(() => {
  for (const client of clients) client.close();
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows puede tener el fichero tomado todavía; da igual, es tmp.
    }
  }
});

describe('isInMaintenance', () => {
  it('sin fila cutover no hay mantenimiento', async () => {
    const { client, db } = await freshDb();
    await client.execute(
      `INSERT INTO app_meta (key, value, updatedAt) VALUES ('device_status:pc-a', '{}', 1)`,
    );
    assert.equal(await isInMaintenance(db), false);
  });

  for (const state of ['migrating', 'done']) {
    it(`con cutover=${state} hay mantenimiento`, async () => {
      const { client, db } = await freshDb();
      await client.execute({
        sql: `INSERT INTO app_meta (key, value, updatedAt) VALUES ('cutover', ?, 1)`,
        args: [JSON.stringify({ state })],
      });
      assert.equal(await isInMaintenance(db), true);
    });
  }

  it('si la 2.0 suelta el corte, el Worker vuelve a escribir', async () => {
    const { client, db } = await freshDb();
    await client.execute(
      `INSERT INTO app_meta (key, value, updatedAt) VALUES ('cutover', '{"state":"migrating"}', 1)`,
    );
    assert.equal(await isInMaintenance(db), true);
    await client.execute(`DELETE FROM app_meta WHERE key = 'cutover'`);
    assert.equal(await isInMaintenance(db), false);
  });

  it('una base sin la tabla (escritorio aún sin la 1.8) sigue como siempre', async () => {
    const { db } = open();
    assert.equal(await isInMaintenance(db), false);
  });
});
