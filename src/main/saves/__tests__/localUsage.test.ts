import { test, mock, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';

// Verificación de CARACTERIZACIÓN del mantenimiento de save-backups/ local
// (localUsage.ts) contra una carpeta de mentira, ANTES de confiar en algo
// que hace rmSync recursivo sobre disco de verdad. Cuatro escenarios reales:
//
//   1. Un juego con una versión ya sincronizada (fila en el índice) y otra
//      SIN subir todavía -> se borra solo la sincronizada, la otra se queda.
//   2. Un juego cuya ÚNICA versión está sincronizada -> tras borrarla, la
//      carpeta entera desaparece sola (deleteLocalBackups ya lo hace).
//   3. Una carpeta huérfana (nombre que ni el índice ni ningún juego
//      reconocen) -> se borra ENTERA, aunque nada de ella esté "sincronizado".
//   4. Una carpeta con mapping.yaml corrupto/ilegible -> se cuenta en el
//      total, pero NUNCA se marca huérfana ni se toca: ante la duda, no borrar.
//
// Y sin R2 configurado, nada es reclamable ni se borra nunca — es la única
// copia que existe.

const TMP_ROOT = join(__dirname, '.tmp-local-backups');

let machineId = 'machine-under-test';
let r2Configured = true;
let ownEntries: { ludusaviName: string; backupName: string; sizeBytes: number }[] = [];
let knownNames: string[] = [];

mock.module('../run', {
  namedExports: {
    getBackupDir: () => TMP_ROOT,
  },
});
mock.module('../machine', {
  namedExports: {
    getMachineId: () => machineId,
  },
});
mock.module('../r2', {
  namedExports: {
    isR2Configured: () => r2Configured,
  },
});
mock.module('../../db/queries/saves/getLocalBackupsIndex', {
  namedExports: {
    getOwnBackupEntries: async () => ownEntries,
    getKnownLudusaviNames: async () => knownNames,
  },
});

let getLocalBackupsUsage: typeof import('../localUsage').getLocalBackupsUsage;
let cleanLocalBackups: typeof import('../localUsage').cleanLocalBackups;

before(async () => {
  ({ getLocalBackupsUsage, cleanLocalBackups } = await import('../localUsage'));
});

// Fixture mínima válida: un mapping.yaml con un único backup completo cuyo
// tamaño real es el de los bytes que se escriben en el zip.
const writeGameFolder = (
  folderName: string,
  ludusaviName: string,
  backups: { name: string; bytes: number }[],
): void => {
  const dir = join(TMP_ROOT, folderName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'mapping.yaml'),
    stringify({
      name: ludusaviName,
      backups: backups.map((backup) => ({
        name: backup.name,
        when: '2026-01-01T00:00:00Z',
        files: { 'C:/save.dat': { size: backup.bytes } },
      })),
    }),
  );
  for (const backup of backups) {
    writeFileSync(join(dir, backup.name), Buffer.alloc(backup.bytes, 1));
  }
};

// mapping.yaml PESA — su propio texto YAML — y totalBytes/totalFiles lo
// cuentan a propósito (es disco real). Se mide en vez de asumir un número:
// varía con cuántos backups y qué nombre de juego lleve cada fixture.
const mappingSize = (folderName: string): number =>
  statSync(join(TMP_ROOT, folderName, 'mapping.yaml')).size;

beforeEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
  machineId = 'machine-under-test';
  r2Configured = true;
  ownEntries = [];
  knownNames = [];
});

after(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

test('sin carpeta save-backups/, todo a cero y sin reventar', async () => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  const usage = await getLocalBackupsUsage();
  assert.deepEqual(usage, {
    totalBytes: 0,
    totalFiles: 0,
    reclaimableBytes: 0,
    reclaimableFiles: 0,
    orphanBytes: 0,
    orphanFolders: 0,
  });
  const result = await cleanLocalBackups();
  assert.deepEqual(result, { files: 0, bytes: 0, folders: 0 });
});

test('version sincronizada se borra, la version SIN subir se queda', async () => {
  writeGameFolder('Alive Game', 'Alive Game', [
    { name: 'backup-20260101T000000Z-1.zip', bytes: 1000 }, // sincronizada
    { name: 'backup-20260102T000000Z-2.zip', bytes: 500 }, // sin subir aun
  ]);
  knownNames = ['Alive Game'];
  ownEntries = [
    { ludusaviName: 'Alive Game', backupName: 'backup-20260101T000000Z-1.zip', sizeBytes: 1000 },
  ];

  const mapping = mappingSize('Alive Game');
  const usage = await getLocalBackupsUsage();
  assert.equal(usage.totalFiles, 3); // 2 zips + mapping.yaml
  assert.equal(usage.totalBytes, 1500 + mapping);
  assert.equal(usage.reclaimableFiles, 1);
  assert.equal(usage.reclaimableBytes, 1000);
  assert.equal(usage.orphanFolders, 0);

  const result = await cleanLocalBackups();
  assert.deepEqual(result, { files: 1, bytes: 1000, folders: 0 });

  const dir = join(TMP_ROOT, 'Alive Game');
  assert.equal(existsSync(join(dir, 'backup-20260101T000000Z-1.zip')), false);
  assert.equal(existsSync(join(dir, 'backup-20260102T000000Z-2.zip')), true);
  assert.equal(existsSync(join(dir, 'mapping.yaml')), true);
});

test('un juego totalmente sincronizado desaparece entero (carpeta vacia se recoge sola)', async () => {
  writeGameFolder('Stale Game', 'Stale Game', [
    { name: 'backup-20260101T000000Z-only.zip', bytes: 2000 },
  ]);
  knownNames = ['Stale Game'];
  ownEntries = [
    { ludusaviName: 'Stale Game', backupName: 'backup-20260101T000000Z-only.zip', sizeBytes: 2000 },
  ];

  const mapping = mappingSize('Stale Game');
  const before = await getLocalBackupsUsage();
  assert.equal(before.reclaimableBytes, 2000);

  const result = await cleanLocalBackups();
  // La única versión se va Y con ella la carpeta entera, mapping.yaml
  // incluido — deleteLocalBackups la recoge sola al quedar vacía.
  assert.deepEqual(result, { files: 2, bytes: 2000 + mapping, folders: 0 });
  assert.equal(existsSync(join(TMP_ROOT, 'Stale Game')), false);

  const after = await getLocalBackupsUsage();
  assert.deepEqual(after, {
    totalBytes: 0,
    totalFiles: 0,
    reclaimableBytes: 0,
    reclaimableFiles: 0,
    orphanBytes: 0,
    orphanFolders: 0,
  });
});

test('carpeta huerfana (nadie la reclama) se borra ENTERA aunque no tenga fila', async () => {
  writeGameFolder('Ghost Game', 'Ghost Game', [{ name: 'backup-x.zip', bytes: 777 }]);
  // Ni el índice ni ningún juego actual mencionan "Ghost Game".
  knownNames = ['Some Other Game'];
  ownEntries = [];

  const mapping = mappingSize('Ghost Game');
  const usage = await getLocalBackupsUsage();
  assert.equal(usage.orphanFolders, 1);
  // orphanBytes cuenta la carpeta ENTERA, mapping.yaml incluido — se borra
  // todo junto (rmSync recursivo), no zip a zip.
  assert.equal(usage.orphanBytes, 777 + mapping);
  assert.equal(usage.reclaimableBytes, 0); // no hay fila, no cuenta como "sincronizada"

  const result = await cleanLocalBackups();
  assert.deepEqual(result, { files: 2, bytes: 777 + mapping, folders: 1 }); // zip + mapping.yaml
  assert.equal(existsSync(join(TMP_ROOT, 'Ghost Game')), false);
});

test('mapping.yaml ilegible: cuenta en el total pero jamas se marca huerfana ni se toca', async () => {
  const dir = join(TMP_ROOT, 'Broken Game');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mapping.yaml'), '{{{ not valid yaml');
  writeFileSync(join(dir, 'backup-broken.zip'), Buffer.alloc(300, 1));
  knownNames = [];
  ownEntries = [];

  const brokenMapping = statSync(join(dir, 'mapping.yaml')).size;
  const usage = await getLocalBackupsUsage();
  assert.equal(usage.totalFiles, 2); // zip + el propio mapping.yaml roto
  assert.equal(usage.totalBytes, 300 + brokenMapping);
  assert.equal(usage.orphanFolders, 0); // NO se marca huerfana sin poder leer el nombre real

  const result = await cleanLocalBackups();
  assert.deepEqual(result, { files: 0, bytes: 0, folders: 0 });
  assert.equal(existsSync(dir), true); // intacta
});

test('sin R2 configurado, nada es reclamable ni se borra — es la unica copia', async () => {
  r2Configured = false;
  writeGameFolder('Alive Game', 'Alive Game', [{ name: 'backup-1.zip', bytes: 1000 }]);
  writeGameFolder('Ghost Game', 'Ghost Game', [{ name: 'backup-x.zip', bytes: 777 }]);
  knownNames = []; // aunque "Ghost Game" sería huérfana según el índice...
  ownEntries = [{ ludusaviName: 'Alive Game', backupName: 'backup-1.zip', sizeBytes: 1000 }];

  const usage = await getLocalBackupsUsage();
  // getOwnBackupEntries ni se llama (r2Configured=false), así que nada
  // aparece como sincronizado — pero el barrido de huérfanas SÍ sigue
  // funcionando (no depende de R2, solo de qué reconoce la biblioteca/índice).
  assert.equal(usage.reclaimableBytes, 0);

  const result = await cleanLocalBackups();
  // cleanLocalBackups sale en seco sin R2: ni borra sincronizadas ni huérfanas.
  assert.deepEqual(result, { files: 0, bytes: 0, folders: 0 });
  assert.equal(existsSync(join(TMP_ROOT, 'Alive Game')), true);
  assert.equal(existsSync(join(TMP_ROOT, 'Ghost Game')), true);
});

test('multiples juegos a la vez: cada uno se resuelve por su cuenta', async () => {
  writeGameFolder('Game A', 'Game A', [{ name: 'backup-a.zip', bytes: 100 }]);
  writeGameFolder('Game B', 'Game B', [{ name: 'backup-b.zip', bytes: 200 }]);
  writeGameFolder('Game C (Orphan)', 'Game C', [{ name: 'backup-c.zip', bytes: 300 }]);
  knownNames = ['Game A', 'Game B'];
  ownEntries = [
    { ludusaviName: 'Game A', backupName: 'backup-a.zip', sizeBytes: 100 },
    // Game B: fila NO existe -> no reclamable, pero SÍ conocido (no huérfano).
  ];

  const mapA = mappingSize('Game A');
  const mapB = mappingSize('Game B');
  const mapC = mappingSize('Game C (Orphan)');

  const usage = await getLocalBackupsUsage();
  assert.equal(usage.totalBytes, 600 + mapA + mapB + mapC);
  assert.equal(usage.reclaimableBytes, 100);
  assert.equal(usage.orphanBytes, 300 + mapC);
  assert.equal(usage.orphanFolders, 1);

  const result = await cleanLocalBackups();
  // Game A: zip + mapping.yaml (única versión, sincronizada -> se va entera).
  // Game C: zip + mapping.yaml (huérfana -> se va entera).
  assert.deepEqual(result, { files: 4, bytes: 400 + mapA + mapC, folders: 1 });
  assert.equal(existsSync(join(TMP_ROOT, 'Game A')), false); // solo tenía esa version -> se fue entera
  assert.equal(existsSync(join(TMP_ROOT, 'Game B')), true); // conocido, sin fila -> intacto
  assert.equal(readdirSync(join(TMP_ROOT, 'Game B')).length, 2); // mapping.yaml + backup-b.zip
  assert.equal(existsSync(join(TMP_ROOT, 'Game C (Orphan)')), false);
});
