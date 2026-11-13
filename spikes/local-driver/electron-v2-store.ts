// Fase 2 (AFTERPLAY-2.0.md §8.9, §20.3): ¿funcionan `drizzle-orm/node-sqlite`,
// su migrador y la puerta de escritura dentro del binario de Electron del
// repo (Node 24), y no solo en el Node 22 de los tests?
//
// Electron no ejecuta TypeScript, así que se empaqueta antes con esbuild
// (que ya viene con tsx) fuera del repositorio y se lanza el resultado:
//
//   npx esbuild spikes/local-driver/electron-v2-store.ts --bundle --platform=node \
//     --format=cjs --external:electron --outfile=<carpeta temporal>/electron-v2-store.cjs
//   npx electron <carpeta temporal>/electron-v2-store.cjs <ruta absoluta a drizzle-v2>
//
// No abre ninguna ventana, usa una base en una carpeta temporal nueva que
// borra al terminar, y sale solo. No toca datos de nadie.
import { app } from 'electron';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalDatabase } from '../../src/main/db/v2/connection';

const DEVICE = '0194c2f0-aaaa-7000-8000-00000000000a';

function run(migrationsFolder: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'afterplay-v2-electron-'));
  const path = join(dir, 'Afterplay2.db');
  try {
    const first = openLocalDatabase({ path, deviceId: DEVICE, migrationsFolder });
    const { store } = first;
    store.create('devices', {
      id: DEVICE,
      name: 'PC-A',
      kind: 'desktop',
      os: 'windows',
      firstSeenAt: new Date(),
    });
    const { id: gameId } = store.create('games', {
      title: 'Celeste',
      igdbId: 26226,
      addedAt: new Date(),
    });
    const noChange = store.patch('games', gameId, { title: 'Celeste' }).changed.length;
    const changed = store.patch('games', gameId, { notes: 'desde Electron' }).changed;
    const lastClock = first.clock.peek();
    first.close();

    // Reabrir: el migrador no repite y el reloj arranca por encima.
    const second = openLocalDatabase({ path, deviceId: DEVICE, migrationsFolder });
    const row = second.db.$client
      .prepare('SELECT notes, syncDirty, syncUpdated FROM games WHERE id = ?')
      .get(gameId);
    const migrations = second.db.$client
      .prepare('SELECT count(*) AS n FROM __drizzle_migrations')
      .get();
    const journal = second.db.$client.prepare('PRAGMA journal_mode').get();
    const sqliteVersion = second.db.$client.prepare('SELECT sqlite_version() AS v').get();
    const next = second.clock.now();
    second.close();

    const ok =
      noChange === 0 &&
      changed.join() === 'notes' &&
      row?.notes === 'desde Electron' &&
      row?.syncDirty === 1 &&
      migrations?.n === 1 &&
      journal?.journal_mode === 'wal' &&
      next > lastClock;
    return [
      ok ? 'OK' : 'FALLO',
      `electron ${process.versions.electron}`,
      `node ${process.versions.node}`,
      `sqlite ${String(sqliteVersion?.v)}`,
      `migraciones ${String(migrations?.n)}`,
      `journal ${String(journal?.journal_mode)}`,
      `parche sin cambio: ${noChange} columnas`,
      `reloj al reabrir ${next} > ${lastClock}`,
    ].join(' | ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

app.whenReady().then(() => {
  const migrationsFolder = process.argv[process.argv.length - 1];
  try {
    console.log(`[v2-store] ${run(migrationsFolder)}`);
    app.exit(0);
  } catch (error) {
    console.log(`[v2-store] ERROR: ${(error as Error).stack ?? String(error)}`);
    app.exit(1);
  }
});
