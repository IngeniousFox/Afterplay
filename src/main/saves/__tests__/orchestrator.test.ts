import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { parse } from 'yaml';
import type { SaveBackupRow } from '../../../shared/dto';
import {
  asOtherDevice,
  seedGame,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import type { QueryContext } from '../../db/v2/queries/common';
import {
  getLastSyncedHash,
  getSaveGame,
  listSaveBackups,
  listSaveLineage,
  setLastSyncedHash,
  type SaveGame,
} from '../../db/v2/queries/saves';
import { openSavesDb } from '../../db/v2/queries/saves/__tests__/fixture';
import { computeContentHash } from '../contentHash';
import type { BackupMapping } from '../types';
import { createFakeBucket } from './fakeBucket';
import {
  ROOT_HOME,
  SAVE_PATH,
  addLocalBackup,
  h,
  mappingYaml,
  namesOf,
  readLocalMapping,
  type FakeBackupSpec,
} from './saveFixtures';

// Orquestación de partidas (orchestrator.ts): espejo a la nube, lápidas de
// otros PCs (E-19), puerta de identidad (E-20), fusión del mapping.yaml,
// redirects y estado de la ficha. ludusavi, el bucket, la base y la identidad
// son de mentira; las carpetas son temporales. Datos inventados.

const bucket = createFakeBucket();
const dbRef: { ctx: QueryContext | null } = { ctx: null };
let root = '';
const events: string[] = [];

const identityState: { assertError: Error | null } = { assertError: null };
const machineState: { home: string; floor: Date | null } = { home: ROOT_HOME, floor: null };

type LudusaviCall = { args: string[] };
const ludusavi: {
  calls: LudusaviCall[];
  files: { path: string; bytes: number }[];
  registry: string[];
  onBackup: (() => void) | null;
  previewGame: boolean;
  failPreview: boolean;
} = { calls: [], files: [], registry: [], onBackup: null, previewGame: true, failPreview: false };

const backupDir = (): string => join(root, 'save-backups');

mock.module('electron', {
  namedExports: { app: { getPath: () => root }, dialog: {} },
});
mock.module('../r2', { namedExports: bucket.r2Exports() });
mock.module('../binary', { namedExports: { isLudusaviAvailable: () => true } });
mock.module('../../watcher/runningGames', { namedExports: { isGameRunning: () => false } });
mock.module('../../db/v2/appDb', { namedExports: { appCtx: () => dbRef.ctx as QueryContext } });
mock.module('../machine', {
  namedExports: {
    getMachineHome: () => machineState.home,
    getPruneFloor: () => machineState.floor,
  },
});
mock.module('../identity', {
  namedExports: {
    assertInstallIdentity: async () => {
      events.push('assert');
      if (identityState.assertError) throw identityState.assertError;
    },
    ensureIdentityBeforeUpload: async () => {
      events.push('ensure');
    },
  },
});
mock.module('../run', {
  namedExports: {
    getBackupDir: backupDir,
    getConfigDir: () => join(root, 'ludusavi-config'),
    getRestoreWorkspaceDir: () => join(root, 'save-restore-tmp'),
    ensureSavesDirs: () => mkdirSync(backupDir(), { recursive: true }),
    ensureLudusaviReady: async () => {},
    runLudusavi: async (args: string[]) => {
      ludusavi.calls.push({ args });
      const name = args[args.length - 1];
      const entry = {
        files: Object.fromEntries(ludusavi.files.map((file) => [file.path, { bytes: file.bytes }])),
        registry: Object.fromEntries(ludusavi.registry.map((key) => [key, {}])),
      };
      if (args[0] === 'backup' && args.includes('--preview')) {
        if (ludusavi.failPreview) throw new Error('ludusavi no responde');
        return {
          games: ludusavi.previewGame ? { [name]: entry } : {},
          overall: { changedGames: { same: 1 } },
        };
      }
      if (args[0] === 'backup') {
        events.push('ludusavi-backup');
        ludusavi.onBackup?.();
        return { games: { [name]: entry } };
      }
      return { games: { [name]: { files: {} } } };
    },
  },
});

type Orchestrator = typeof import('../orchestrator');
let orchestrator: Orchestrator;

before(async () => {
  orchestrator = await import('../orchestrator');
});
after(() => mock.reset());

let fx: QueryFixture;
let game: SaveGame;
let gameId: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'afterplay-saves-orch-'));
  bucket.objects.clear();
  bucket.resetWrites();
  bucket.failNext = {};
  bucket.config = { bucket: 'bucket-de-prueba', destination: 'destino-de-prueba' };
  events.length = 0;
  identityState.assertError = null;
  machineState.home = ROOT_HOME;
  machineState.floor = null;
  ludusavi.calls = [];
  ludusavi.files = [{ path: SAVE_PATH, bytes: 10 }];
  ludusavi.registry = [];
  ludusavi.onBackup = null;
  ludusavi.previewGame = true;
  ludusavi.failPreview = false;
  fx = openSavesDb();
  dbRef.ctx = fx.ctx;
  gameId = seedGame(fx.ctx, {
    title: 'Celeste',
    igdbId: 26226,
    saveLudusaviName: 'Celeste',
    saveBackupEnabled: true,
  });
  game = getSaveGame(fx.ctx, gameId) as SaveGame;
});
afterEach(() => {
  fx.close();
  rmSync(root, { recursive: true, force: true });
});

const gameDir = (): string => join(backupDir(), 'Celeste');
const prefix = (): string => `saves/26226/${fx.ctx.deviceId}/`;
const key = (name: string): string => `${prefix()}${name}`;

const V1 = 'backup-20260101T000000Z.zip';
const V2 = 'backup-20260102T000000Z.zip';

const spec = (
  name: string,
  when: string,
  hash: string,
  extra: Partial<FakeBackupSpec> = {},
): FakeBackupSpec => ({
  name,
  when,
  files: { [SAVE_PATH]: { hash, size: 10 } },
  ...extra,
});
const S1 = spec(V1, '2026-01-01T00:00:00Z', h('1'));
const S2 = spec(V2, '2026-01-02T00:00:00Z', h('2'));

/** La huella que el espejo tiene que calcular para una copia con ese hash de archivo. */
const expectedHash = (fileHash: string, home = ROOT_HOME): string | null =>
  computeContentHash({ files: [{ path: SAVE_PATH, hash: fileHash }], registryHash: null, home });

const backup = (): ReturnType<Orchestrator['backupGameToCloud']> =>
  orchestrator.backupGameToCloud(game, [game]);
const rowsOf = (): ReturnType<typeof listSaveBackups> => listSaveBackups(fx.ctx, gameId);
const rowOf = (name: string): ReturnType<typeof listSaveBackups>[number] | undefined =>
  rowsOf().find((row) => row.backupName === name);
const rawHashes = (): Map<string, { hash: unknown; parent: unknown }> => {
  const out = new Map<string, { hash: unknown; parent: unknown }>();
  for (const row of fx.ctx.db.$client
    .prepare('SELECT backupName, contentHash, parentContentHash FROM "save_backups"')
    .all() as { backupName: string; contentHash: unknown; parentContentHash: unknown }[]) {
    out.set(row.backupName, { hash: row.contentHash, parent: row.parentContentHash });
  }
  return out;
};

describe('backupGameToCloud: el espejo a la nube', () => {
  it('sin nombre de ludusavi no hace nada, ni siquiera comprueba la identidad', async () => {
    const bare = seedGame(fx.ctx, { title: 'Sin emparejar' });
    const result = await orchestrator.backupGameToCloud(getSaveGame(fx.ctx, bare) as SaveGame, []);
    assert.equal(result, null);
    assert.deepEqual(events, []);
  });

  it('sin archivos de partida: foundFiles false y el bucket intacto', async () => {
    ludusavi.files = [];
    const result = await backup();
    assert.deepEqual(result, { uploaded: 0, ludusaviName: 'Celeste', foundFiles: false });
    assert.deepEqual(bucket.writes, []);
    assert.equal(rowsOf().length, 0);
  });

  it('primera copia: sube el zip y el mapping, indexa con huella, la identidad va primero', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    const result = await backup();

    assert.deepEqual(result, { uploaded: 1, ludusaviName: 'Celeste', foundFiles: true });
    assert.deepEqual(events, ['assert', 'ludusavi-backup', 'ensure']);
    assert.deepEqual(bucket.keys(), [key('mapping.yaml'), key(V1)].sort());
    // El mapping.yaml sube tal cual (byte a byte), sin reserializar.
    assert.equal(
      bucket.text(key('mapping.yaml')),
      readFileSync(join(gameDir(), 'mapping.yaml'), 'utf-8'),
    );
    const row = rowOf(V1);
    assert.equal(row?.contentHash, expectedHash(h('1')));
    assert.equal(row?.r2Key, key(V1));
    assert.equal(row?.sizeBytes, 64);
    assert.equal(rawHashes().get(V1)?.parent, null);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), expectedHash(h('1')));
  });

  it('la huella no depende de en qué PC se calcule (misma partida, otro usuario)', async () => {
    machineState.home = 'C:/Users/bea';
    const otherPath = 'C:/Users/bea/AppData/Local/Celeste/slot1.sav';
    ludusavi.onBackup = () =>
      addLocalBackup(gameDir(), 'Celeste', {
        ...S1,
        files: { [otherPath]: { hash: h('1'), size: 10 } },
      });
    await backup();
    assert.equal(rowOf(V1)?.contentHash, expectedHash(h('1')));
  });

  it('la segunda pasada sin cambios no sube ningún zip ni duplica filas', async () => {
    ludusavi.onBackup = () => {
      if (!existsSync(join(gameDir(), V1))) addLocalBackup(gameDir(), 'Celeste', S1);
    };
    await backup();
    bucket.resetWrites();
    const second = await backup();
    assert.equal(second?.uploaded, 0);
    assert.deepEqual(bucket.writesOf('upload'), [key('mapping.yaml')]);
    assert.deepEqual(bucket.writesOf('delete'), []);
    assert.equal(rowsOf().length, 1);
  });

  it('encadena el linaje: la nueva desciende de lastSyncedHash y lo mueve', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    await backup();
    ludusavi.onBackup = () =>
      addLocalBackup(
        gameDir(),
        'Celeste',
        spec('backup-20260102T000000Z-diff.zip', '2026-01-02T00:00:00Z', h('2'), {
          parent: V1,
        }),
      );
    const second = await backup();

    assert.equal(second?.uploaded, 1);
    const child = rowOf('backup-20260102T000000Z-diff.zip');
    assert.equal(child?.differential, true);
    assert.equal(child?.parentBackupName, V1);
    assert.equal(child?.contentHash, expectedHash(h('2')));
    assert.equal(rawHashes().get('backup-20260102T000000Z-diff.zip')?.parent, expectedHash(h('1')));
    assert.equal(getLastSyncedHash(fx.ctx, gameId), expectedHash(h('2')));
  });

  it('una copia restaurada entre medias cambia el padre de la siguiente', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    await backup();
    // Este PC restauró otra partida (hash ajeno): el siguiente backup parte de ella.
    setLastSyncedHash(fx.ctx, gameId, 'huella-restaurada');
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S2);
    await backup();
    assert.equal(rawHashes().get(V2)?.parent, 'huella-restaurada');
  });

  it('retira de la nube y del índice lo que la retención local ya no conserva', async () => {
    ludusavi.onBackup = () => {
      addLocalBackup(gameDir(), 'Celeste', S1);
      addLocalBackup(gameDir(), 'Celeste', S2);
    };
    await backup();
    assert.equal(rowsOf().length, 2);

    // ludusavi borró la v1 de su carpeta.
    rmSync(gameDir(), { recursive: true, force: true });
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S2);
    await backup();

    assert.equal(bucket.objects.has(key(V1)), false);
    assert.equal(bucket.objects.has(key(V2)), true);
    assert.deepEqual(
      rowsOf().map((row) => row.backupName),
      [V2],
    );
    // La lápida sigue en el índice (historial de linaje).
    assert.equal(listSaveLineage(fx.ctx, gameId).filter((row) => !row.alive).length, 1);
  });

  it('el suelo de poda protege las versiones remotas anteriores y las que no se saben fechar', async () => {
    machineState.floor = new Date('2026-02-01T00:00:00Z');
    // Lo que esta instalación no vio nunca en local: antes del suelo, después y sin fecha.
    const old = 'backup-20260115T000000Z.zip';
    const late = 'backup-20260301T000000Z.zip';
    const weird = 'copia-rara.zip';
    for (const name of [old, late, weird]) {
      bucket.put(key(name), name);
      fx.ctx.store.create('save_backups', {
        gameId,
        deviceId: fx.ctx.deviceId,
        backupName: name,
        r2Key: key(name),
        ludusaviName: 'Celeste',
        createdAt: new Date('2026-01-15T00:00:00Z'),
        sizeBytes: name.length,
      });
    }
    bucket.put(
      key('mapping.yaml'),
      mappingYaml('Celeste', [
        spec(old, '2026-01-15T00:00:00Z', h('a')),
        spec(late, '2026-03-01T00:00:00Z', h('b')),
        spec(weird, '2026-01-16T00:00:00Z', h('c')),
      ]),
    );
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);

    await backup();

    // Lo posterior al suelo y ausente en local sí caduca; lo anterior y lo
    // que no se sabe fechar se queda en el bucket y en el índice.
    assert.equal(bucket.objects.has(key(old)), true);
    assert.equal(bucket.objects.has(key(weird)), true);
    assert.equal(bucket.objects.has(key(late)), false);
    assert.deepEqual(
      rowsOf()
        .map((row) => row.backupName)
        .sort(),
      [old, weird, V1].sort(),
    );
    // Y el mapping.yaml que queda arriba describe lo local Y lo rescatado.
    const uploaded = parse(bucket.text(key('mapping.yaml')) as string) as BackupMapping;
    assert.deepEqual(namesOf(uploaded).sort(), [old, weird, V1].sort());
  });

  it('con versiones remotas que el local perdió, el mapping subido es la fusión', async () => {
    machineState.floor = new Date('2026-02-01T00:00:00Z');
    const old = 'backup-20260115T000000Z.zip';
    bucket.put(key(old), 'x');
    bucket.put(
      key('mapping.yaml'),
      mappingYaml('Celeste', [spec(old, '2026-01-15T00:00:00Z', h('a'))], {
        drives: { 'drive-C': 'C:' },
      }),
    );
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    await backup();
    const uploaded = parse(bucket.text(key('mapping.yaml')) as string) as BackupMapping;
    assert.deepEqual(namesOf(uploaded).sort(), [old, V1].sort());
    assert.equal(uploaded.drives?.['drive-C'], 'C:');
  });

  for (const [reason, remote] of [
    ['no hay mapping.yaml remoto', null],
    ['el mapping.yaml remoto es ilegible', '{{{ no es yaml'],
  ] as const) {
    it(`si no se puede fusionar (${reason}): no se sube el mapping ni se indexa, y se cura en la siguiente`, async () => {
      machineState.floor = new Date('2026-02-01T00:00:00Z');
      const old = 'backup-20260115T000000Z.zip';
      bucket.put(key(old), 'x');
      if (remote !== null) bucket.put(key('mapping.yaml'), remote);
      const before = bucket.text(key('mapping.yaml'));
      ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);

      const first = await backup();

      // El zip nuevo sí llega, pero sin su nodo arriba no se indexa.
      assert.equal(first?.uploaded, 0);
      assert.equal(bucket.objects.has(key(V1)), true);
      assert.equal(bucket.text(key('mapping.yaml')), before);
      assert.equal(rowOf(V1), undefined);

      // La siguiente pasada, con un mapping remoto legible, lo cura.
      bucket.put(
        key('mapping.yaml'),
        mappingYaml('Celeste', [spec(old, '2026-01-15T00:00:00Z', h('a'))]),
      );
      const second = await backup();
      assert.equal(second?.uploaded, 1);
      assert.equal(rowOf(V1)?.contentHash, expectedHash(h('1')));
    });
  }

  it('un zip que el mapping lista pero no está en disco no genera una fila fantasma', async () => {
    ludusavi.onBackup = () => {
      addLocalBackup(gameDir(), 'Celeste', S1);
      rmSync(join(gameDir(), V1));
    };
    const result = await backup();
    assert.equal(result?.uploaded, 0);
    assert.equal(bucket.objects.has(key(V1)), false);
    assert.equal(rowsOf().length, 0);
  });

  it('un fallo al subir el zip no deja filas (el índice va después del bucket)', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    bucket.failNext.uploadFile = new Error('conexión reiniciada');
    await assert.rejects(backup(), /conexión reiniciada/);
    assert.equal(rowsOf().length, 0);
    assert.equal(getLastSyncedHash(fx.ctx, gameId), null);
    // Reintentar lo completa sin duplicar.
    const retry = await backup();
    assert.equal(retry?.uploaded, 1);
    assert.equal(rowsOf().length, 1);
  });

  it('dos copias del mismo juego a la vez no duplican la versión', async () => {
    ludusavi.onBackup = () => {
      if (!existsSync(join(gameDir(), V1))) addLocalBackup(gameDir(), 'Celeste', S1);
    };
    const [a, b] = await Promise.all([backup(), backup()]);
    assert.equal((a?.uploaded ?? 0) + (b?.uploaded ?? 0), 1);
    assert.equal(rowsOf().length, 1);
  });

  it('backupGameToCloudDetailed devuelve también los archivos que vio ludusavi', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    const detailed = await orchestrator.backupGameToCloudDetailed(game, [game]);
    assert.deepEqual(detailed?.files, [SAVE_PATH]);
    assert.equal(detailed?.result.uploaded, 1);
  });
});

describe('E-19: versiones borradas desde otro PC no resucitan', () => {
  /** Dos completas ya subidas e indexadas. */
  const uploadedTwo = async (): Promise<void> => {
    ludusavi.onBackup = () => {
      addLocalBackup(gameDir(), 'Celeste', S1);
      addLocalBackup(gameDir(), 'Celeste', S2);
    };
    await backup();
    ludusavi.onBackup = null;
    bucket.resetWrites();
    events.length = 0;
  };
  /** La lápida llega por sync (alguien borró la v1 desde otro PC). */
  const tombstoneV1 = (): void => {
    const row = rowOf(V1);
    assert.ok(row);
    fx.ctx.store.remove('save_backups', row.id);
  };

  it('quita su zip de la carpeta local ANTES del backup de ludusavi', async () => {
    await uploadedTwo();
    tombstoneV1();
    let presentDuringBackup: boolean | null = null;
    ludusavi.onBackup = () => {
      presentDuringBackup = existsSync(join(gameDir(), V1));
    };

    await backup();

    assert.equal(presentDuringBackup, false);
    assert.equal(existsSync(join(gameDir(), V1)), false);
    assert.deepEqual(namesOf(readLocalMapping(gameDir())), [V2]);
  });

  it('no lo vuelve a subir, lo borra del bucket y no resucita la fila', async () => {
    await uploadedTwo();
    tombstoneV1();
    assert.equal(bucket.objects.has(key(V1)), true); // sigue arriba

    await backup();

    assert.equal(bucket.writesOf('upload').includes(key(V1)), false);
    assert.equal(bucket.objects.has(key(V1)), false);
    assert.deepEqual(
      rowsOf().map((row) => row.backupName),
      [V2],
    );
  });

  it('si la copia local sigue y el bucket no la tenía, tampoco se sube', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    await backup();
    const row = rowOf(V1);
    assert.ok(row);
    bucket.objects.delete(key(V1));
    fx.ctx.store.remove('save_backups', row.id);
    bucket.resetWrites();

    await backup();

    assert.equal(bucket.writesOf('upload').includes(key(V1)), false);
    assert.equal(rowsOf().length, 0);
  });

  it('el mapping.yaml que se sube ya no lista la versión borrada', async () => {
    await uploadedTwo();
    tombstoneV1();
    await backup();
    const uploaded = parse(bucket.text(key('mapping.yaml')) as string) as BackupMapping;
    assert.deepEqual(namesOf(uploaded), [V2]);
  });

  it('un diferencial colgado del completo borrado se va con él', async () => {
    ludusavi.onBackup = () => {
      addLocalBackup(gameDir(), 'Celeste', S1);
      addLocalBackup(
        gameDir(),
        'Celeste',
        spec('child.zip', '2026-01-01T12:00:00Z', h('9'), { parent: V1 }),
      );
    };
    await backup();
    for (const name of [V1, 'child.zip']) {
      fx.ctx.store.remove('save_backups', (rowOf(name) as { id: string }).id);
    }
    bucket.resetWrites();
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S2);

    await backup();

    assert.equal(existsSync(join(gameDir(), 'child.zip')), false);
    assert.equal(bucket.objects.has(key('child.zip')), false);
    assert.equal(bucket.objects.has(key(V1)), false);
  });

  it('si no se puede borrar el zip local, el backup lanza y no se sube ni se borra NADA', async () => {
    await uploadedTwo();
    tombstoneV1();
    // El zip "agarrado": en su sitio hay algo que rmSync no puede quitar.
    rmSync(join(gameDir(), V1));
    mkdirSync(join(gameDir(), V1));
    writeFileSync(join(gameDir(), V1, 'dentro.bin'), 'x');
    let backedUp = false;
    ludusavi.onBackup = () => {
      backedUp = true;
    };

    await assert.rejects(backup(), /no new backup was made/);

    assert.equal(backedUp, false);
    assert.deepEqual(bucket.writes, []);
    assert.deepEqual(events, ['assert']);
  });

  it('mapping local ilegible con una versión borrada pendiente: no hay backup ni se toca el bucket', async () => {
    await uploadedTwo();
    tombstoneV1();
    writeFileSync(join(gameDir(), 'mapping.yaml'), '{{{ no es yaml');
    bucket.resetWrites();
    let backedUp = false;
    ludusavi.onBackup = () => {
      backedUp = true;
    };

    await assert.rejects(backup(), /couldn't be read/);

    // Sin poder leer el índice local no se sabe si el zip borrado sigue ahí:
    // ni backup (lo resucitaría) ni escrituras en el bucket.
    assert.equal(backedUp, false);
    assert.deepEqual(bucket.writes, []);
    assert.equal(existsSync(join(gameDir(), V1)), true);
  });

  // Con el mapping.yaml local ilegible (antivirus, fichero a medias) readMapping
  // devuelve null. Tratarlo como "no hay versiones" haría que el espejo diera
  // por caducado todo lo de este PC, lo borrara del bucket y subiera el
  // mapping roto encima del bueno: el espejo falla cerrado, como
  // deleteLocalBackups.
  it('mapping local ilegible: ni poda el bucket ni sube el mapping roto', async () => {
    await uploadedTwo();
    const good = bucket.text(key('mapping.yaml'));
    writeFileSync(join(gameDir(), 'mapping.yaml'), '{{{ no es yaml');
    bucket.resetWrites();

    await assert.rejects(backup(), /couldn't be read/);

    assert.deepEqual(bucket.writes, []);
    assert.equal(bucket.objects.has(key(V1)), true);
    assert.equal(bucket.objects.has(key(V2)), true);
    assert.equal(bucket.text(key('mapping.yaml')), good);
    assert.notEqual(rowOf(V1), undefined);
    assert.notEqual(rowOf(V2), undefined);
  });
});

describe('E-20: la puerta de identidad', () => {
  it('si assertInstallIdentity lanza, no hay backup local ni se toca el bucket', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    bucket.put(key('previo.zip'), 'x');
    bucket.resetWrites();
    const error = new Error('Another Afterplay installation is using this PC identity');
    identityState.assertError = error;

    await assert.rejects(backup(), (thrown) => thrown === error);

    assert.deepEqual(bucket.writes, []);
    assert.deepEqual(events, ['assert']);
    assert.equal(existsSync(gameDir()), false); // ludusavi ni se ejecutó
    assert.deepEqual(bucket.keys(), [key('previo.zip')]);
    assert.equal(rowsOf().length, 0);
  });

  it('también con la versión borrada pendiente: ni poda ni subida', async () => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    await backup();
    fx.ctx.store.remove('save_backups', (rowOf(V1) as { id: string }).id);
    bucket.resetWrites();
    identityState.assertError = new Error('duplicado');

    await assert.rejects(backup(), /duplicado/);

    assert.deepEqual(bucket.writes, []);
    // El zip local sigue: ni siquiera se limpió antes de la puerta.
    assert.equal(existsSync(join(gameDir(), V1)), true);
  });
});

describe('mergeRemoteMapping', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- nodo de mapping de prueba
  const node = (name: string, when: string, children: string[] = []) => ({
    name,
    when,
    files: {},
    children: children.map((child, index) => ({
      name: child,
      when: `${when.slice(0, 10)}T0${index + 1}:00:00Z`,
      files: {},
    })),
  });
  const all = (): boolean => true;

  it('sin completos remotos devuelve el local tal cual', () => {
    const local: BackupMapping = { name: 'J', backups: [node('a.zip', '2026-01-01T00:00:00Z')] };
    assert.equal(orchestrator.mergeRemoteMapping(local, { name: 'J', backups: [] }, all), local);
    assert.equal(orchestrator.mergeRemoteMapping(local, { name: 'J' }, all), local);
  });

  it('rescata los completos que solo existen en el bucket y siguen vivos', () => {
    const local: BackupMapping = { name: 'J', backups: [node('c.zip', '2026-01-03T00:00:00Z')] };
    const remote: BackupMapping = {
      name: 'J',
      backups: [
        node('a.zip', '2026-01-01T00:00:00Z'),
        node('b.zip', '2026-01-02T00:00:00Z'),
        node('c.zip', '2026-01-03T00:00:00Z'),
      ],
    };
    const merged = orchestrator.mergeRemoteMapping(local, remote, (name) => name !== 'b.zip');
    // Orden cronológico y sin el que ya no está arriba.
    assert.deepEqual(
      merged.backups?.map((full) => full.name),
      ['a.zip', 'c.zip'],
    );
  });

  it('un completo remoto se lleva sus diferenciales no supervivientes', () => {
    const local: BackupMapping = { name: 'J', backups: [] };
    const remote: BackupMapping = {
      name: 'J',
      backups: [node('a.zip', '2026-01-01T00:00:00Z', ['a1.zip', 'a2.zip'])],
    };
    const merged = orchestrator.mergeRemoteMapping(local, remote, (name) => name !== 'a2.zip');
    assert.deepEqual(
      merged.backups?.[0].children?.map((child) => child.name),
      ['a1.zip'],
    );
  });

  it('un completo que ya no está arriba arrastra a sus diferenciales aunque estos sigan', () => {
    const local: BackupMapping = { name: 'J', backups: [] };
    const remote: BackupMapping = {
      name: 'J',
      backups: [node('a.zip', '2026-01-01T00:00:00Z', ['a1.zip'])],
    };
    const merged = orchestrator.mergeRemoteMapping(local, remote, (name) => name === 'a1.zip');
    assert.deepEqual(merged.backups, []);
  });

  it('rescata un diferencial que el completo local ya no lista pero el bucket conserva', () => {
    const local: BackupMapping = {
      name: 'J',
      backups: [node('a.zip', '2026-01-01T00:00:00Z', ['a1.zip'])],
    };
    const remote: BackupMapping = {
      name: 'J',
      backups: [node('a.zip', '2026-01-01T00:00:00Z', ['a1.zip', 'a2.zip', 'a3.zip'])],
    };
    const merged = orchestrator.mergeRemoteMapping(local, remote, (name) => name !== 'a3.zip');
    assert.deepEqual(
      merged.backups?.[0].children?.map((child) => child.name),
      ['a1.zip', 'a2.zip'],
    );
  });

  it('manda el nodo local cuando el mismo existe en los dos', () => {
    const local: BackupMapping = {
      name: 'J',
      backups: [
        {
          name: 'a.zip',
          when: '2026-01-01T00:00:00Z',
          files: { 'C:/x': { hash: 'LOCAL', size: 1 } },
        },
      ],
    };
    const remote: BackupMapping = {
      name: 'J',
      backups: [
        {
          name: 'a.zip',
          when: '2026-01-01T00:00:00Z',
          files: { 'C:/x': { hash: 'REMOTO', size: 1 } },
        },
      ],
    };
    const merged = orchestrator.mergeRemoteMapping(local, remote, all);
    assert.equal(merged.backups?.[0].files?.['C:/x']?.hash, 'LOCAL');
  });

  it('fusiona las unidades (drives): manda la local y se rescatan las remotas', () => {
    const local: BackupMapping = {
      name: 'J',
      drives: { 'drive-C': 'C:' },
      backups: [node('c.zip', '2026-01-03T00:00:00Z')],
    };
    const remote: BackupMapping = {
      name: 'J',
      drives: { 'drive-C': 'X:', 'drive-D': 'D:' },
      backups: [node('a.zip', '2026-01-01T00:00:00Z')],
    };
    const merged = orchestrator.mergeRemoteMapping(local, remote, all);
    assert.deepEqual(merged.drives, { 'drive-C': 'C:', 'drive-D': 'D:' });
  });

  it('conserva las claves del mapping local que no conoce', () => {
    const local = {
      name: 'J',
      futuro: { clave: 1 },
      backups: [node('c.zip', '2026-01-03T00:00:00Z')],
    } as BackupMapping;
    const remote: BackupMapping = { name: 'J', backups: [node('a.zip', '2026-01-01T00:00:00Z')] };
    const merged = orchestrator.mergeRemoteMapping(local, remote, all) as BackupMapping & {
      futuro?: unknown;
    };
    assert.deepEqual(merged.futuro, { clave: 1 });
  });

  it('sin drives en ninguno no inventa la clave', () => {
    const local: BackupMapping = { name: 'J', backups: [] };
    const remote: BackupMapping = { name: 'J', backups: [node('a.zip', '2026-01-01T00:00:00Z')] };
    assert.equal(orchestrator.mergeRemoteMapping(local, remote, all).drives, undefined);
  });
});

describe('buildRedirects', () => {
  const row = (machineHome: string): SaveBackupRow => ({ machineHome }) as unknown as SaveBackupRow;
  const restore = (
    source: string,
    target: string,
  ): { kind: string; source: string; target: string } => ({ kind: 'restore', source, target });

  it('in-place con otra carpeta de usuario: un redirect de usuario, el último', () => {
    assert.deepEqual(orchestrator.buildRedirects(row('C:/Users/bea'), 'in-place', null, []), [
      restore('C:/Users/bea', ROOT_HOME),
    ]);
  });

  it('in-place con el mismo home (da igual mayúsculas y barras): ninguno', () => {
    assert.deepEqual(orchestrator.buildRedirects(row(ROOT_HOME), 'in-place', null, []), []);
    assert.deepEqual(orchestrator.buildRedirects(row('c:\\users\\ANA'), 'in-place', null, []), []);
  });

  it('un home desconocido no redirige', () => {
    assert.deepEqual(orchestrator.buildRedirects(row(''), 'in-place', null, []), []);
  });

  it('in-place ignora el destino', () => {
    assert.deepEqual(
      orchestrator.buildRedirects(row(ROOT_HOME), 'in-place', 'D:/otro', ['C:/Users/ana/Saves']),
      [],
    );
  });

  it('otra carpeta con UNA ubicación: aterriza tal cual en el destino (y el de usuario, al final)', () => {
    assert.deepEqual(
      orchestrator.buildRedirects(row('C:/Users/bea'), 'custom-path', 'D:\\Juegos\\Celeste\\', [
        'C:/Users/bea/Saves',
      ]),
      [restore('C:/Users/bea/Saves', 'D:/Juegos/Celeste'), restore('C:/Users/bea', ROOT_HOME)],
    );
  });

  it('otra carpeta con varias ubicaciones: cada una en su subcarpeta, sin mezclarse', () => {
    assert.deepEqual(
      orchestrator.buildRedirects(row(ROOT_HOME), 'custom-path', 'D:/x', [
        'C:/Users/ana/Documents/Saves',
        'C:/Users/ana/AppData/Saves',
        'C:/Users/ana/Other/Saves',
      ]),
      [
        restore('C:/Users/ana/Documents/Saves', 'D:/x/Saves'),
        restore('C:/Users/ana/AppData/Saves', 'D:/x/Saves-2'),
        restore('C:/Users/ana/Other/Saves', 'D:/x/Saves-3'),
      ],
    );
  });

  it('exportar reparte SIEMPRE en subcarpetas, también con una sola ubicación', () => {
    assert.deepEqual(
      orchestrator.buildRedirects(row(ROOT_HOME), 'export', 'E:/Copia', ['C:/Users/ana/Saves']),
      [restore('C:/Users/ana/Saves', 'E:/Copia/Saves')],
    );
  });

  it('sin destino no hay redirects de ubicación', () => {
    assert.deepEqual(
      orchestrator.buildRedirects(row('C:/Users/bea'), 'custom-path', null, ['C:/x/Saves']),
      [restore('C:/Users/bea', ROOT_HOME)],
    );
  });
});

describe('getGameSavesState: el estado de la ficha sale del índice', () => {
  let saveFile: string;
  const sha1 = (content: string): string => createHash('sha1').update(content).digest('hex');

  /** Una partida real en disco, con su copia ya subida desde este PC. */
  const uploadedFromDisk = async (content = 'partida inicial'): Promise<void> => {
    saveFile = join(root, 'Saves', 'slot1.sav').replace(/\\/g, '/');
    mkdirSync(join(root, 'Saves'), { recursive: true });
    writeFileSync(saveFile, content);
    ludusavi.files = [{ path: saveFile, bytes: content.length }];
    ludusavi.onBackup = () =>
      addLocalBackup(gameDir(), 'Celeste', {
        ...S1,
        files: { [saveFile]: { hash: sha1(content), size: content.length } },
      });
    await backup();
    ludusavi.onBackup = null;
  };
  const state = (): ReturnType<Orchestrator['getGameSavesState']> =>
    orchestrator.getGameSavesState(game, [game]);

  it('sin copias en la nube: none', async () => {
    saveFile = join(root, 'x.sav');
    const result = await state();
    assert.equal(result.sync.status, 'none');
    assert.deepEqual(result.cloud, []);
  });

  it('al día: el disco es exactamente lo último que subió este PC', async () => {
    await uploadedFromDisk();
    const result = await state();
    assert.equal(result.sync.status, 'synced');
    assert.equal(result.sync.localVerified, true);
    assert.equal(result.sync.head?.isOwn, true);
    assert.equal(result.local?.files, 1);
  });

  it('hay cambios sin copiar: el disco cambió desde la última subida', async () => {
    await uploadedFromDisk();
    writeFileSync(saveFile, 'partida cambiada');
    const result = await state();
    assert.equal(result.sync.status, 'local-changes');
    assert.equal(result.sync.localChanges, true);
  });

  it('hay una partida más nueva de otro PC: behind', async () => {
    await uploadedFromDisk();
    const mine = rowOf(V1)?.contentHash as string;
    asOtherDevice(fx.ctx).seedSaveBackup({
      gameId,
      backupName: 'de-b.zip',
      contentHash: 'huella-de-b',
      parentContentHash: mine,
    });
    const result = await state();
    assert.equal(result.sync.status, 'behind');
    assert.equal(result.sync.head?.deviceName, 'PC-B');
  });

  it('disco y nube cambiaron cada uno por su lado: diverged', async () => {
    await uploadedFromDisk();
    const mine = rowOf(V1)?.contentHash as string;
    asOtherDevice(fx.ctx).seedSaveBackup({
      gameId,
      backupName: 'de-b.zip',
      contentHash: 'huella-de-b',
      parentContentHash: mine,
    });
    writeFileSync(saveFile, 'cambios locales');
    assert.equal((await state()).sync.status, 'diverged');
  });

  it('ludusavi no ve nada en el disco: available (la nube se ofrece)', async () => {
    await uploadedFromDisk();
    ludusavi.previewGame = false;
    const result = await state();
    assert.equal(result.sync.status, 'available');
    assert.equal(result.local, null);
  });

  it('una partida que también vive en el registro no se puede comparar: no se verifica', async () => {
    await uploadedFromDisk();
    ludusavi.registry = ['HKEY_CURRENT_USER/Software/Juego'];
    const result = await state();
    assert.equal(result.sync.localVerified, false);
    assert.equal(result.sync.status, 'synced');
  });

  it('un archivo ilegible tampoco se afirma', async () => {
    await uploadedFromDisk();
    ludusavi.files = [{ path: join(root, 'no-existe.sav').replace(/\\/g, '/'), bytes: 1 }];
    assert.equal((await state()).sync.localVerified, false);
  });

  it('si ludusavi falla, la sección sigue: la parte de nube es válida', async () => {
    await uploadedFromDisk();
    ludusavi.failPreview = true;
    const result = await state();
    assert.equal(result.local, null);
    assert.equal(result.cloud.length, 1);
    assert.equal(result.sync.localVerified, false);
  });
});

describe('runRestore: la huella de partida', () => {
  /** Una copia propia ya subida, de la que restaurar. */
  const row = async (): Promise<SaveBackupRow<string>> => {
    ludusavi.onBackup = () => addLocalBackup(gameDir(), 'Celeste', S1);
    await backup();
    ludusavi.onBackup = null;
    return rowOf(V1) as SaveBackupRow<string>;
  };
  const restore = (
    target: SaveBackupRow<string>,
    request: { mode: 'in-place' | 'custom-path' | 'export'; preview: boolean; target?: string },
  ): ReturnType<Orchestrator['runRestore']> =>
    orchestrator.runRestore(target as unknown as SaveBackupRow, {
      gameId: gameId as never,
      backupId: target.id as never,
      ...request,
    });

  it('restaurar de verdad en su sitio fija lastSyncedHash a la huella de la copia', async () => {
    const target = await row();
    setLastSyncedHash(fx.ctx, gameId, 'otra-cosa');
    await restore(target, { mode: 'in-place', preview: false });
    assert.equal(getLastSyncedHash(fx.ctx, gameId), target.contentHash);
  });

  it('restaurar en otra carpeta de este PC también (es donde el juego la lee)', async () => {
    const target = await row();
    setLastSyncedHash(fx.ctx, gameId, 'otra-cosa');
    await restore(target, { mode: 'custom-path', preview: false, target: 'D:/Celeste' });
    assert.equal(getLastSyncedHash(fx.ctx, gameId), target.contentHash);
  });

  it('una previsualización o una exportación no cambian nada', async () => {
    const target = await row();
    setLastSyncedHash(fx.ctx, gameId, 'otra-cosa');
    await restore(target, { mode: 'in-place', preview: true });
    await restore(target, { mode: 'export', preview: false, target: 'E:/Copia' });
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'otra-cosa');
  });

  it('si la descarga falla, lastSyncedHash queda como estaba', async () => {
    const target = await row();
    setLastSyncedHash(fx.ctx, gameId, 'otra-cosa');
    bucket.objects.delete(key(V1)); // sin el zip la descarga falla antes de restaurar
    await assert.rejects(restore(target, { mode: 'in-place', preview: false }));
    assert.equal(getLastSyncedHash(fx.ctx, gameId), 'otra-cosa');
  });

  // materializeBackup crea el workspace antes de bajar nada: si una descarga
  // falla, lo limpia él (runRestore aún no tiene su finally).
  it('si la descarga falla, el workspace temporal se limpia', async () => {
    const target = await row();
    bucket.objects.delete(key(V1));
    await assert.rejects(restore(target, { mode: 'in-place', preview: false }));
    assert.deepEqual(readdirOrEmpty(join(root, 'save-restore-tmp')), []);
  });
});

function readdirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
