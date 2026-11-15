import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';

// Identidad por máquina (machine.ts, §12.6, F-24): escritura atómica, fichero
// dañado, instalación copiada. Todo en carpetas temporales; `electron` se
// sustituye por un userData de mentira. Datos inventados.

let userData = '';

mock.module('electron', {
  namedExports: {
    app: { getPath: () => userData },
    dialog: {
      showMessageBoxSync: () => {
        throw new Error('el diálogo nativo no debería abrirse en los tests');
      },
    },
  },
});

type Machine = typeof import('../machine');
let machine: Machine;

before(async () => {
  machine = await import('../machine');
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORED_ID = '0194c2f0-1111-7000-8000-000000000001';
const BAK_ID = '0194c2f0-2222-7000-8000-000000000002';

const mainPath = (): string => join(userData, 'machine-saves.json');
const bakPath = (): string => `${mainPath()}.bak`;
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;

/** Una Afterplay2.db mínima con el id con el que se abrió por última vez. */
const writeStoredDb = (deviceId: string | null): void => {
  const db = new DatabaseSync(join(userData, 'Afterplay2.db'));
  db.exec('CREATE TABLE local_sync_state (id INTEGER PRIMARY KEY, shortDeviceIdFor TEXT)');
  db.prepare('INSERT INTO local_sync_state (id, shortDeviceIdFor) VALUES (1, ?)').run(deviceId);
  db.close();
};

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'afterplay-saves-machine-'));
  machine.resetMachineCacheForTests();
  machine.setCorruptIdentityPrompt(null);
  machine.setFingerprintReader(() => 'guid:windows-uno');
});
afterEach(() => {
  machine.setCorruptIdentityPrompt(null);
  machine.setFingerprintReader(null);
  rmSync(userData, { recursive: true, force: true });
});
after(() => mock.reset());

const noPrompt = (): never => {
  throw new Error('no se debería preguntar');
};

describe('primer arranque y escritura atómica', () => {
  it('sin nada: se crea una identidad con forma de UUID y se escribe el fichero y su .bak', () => {
    const id = machine.getMachineId();
    assert.match(id, UUID_RE);
    assert.equal(readJson(mainPath()).machineId, id);
    assert.equal(readFileSync(bakPath(), 'utf-8'), readFileSync(mainPath(), 'utf-8'));
  });

  it('no deja ningún .tmp tras escribir (principal ni copia)', () => {
    machine.getMachineId();
    machine.markIdentityReconciled('bucket-uno');
    machine.setPruneFloor(new Date());
    assert.deepEqual(
      readdirSync(userData).filter((name) => name.endsWith('.tmp')),
      [],
    );
  });

  it('la identidad es estable entre lecturas y entre arranques', () => {
    const first = machine.getMachineId();
    machine.resetMachineCacheForTests();
    assert.equal(machine.getMachineId(), first);
  });

  it('cada cambio reescribe también el .bak', () => {
    machine.getMachineId();
    machine.markIdentityReconciled('bucket-uno');
    const main = readJson(mainPath());
    const bak = readJson(bakPath());
    assert.deepEqual(bak, main);
    assert.equal((main.identity as { reconciledBucket: string }).reconciledBucket, 'bucket-uno');
  });
});

describe('fichero dañado', () => {
  it('principal dañado y .bak válido: se recupera en silencio de la copia', () => {
    writeFileSync(mainPath(), '{ esto no es json');
    writeFileSync(
      bakPath(),
      JSON.stringify({ version: 1, machineId: BAK_ID, machineName: 'PC-X' }),
    );
    machine.setCorruptIdentityPrompt(noPrompt);

    assert.equal(machine.getMachineId(), BAK_ID);
    assert.equal(machine.getMachineName(), 'PC-X');
    // El principal queda reparado y el dañado se aparta.
    assert.equal(readJson(mainPath()).machineId, BAK_ID);
    assert.ok(readdirSync(userData).some((name) => name.includes('.corrupt-')));
  });

  it('principal ausente y .bak válido: se recupera de la copia sin apartar nada', () => {
    writeFileSync(bakPath(), JSON.stringify({ version: 1, machineId: BAK_ID }));
    machine.setCorruptIdentityPrompt(noPrompt);
    assert.equal(machine.getMachineId(), BAK_ID);
    assert.equal(readJson(mainPath()).machineId, BAK_ID);
    assert.ok(!readdirSync(userData).some((name) => name.includes('.corrupt-')));
  });

  it('un machineId que no es un UUID cuenta como dañado', () => {
    writeFileSync(mainPath(), JSON.stringify({ version: 1, machineId: 'no-soy-uuid' }));
    writeFileSync(bakPath(), JSON.stringify({ version: 1, machineId: BAK_ID }));
    assert.equal(machine.getMachineId(), BAK_ID);
  });

  it('dañado y sin copia: SIEMPRE se pregunta, nunca se inventa una identidad en silencio', () => {
    writeFileSync(mainPath(), 'basura');
    const calls: { storedDeviceId: string | null; reason: string }[] = [];
    machine.setCorruptIdentityPrompt((options) => {
      calls.push(options);
      return 'create-new';
    });
    machine.getMachineId();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].storedDeviceId, null);
    assert.ok(calls[0].reason.length > 0);
  });

  it('dañado y sin copia: el dañado se aparta antes de preguntar', () => {
    writeFileSync(mainPath(), 'basura');
    machine.setCorruptIdentityPrompt(() => 'create-new');
    machine.getMachineId();
    const aside = readdirSync(userData).filter((name) => name.includes('.corrupt-'));
    assert.equal(aside.length, 1);
    assert.equal(readFileSync(join(userData, aside[0]), 'utf-8'), 'basura');
  });

  it("'use-stored': se usa el id de la base real de esa carpeta y se protege la nube (suelo de poda)", () => {
    writeStoredDb(STORED_ID);
    writeFileSync(mainPath(), 'basura');
    let seen: string | null = null;
    machine.setCorruptIdentityPrompt(({ storedDeviceId }) => {
      seen = storedDeviceId;
      return 'use-stored';
    });

    assert.equal(machine.getMachineId(), STORED_ID);
    assert.equal(seen, STORED_ID);
    assert.ok(machine.getPruneFloor() instanceof Date);
    // La reconciliación con el bucket se vuelve a pedir (marca vacía).
    assert.equal(machine.getMachineIdentity()?.reconciledBucket, '');
    assert.equal(readJson(mainPath()).machineId, STORED_ID);
  });

  it("'create-new': se mina un UUID nuevo distinto del guardado en la base", () => {
    writeStoredDb(STORED_ID);
    writeFileSync(mainPath(), 'basura');
    machine.setCorruptIdentityPrompt(() => 'create-new');
    const id = machine.getMachineId();
    assert.match(id, UUID_RE);
    assert.notEqual(id, STORED_ID);
    assert.equal(machine.getPruneFloor(), null);
  });

  it("'quit': lanza MachineIdentityError y no escribe un fichero nuevo", () => {
    writeStoredDb(STORED_ID);
    writeFileSync(mainPath(), 'basura');
    machine.setCorruptIdentityPrompt(() => 'quit');
    assert.throws(
      () => machine.getMachineId(),
      (error) => error instanceof machine.MachineIdentityError,
    );
    assert.equal(readFileSync(mainPath(), 'utf-8'), 'basura');
    assert.ok(!existsSync(bakPath()));
  });

  it("'use-stored' sin id guardado no inventa nada: se trata como salir", () => {
    writeFileSync(mainPath(), 'basura');
    machine.setCorruptIdentityPrompt(() => 'use-stored');
    assert.throws(
      () => machine.getMachineId(),
      (error) => error instanceof machine.MachineIdentityError,
    );
  });

  it('principal y copia dañados: se pregunta igual', () => {
    writeFileSync(mainPath(), 'basura');
    writeFileSync(bakPath(), JSON.stringify({ machineId: 'tampoco' }));
    let asked = 0;
    machine.setCorruptIdentityPrompt(() => {
      asked++;
      return 'create-new';
    });
    machine.getMachineId();
    assert.equal(asked, 1);
  });
});

describe('fichero ausente', () => {
  it('sin fichero, sin copia y con id en la base: se recupera ese id, con suelo de poda, sin preguntar', () => {
    writeStoredDb(STORED_ID);
    machine.setCorruptIdentityPrompt(noPrompt);
    assert.equal(machine.getMachineId(), STORED_ID);
    const floor = machine.getPruneFloor();
    assert.ok(floor instanceof Date);
    assert.ok(Math.abs(Date.now() - floor.getTime()) < 60_000);
  });

  it('sin fichero ni base: primer arranque de verdad, sin suelo de poda', () => {
    machine.setCorruptIdentityPrompt(noPrompt);
    assert.match(machine.getMachineId(), UUID_RE);
    assert.equal(machine.getPruneFloor(), null);
  });
});

describe('readStoredDeviceId', () => {
  it('lee el id de la base; nada si falta la base, la tabla o el id no es un UUID', () => {
    assert.equal(machine.readStoredDeviceId(userData), null);
    writeStoredDb(STORED_ID);
    assert.equal(machine.readStoredDeviceId(userData), STORED_ID);
  });

  it('un valor que no es UUID o nulo se ignora', () => {
    writeStoredDb('no-es-uuid');
    assert.equal(machine.readStoredDeviceId(userData), null);
  });

  it('una base sin la tabla no lanza', () => {
    new DatabaseSync(join(userData, 'Afterplay2.db')).close();
    assert.equal(machine.readStoredDeviceId(userData), null);
  });

  it('una base que no es SQLite no lanza', () => {
    writeFileSync(join(userData, 'Afterplay2.db'), 'esto no es sqlite, ni de lejos');
    assert.equal(machine.readStoredDeviceId(userData), null);
  });
});

describe('valor propio de la instalación (nonce) y huella de Windows', () => {
  it('se crea una vez y es estable entre lecturas y arranques', () => {
    const nonce = machine.getInstallNonce();
    assert.match(nonce, /^[0-9a-f]{32}$/);
    assert.equal(machine.getInstallNonce(), nonce);
    machine.resetMachineCacheForTests();
    assert.equal(machine.getInstallNonce(), nonce);
  });

  it('guarda de qué Windows es', () => {
    machine.getInstallNonce();
    assert.equal(readJson(mainPath()).installFingerprint, 'guid:windows-uno');
  });

  it('un cambio de huella (carpeta copiada a otro Windows) da un valor nuevo', () => {
    const original = machine.getInstallNonce();
    machine.resetMachineCacheForTests();
    machine.setFingerprintReader(() => 'guid:windows-dos');
    const copied = machine.getInstallNonce();
    assert.notEqual(copied, original);
    assert.equal(readJson(mainPath()).installFingerprint, 'guid:windows-dos');
    // Y el nuevo valor se mantiene después.
    machine.resetMachineCacheForTests();
    assert.equal(machine.getInstallNonce(), copied);
  });

  it('con la misma huella no cambia nada', () => {
    const original = machine.getInstallNonce();
    machine.resetMachineCacheForTests();
    machine.setFingerprintReader(() => 'guid:windows-uno');
    assert.equal(machine.getInstallNonce(), original);
  });

  it('si el Windows no se puede leer, el valor no cambia', () => {
    const original = machine.getInstallNonce();
    machine.resetMachineCacheForTests();
    machine.setFingerprintReader(() => null);
    assert.equal(machine.getInstallNonce(), original);
    assert.equal(readJson(mainPath()).installFingerprint, 'guid:windows-uno');
  });

  it('un fichero de antes de la 2.0 (sin huella guardada) la apunta sin cambiar el valor', () => {
    machine.getInstallNonce();
    const file = readJson(mainPath());
    delete file.installFingerprint;
    writeFileSync(mainPath(), JSON.stringify(file));
    const before = file.installNonce;
    machine.resetMachineCacheForTests();
    machine.setFingerprintReader(() => 'guid:windows-dos');
    assert.equal(machine.getInstallNonce(), before);
    assert.equal(readJson(mainPath()).installFingerprint, 'guid:windows-dos');
  });

  it('un fichero de antes de la 2.0 sin valor recibe uno', () => {
    machine.getMachineId();
    const file = readJson(mainPath());
    delete file.installNonce;
    delete file.installFingerprint;
    writeFileSync(mainPath(), JSON.stringify(file));
    machine.resetMachineCacheForTests();
    assert.match(machine.getInstallNonce(), /^[0-9a-f]{32}$/);
  });
});

describe('id duplicado', () => {
  it('se marca, se persiste y no se pisa la primera detección', () => {
    assert.equal(machine.getDuplicateIdentity(), null);
    machine.markDuplicateIdentity('devices');
    const first = machine.getDuplicateIdentity();
    assert.equal(first?.where, 'devices');
    machine.markDuplicateIdentity('bucket');
    assert.equal(machine.getDuplicateIdentity()?.where, 'devices');
    assert.equal(machine.getDuplicateIdentity()?.detectedAt, first?.detectedAt);

    machine.resetMachineCacheForTests();
    assert.equal(machine.getDuplicateIdentity()?.where, 'devices');
  });

  it('se limpia y la limpieza se persiste', () => {
    machine.markDuplicateIdentity('bucket');
    machine.clearDuplicateIdentity();
    assert.equal(machine.getDuplicateIdentity(), null);
    machine.resetMachineCacheForTests();
    assert.equal(machine.getDuplicateIdentity(), null);
    machine.clearDuplicateIdentity(); // sin marca: no hace nada
  });
});

describe('startNewIdentity', () => {
  it('identidad nueva: otro id, otro valor propio, sin marca de duplicado ni reconciliación', () => {
    const oldId = machine.getMachineId();
    const oldNonce = machine.getInstallNonce();
    machine.markIdentityReconciled('bucket-uno');
    machine.setPruneFloor(new Date());
    machine.markDuplicateIdentity('devices');
    machine.setFingerprintReader(() => 'guid:windows-tres');

    const newId = machine.startNewIdentity();

    assert.match(newId, UUID_RE);
    assert.notEqual(newId, oldId);
    assert.equal(machine.getMachineId(), newId);
    assert.notEqual(machine.getInstallNonce(), oldNonce);
    assert.equal(machine.getDuplicateIdentity(), null);
    assert.equal(machine.getMachineIdentity(), null);
    assert.equal(machine.getPruneFloor(), null);
    // Persistido, con la huella de este Windows.
    const file = readJson(mainPath());
    assert.equal(file.machineId, newId);
    assert.equal(file.installFingerprint, 'guid:windows-tres');
    assert.deepEqual(readJson(bakPath()), file);
  });
});

describe('suelo de poda y reconciliación', () => {
  it('markIdentityReconciled conserva el suelo de poda', () => {
    const when = new Date('2026-03-01T00:00:00Z');
    machine.setPruneFloor(when);
    machine.markIdentityReconciled('bucket-uno');
    assert.equal(machine.getPruneFloor()?.toISOString(), when.toISOString());
    assert.equal(machine.getMachineIdentity()?.reconciledBucket, 'bucket-uno');
  });

  it('setPruneFloor sin identidad crea una mínima que nunca casa con un bucket real', () => {
    machine.getMachineId();
    assert.equal(machine.getMachineIdentity(), null);
    machine.setPruneFloor(new Date('2026-03-01T00:00:00Z'));
    assert.equal(machine.getMachineIdentity()?.reconciledBucket, '');
  });

  it('setMachineId adopta el id y protege lo anterior', () => {
    machine.getMachineId();
    machine.setMachineId(BAK_ID, 'bucket-uno');
    assert.equal(machine.getMachineId(), BAK_ID);
    assert.ok(machine.getPruneFloor() instanceof Date);
  });
});
