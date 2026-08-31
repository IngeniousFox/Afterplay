import { test, mock, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';

// Borrado de versiones LOCALES (service.ts: deleteLocalBackups) contra una
// carpeta de mentira. Esto hace rmSync recursivo sobre save-backups/, asi que
// lo que se verifica aqui no es contabilidad: es cuanto se lleva por delante.
//
// La cicatriz: la carpeta entera se tiraba cuando removeBackupsFromMapping
// devolvia false, y ese false significa DOS cosas — "tras la poda no queda
// ninguna version" y "no pude leer el mapping.yaml". Con el indice ilegible
// (parse roto, EBUSY del antivirus, el fichero a medio escribir), borrar UNA
// version de un juego con tres se llevaba las otras dos; y como este camino
// no sella el suelo de poda, el siguiente backup daba por caducado en R2 todo
// el historial del juego. Ahora falla cerrado: sin indice legible no se borra
// nada y se avisa.
//
// R2 no se toca en ningun momento: todo pasa en carpetas temporales de disco.

const TMP_ROOT = join(__dirname, '.tmp-service-backups');

mock.module('../run', {
  namedExports: {
    getBackupDir: () => TMP_ROOT,
  },
});

let deleteLocalBackups: typeof import('../service').deleteLocalBackups;

before(async () => {
  ({ deleteLocalBackups } = await import('../service'));
});

type Fixture = { name: string; bytes: number; children?: { name: string; bytes: number }[] };

// Una carpeta de juego como la deja ludusavi: un mapping.yaml con sus nodos
// (los diferenciales anidados en children[]) y un zip por version.
const writeGameFolder = (folderName: string, ludusaviName: string, backups: Fixture[]): void => {
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
        children: (backup.children ?? []).map((child) => ({
          name: child.name,
          when: '2026-01-02T00:00:00Z',
          files: { 'C:/save.dat': { size: child.bytes } },
        })),
      })),
    }),
  );
  for (const backup of backups) {
    writeFileSync(join(dir, backup.name), Buffer.alloc(backup.bytes, 1));
    for (const child of backup.children ?? []) {
      writeFileSync(join(dir, child.name), Buffer.alloc(child.bytes, 1));
    }
  }
};

const mappingNames = (folderName: string): string[] => {
  const mapping = parse(readFileSync(join(TMP_ROOT, folderName, 'mapping.yaml'), 'utf-8')) as {
    backups?: { name: string; children?: { name: string }[] }[];
  };
  return (mapping.backups ?? []).flatMap((full) => [
    full.name,
    ...(full.children ?? []).map((child) => child.name),
  ]);
};

beforeEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
});

after(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

test('mapping.yaml ilegible: no se borra NADA, ni el zip pedido ni la carpeta', () => {
  const dir = join(TMP_ROOT, 'Celeste');
  mkdirSync(dir, { recursive: true });
  // El indice existe pero no se deja interpretar: es lo que se ve cuando
  // ludusavi lo esta reescribiendo (no lo hace atomicamente) o cuando el
  // antivirus tiene el fichero agarrado.
  writeFileSync(join(dir, 'mapping.yaml'), '{{{ not valid yaml');
  for (const name of ['backup-1.zip', 'backup-2.zip', 'backup-3.zip']) {
    writeFileSync(join(dir, name), Buffer.alloc(100, 1));
  }

  assert.throws(() => deleteLocalBackups('Celeste', ['backup-2.zip']), /couldn't be read/);

  // Las tres siguen: ni la pedida (fallar cerrado es no borrar NADA) ni las
  // otras dos, que es lo que se perdia con la carpeta entera.
  assert.deepEqual(readdirSync(dir).sort(), [
    'backup-1.zip',
    'backup-2.zip',
    'backup-3.zip',
    'mapping.yaml',
  ]);
});

test('borrar una version de tres: se va solo esa, la carpeta y el resto siguen', () => {
  writeGameFolder('Celeste', 'Celeste', [
    { name: 'backup-20260101T000000Z-1.zip', bytes: 100 },
    { name: 'backup-20260102T000000Z-2.zip', bytes: 200 },
    { name: 'backup-20260103T000000Z-3.zip', bytes: 300 },
  ]);

  deleteLocalBackups('Celeste', ['backup-20260102T000000Z-2.zip']);

  const dir = join(TMP_ROOT, 'Celeste');
  assert.equal(existsSync(join(dir, 'backup-20260102T000000Z-2.zip')), false);
  assert.equal(existsSync(join(dir, 'backup-20260101T000000Z-1.zip')), true);
  assert.equal(existsSync(join(dir, 'backup-20260103T000000Z-3.zip')), true);
  // Y el indice deja de listarla: si siguiera ahi, la siguiente lectura
  // ofreceria restaurar una version cuyo zip ya no existe.
  assert.deepEqual(mappingNames('Celeste'), [
    'backup-20260101T000000Z-1.zip',
    'backup-20260103T000000Z-3.zip',
  ]);
});

test('borrar la unica version se lleva la carpeta entera', () => {
  writeGameFolder('Hades', 'Hades', [{ name: 'backup-20260101T000000Z-only.zip', bytes: 500 }]);

  deleteLocalBackups('Hades', ['backup-20260101T000000Z-only.zip']);

  // Un mapping.yaml sin backups solo confunde a la siguiente lectura, asi que
  // la carpeta se recoge sola — y de aqui depende el conteo de la limpieza de
  // Ajustes, que mide por diferencia (localUsage.ts).
  assert.equal(existsSync(join(TMP_ROOT, 'Hades')), false);
});

test('borrar un completo se lleva sus diferenciales: sin el no se pueden restaurar', () => {
  writeGameFolder('Hollow Knight', 'Hollow Knight', [
    {
      name: 'backup-20260101T000000Z-full.zip',
      bytes: 400,
      children: [{ name: 'backup-20260102T000000Z-diff.zip', bytes: 40 }],
    },
  ]);

  deleteLocalBackups('Hollow Knight', ['backup-20260101T000000Z-full.zip']);

  // Este SI es el borrado en cascada querido (§9.1): un diferencial vive
  // dentro del nodo de su completo y sin ese zip no se restaura de todas
  // formas. Lo que no puede pasar —y es lo que comprueba el primer test— es
  // que la cascada la dispare un indice que no se pudo leer.
  assert.equal(existsSync(join(TMP_ROOT, 'Hollow Knight')), false);
});

test('carpeta sin mapping.yaml: se recoge igual, no hay indice que respetar', () => {
  // Distinto del primer test a proposito: aqui no hay indice que leer, no un
  // indice que no se deja leer. Sin mapping.yaml esos zips no los sabe
  // interpretar ni ludusavi, y la copia buena vive en R2 (de donde SIEMPRE se
  // restaura), asi que se recogen en vez de quedarse ocupando disco para
  // siempre — nadie volveria a mirarlos.
  const dir = join(TMP_ROOT, 'Tunic');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'backup-1.zip'), Buffer.alloc(100, 1));

  deleteLocalBackups('Tunic', ['backup-1.zip']);

  assert.equal(existsSync(dir), false);
});

test('juego sin carpeta local: no revienta y no crea nada', () => {
  deleteLocalBackups('Never Backed Up', ['backup-1.zip']);
  assert.deepEqual(readdirSync(TMP_ROOT), []);
});
