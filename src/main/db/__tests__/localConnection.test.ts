import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { sql } from 'drizzle-orm';
import type * as TursoDrizzle from 'drizzle-orm/tursodatabase-sync';
import type * as TursoMigrator from 'drizzle-orm/tursodatabase-sync/migrator';
import {
  hasSyncMetadata,
  isWalOutOfStep,
  localConnectionOptions,
  type LocalConnectionOptions,
} from '../localConnection';

// El motor se carga con import() y no con un import de arriba: los tests
// corren como CommonJS (tsx sin "type": "module") y una dependencia interna
// del motor, @tursodatabase/serverless, solo exporta para ESM — por require()
// revienta con ERR_PACKAGE_PATH_NOT_EXPORTED. El import dinámico resuelve
// como ESM. La app no lo nota: electron-vite empaqueta el main.
let drizzle: typeof TursoDrizzle.drizzle;
let migrate: typeof TursoMigrator.migrate;

before(async () => {
  ({ drizzle } = await import('drizzle-orm/tursodatabase-sync'));
  ({ migrate } = await import('drizzle-orm/tursodatabase-sync/migrator'));
});

// LA CONEXIÓN "SIGO EN LOCAL" Y EL WAL DEL MOTOR DE SYNC (localConnection.ts).
//
// Aquí SÍ va el motor de verdad (@tursodatabase/sync) y no el @libsql del
// andamio: el fallo vivía dentro del motor —cómo trata un WAL que el sync
// dejó volcado pero con sus frames—, y un doble no lo tendría.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: el motor, las migraciones del repo y los
// ficheros son reales. Lo único fabricado es el estado de partida: una base
// que nunca habló con Turso (el modo diferido también escribe -info) con su
// WAL volcado a mano por un checkpoint PASSIVE. Es la forma en que el motor
// deja el WAL tras sincronizar, y basta para reproducir el reinicio sin red
// y sin la biblioteca de nadie.

const carpetas: string[] = [];

after(() => {
  for (const dir of carpetas) rmSync(dir, { recursive: true, force: true });
});

const carpeta = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-test-localconn-'));
  carpetas.push(dir);
  return dir;
};

// Frames del WAL: cabecera de 32 bytes y frames de 24 + 4096 (página de 4 KB).
const framesDelWal = (dbPath: string): number =>
  existsSync(`${dbPath}-wal`) ? Math.floor((statSync(`${dbPath}-wal`).size - 32) / 4120) : 0;

// Una base como las que deja el sync: con -info, y con el WAL volcado al
// fichero principal pero sin truncar.
const baseComoTrasSincronizar = async (): Promise<string> => {
  const dbPath = join(carpeta(), 'Afterplay.db');
  const db = drizzle({ connection: { path: dbPath, url: () => null, clientName: 'afterplay' } });
  await db.$client.connect();
  await migrate(db, { migrationsFolder: 'drizzle' });
  for (let i = 0; i < 20; i++) {
    await db.run(
      sql`INSERT INTO emulators (name, executablePath) VALUES (${`emu ${i}`}, ${'x'.repeat(20_000)})`,
    );
  }
  await db.run(sql`PRAGMA wal_checkpoint(PASSIVE)`);
  await db.$client.close();
  return dbPath;
};

// Lo que hace el arranque sin red: abrir, claves foráneas, migrar (ya está al
// día: no aplica nada) y la primera escritura de la sesión.
const sesionOffline = async (
  connection: LocalConnectionOptions,
): Promise<ReturnType<typeof TursoDrizzle.drizzle>> => {
  const db = drizzle({ connection });
  await db.$client.connect();
  await db.run(sql`PRAGMA foreign_keys = ON`);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await db.run(sql`INSERT INTO emulators (name, executablePath) VALUES ('offline', 'C:/emu.exe')`);
  return db;
};

describe('localConnectionOptions: qué conexión recibe cada fichero', () => {
  it('un fichero que ya sincronizó (principal + -info) se abre con el motor de sync en pausa', () => {
    const dbPath = join(carpeta(), 'Afterplay.db');
    writeFileSync(dbPath, '');
    writeFileSync(`${dbPath}-info`, '{}');

    const options = localConnectionOptions(dbPath);
    assert.equal(hasSyncMetadata(dbPath), true);
    assert.equal(typeof options.url, 'function');
    assert.equal(options.url?.(), null);
  });

  it('un fichero que nunca sincronizó (sin -info) mantiene la conexión simple', () => {
    const dbPath = join(carpeta(), 'Afterplay.db');
    writeFileSync(dbPath, '');

    assert.equal(hasSyncMetadata(dbPath), false);
    assert.equal(localConnectionOptions(dbPath).url, undefined);
  });

  it('un -info huérfano (sin principal) no cuenta: el modo diferido se negaría a arrancar', () => {
    const dbPath = join(carpeta(), 'Afterplay.db');
    writeFileSync(`${dbPath}-info`, '{}');

    assert.equal(hasSyncMetadata(dbPath), false);
    assert.equal(localConnectionOptions(dbPath).url, undefined);
  });

  it('sin ningún fichero (instalación nueva) también la conexión simple', () => {
    const dbPath = join(carpeta(), 'Afterplay.db');
    assert.equal(localConnectionOptions(dbPath).url, undefined);
  });
});

describe('sesión offline sobre un WAL volcado por el sync', () => {
  // La razón de ser del arreglo, fijada: si el motor dejara algún día de
  // reiniciar el WAL con la conexión simple, este test lo diría, y el modo
  // diferido podría dejar de hacer falta.
  it('CONTROL: la conexión simple reinicia el WAL en la primera escritura', async () => {
    const dbPath = await baseComoTrasSincronizar();
    const antes = framesDelWal(dbPath);

    const db = await sesionOffline({ path: dbPath, clientName: 'afterplay' });
    await db.$client.close();

    assert.ok(antes > 100, `el estado de partida necesita un WAL con historia (tiene ${antes})`);
    assert.ok(
      framesDelWal(dbPath) < antes,
      `se esperaba el reinicio del WAL: ${antes} -> ${framesDelWal(dbPath)}`,
    );
  });

  it('con localConnectionOptions el WAL se conserva entero', async () => {
    const dbPath = await baseComoTrasSincronizar();
    const antes = framesDelWal(dbPath);

    const db = await sesionOffline(localConnectionOptions(dbPath));
    await db.$client.close();

    assert.ok(
      framesDelWal(dbPath) >= antes,
      `el WAL no puede encoger sin sync: ${antes} -> ${framesDelWal(dbPath)}`,
    );
  });

  it('lo escrito offline queda en la cola de cambios para el próximo push', async () => {
    const dbPath = await baseComoTrasSincronizar();
    const db = drizzle({ connection: localConnectionOptions(dbPath) });
    await db.$client.connect();
    const antes = (await db.$client.stats()).cdcOperations;

    await db.run(
      sql`INSERT INTO emulators (name, executablePath) VALUES ('offline', 'C:/emu.exe')`,
    );
    const despues = (await db.$client.stats()).cdcOperations;
    await db.$client.close();

    assert.ok(despues > antes, `la escritura offline tenía que encolarse: ${antes} -> ${despues}`);
  });

  it('sin red de verdad: push y pull se niegan sin tocar la red', async () => {
    const dbPath = await baseComoTrasSincronizar();
    const db = drizzle({ connection: localConnectionOptions(dbPath) });
    await db.$client.connect();

    await assert.rejects(() => db.$client.push(), /sync is paused/);
    await assert.rejects(() => db.$client.pull(), /sync is paused/);
    await db.$client.close();
  });
});

describe('isWalOutOfStep', () => {
  it('reconoce el fallo tal como lo lanzó el motor el 9-oct-2026', () => {
    const real =
      'sync engine operation failed: database sync engine error: unable to checkpoint synced portion of WAL: result=CheckpointResult { wal_max_frame: 21599, wal_total_backfilled: 21599, wal_checkpoint_backfilled: 21599, maybe_guard: None, db_truncate_sent: false, db_sync_sent: true, wal_truncate_sent: false, wal_sync_sent: false }, watermark=113169';
    assert.equal(isWalOutOfStep(real), true);
  });

  it('no confunde un corte de red ni un desajuste de esquema', () => {
    assert.equal(isWalOutOfStep('fetch failed'), false);
    assert.equal(isWalOutOfStep('no such table: radar_games'), false);
    assert.equal(isWalOutOfStep('url is empty - sync is paused'), false);
  });
});
