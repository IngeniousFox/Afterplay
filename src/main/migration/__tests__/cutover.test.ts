import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CutoverAction, CutoverState } from '../../../shared/cutover';
import { ImportBlockedError } from '../../db/v2/importer';
import {
  CutoverController,
  type CutoverDeps,
  type CutoverProgress,
  type CutoverSync,
  type CutoverSyncProgress,
  type EnrollOutcome,
  type PairOutcome,
  type ProgressStore,
} from '../cutover';
import {
  LegacyCutoverError,
  type ClaimResult,
  type CutoverSelf,
  type CutoverValue,
  type DeviceStatus,
  type HubEnrollment,
  type LegacyCutover,
  type LegacyMachine,
  type RemoteSnapshotReport,
} from '../legacyCutover';

// El orquestador del corte con dobles: un puente de Turso falso, un sync falso,
// un importador falso y una marca de progreso en memoria. Sin disco, sin red,
// sin esperas. Todo con datos inventados.

const T0 = 1_763_380_800_000;
const HOUR = 3_600_000;
const SELF: CutoverSelf = { deviceId: 'machine-a', deviceName: 'PC-A', appVersion: '2.0.0' };
const SECRET = 'secreto-de-alta-que-no-debe-salir-en-el-log';
const CODE = 'codigo-de-un-solo-uso-12345';

// ── Dobles ──────────────────────────────────────────────────────────────────

class FakeBridge implements LegacyCutover {
  row: CutoverValue | null = null;
  hub: HubEnrollment | null = null;
  statuses: DeviceStatus[] = [];
  calls: string[] = [];
  closed = 0;
  /** Una lectura de estados puede cambiar lo que devuelve la siguiente. */
  onReadStatuses: (() => void) | null = null;
  failWith: Error | null = null;
  completedWith: { deviceId: string; hub: HubEnrollment } | null = null;

  private check(): void {
    if (this.failWith) throw this.failWith;
  }

  readCutover(): Promise<CutoverValue | null> {
    this.calls.push('read');
    this.check();
    return Promise.resolve(this.row);
  }
  claimCutover(self: CutoverSelf): Promise<ClaimResult> {
    this.calls.push('claim');
    this.check();
    if (!this.row) {
      this.row = { state: 'migrating', ...self, at: T0 };
      return Promise.resolve({ outcome: 'won' });
    }
    if (this.row.state === 'migrating' && this.row.deviceId === self.deviceId) {
      return Promise.resolve({ outcome: 'already-mine' });
    }
    return Promise.resolve({ outcome: 'lost', holder: this.row });
  }
  releaseCutover(deviceId: string): Promise<boolean> {
    this.calls.push('release');
    this.check();
    if (this.row?.state === 'migrating' && this.row.deviceId === deviceId) {
      this.row = null;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }
  completeCutover(deviceId: string, hub: HubEnrollment): Promise<void> {
    this.calls.push('complete');
    this.check();
    if (this.row?.state !== 'migrating' || this.row.deviceId !== deviceId) {
      return Promise.reject(new LegacyCutoverError('not-owner', 'no es suyo'));
    }
    this.row = { ...this.row, state: 'done' };
    this.hub = hub;
    this.completedWith = { deviceId, hub };
    return Promise.resolve();
  }
  machines: LegacyMachine[] = [];
  machinesError: Error | null = null;
  readLegacyMachines(): Promise<LegacyMachine[]> {
    this.calls.push('machines');
    if (this.machinesError) return Promise.reject(this.machinesError);
    return Promise.resolve([...this.machines]);
  }
  readDeviceStatuses(): Promise<DeviceStatus[]> {
    this.calls.push('statuses');
    this.check();
    const result = [...this.statuses];
    this.onReadStatuses?.();
    return Promise.resolve(result);
  }
  snapshots: string[] = [];
  /** Lo que "hay" en el remoto: el importador falso lo recibe a través de la foto. */
  pendingMailbox = 0;
  snapshotRemote(destPath: string): Promise<RemoteSnapshotReport> {
    this.calls.push('snapshot');
    this.check();
    this.snapshots.push(destPath);
    return Promise.resolve({ tables: { games: 1 }, rows: 1, pendingMailbox: this.pendingMailbox });
  }
  readHubEnrollment(): Promise<HubEnrollment | null> {
    this.calls.push('hub');
    this.check();
    return Promise.resolve(this.row?.state === 'done' ? this.hub : null);
  }
  close(): void {
    this.closed++;
  }
}

class FakeSync implements CutoverSync {
  paired = false;
  started = 0;
  nudges = 0;
  pairs: { hubUrl: string; code: string }[] = [];
  secretPairs: { hubUrl: string; enrollSecret: string }[] = [];
  pairResults: PairOutcome[] = [];
  secretResults: PairOutcome[] = [];
  enroll: EnrollOutcome = {
    ok: true,
    grant: { url: 'https://hub.example.test', enrollSecret: SECRET, expiresAt: T0 + 7 * 24 * HOUR },
  };
  /** Lo que ve el orquestador en cada consulta; el último valor se repite. */
  script: CutoverSyncProgress[] = [];
  private polls = 0;

  isPaired(): boolean {
    return this.paired;
  }
  start(): Promise<void> {
    this.started++;
    return Promise.resolve();
  }
  pair(request: { hubUrl: string; code: string }): Promise<PairOutcome> {
    this.pairs.push(request);
    const result = this.pairResults.shift() ?? { ok: true };
    if (result.ok) this.paired = true;
    return Promise.resolve(result);
  }
  pairWithSecret(request: { hubUrl: string; enrollSecret: string }): Promise<PairOutcome> {
    this.secretPairs.push(request);
    const result = this.secretResults.shift() ?? { ok: true };
    if (result.ok) this.paired = true;
    return Promise.resolve(result);
  }
  requestEnrollSecret(): Promise<EnrollOutcome> {
    return Promise.resolve(this.enroll);
  }
  syncNow(): void {
    this.nudges++;
  }
  progress(): CutoverSyncProgress {
    const at = Math.min(this.polls++, this.script.length - 1);
    return this.script[at] ?? DONE_PROGRESS;
  }
}

const DONE_PROGRESS: CutoverSyncProgress = {
  hubKnown: true,
  rowsPending: 0,
  rowsLocal: 50,
  pulled: true,
  problem: null,
};

class MemoryProgress implements ProgressStore {
  value: CutoverProgress | null = null;
  writes: CutoverProgress[] = [];
  read(): CutoverProgress | null {
    return this.value;
  }
  write(progress: CutoverProgress): void {
    this.value = progress;
    this.writes.push(progress);
  }
  clear(): void {
    this.value = null;
  }
}

interface World {
  bridge: FakeBridge;
  sync: FakeSync;
  progress: MemoryProgress;
  log: string[];
  /** Qué ha pasado en la base y en el importador, en orden. */
  events: string[];
  dbFile: boolean;
  /** El importador falso: lanza lo que haya aquí (una vez por intento). */
  importErrors: Error[];
  bridgeConfigured: boolean;
  /** Rutas con las que se llamó al importador (null = la copia local). */
  importSources: (string | null)[];
  removedSnapshots: string[];
  localPending: number | null;
  secondaryLocalError: Error | null;
  now: number;
  sleeps: number;
  /** Se llama en cada espera (un tic de tiempo): los tests cambian el mundo aquí. */
  tick: ((n: number) => void) | null;
  timing: CutoverDeps['timing'];
}

const world = (): World => ({
  bridge: new FakeBridge(),
  sync: new FakeSync(),
  progress: new MemoryProgress(),
  log: [],
  events: [],
  dbFile: false,
  importErrors: [],
  bridgeConfigured: true,
  importSources: [],
  removedSnapshots: [],
  localPending: 0,
  secondaryLocalError: null,
  now: T0,
  sleeps: 0,
  tick: null,
  timing: undefined,
});

const deps = (w: World): CutoverDeps => ({
  self: SELF,
  now: () => w.now,
  sleep: () => {
    w.sleeps++;
    w.now += 1_000;
    w.tick?.(w.sleeps);
    return Promise.resolve();
  },
  log: (message) => w.log.push(message),
  progress: w.progress,
  openBridge: () =>
    w.bridgeConfigured
      ? Promise.resolve(w.bridge)
      : Promise.reject(new LegacyCutoverError('not-configured', 'sin credenciales')),
  removeLocalDatabase: () => {
    w.events.push('remove-db');
    w.dbFile = false;
  },
  snapshotPath: () => 'backups/Afterplay-remote-test.db',
  removeSnapshot: (path) => w.removedSnapshots.push(path),
  localPendingChanges: () => Promise.resolve(w.localPending),
  importLegacy: (sourcePath) => {
    w.events.push('import');
    w.importSources.push(sourcePath);
    const error = w.importErrors.shift();
    if (error) {
      w.dbFile = true; // una importación a medias deja ficheros que hay que borrar
      return Promise.reject(error);
    }
    w.dbFile = true;
    return Promise.resolve();
  },
  openDatabase: (mode) => {
    w.events.push(`open-db:${mode}`);
    w.dbFile = true;
  },
  afterImport: () => w.events.push('after-import'),
  migrateSecondaryLocal: () => {
    w.events.push('secondary-local');
    if (w.secondaryLocalError) throw w.secondaryLocalError;
  },
  sync: w.sync,
  timing: w.timing,
});

/**
 * Arranca el orquestador y contesta a cada estado con `answers`. Devuelve los
 * estados vistos y la promesa de `run()`.
 */
const start = (
  w: World,
  answers: Partial<
    Record<CutoverState['kind'], (state: CutoverState) => CutoverAction | null>
  > = {},
): { controller: CutoverController; states: CutoverState[]; done: Promise<void> } => {
  const controller = new CutoverController(deps(w));
  const states: CutoverState[] = [];
  controller.onState((state) => {
    states.push(state);
    const answer = answers[state.kind]?.(state);
    if (answer) controller.dispatch(answer);
  });
  return { controller, states, done: controller.run() };
};

const kinds = (states: readonly CutoverState[]): string[] => states.map((s) => s.kind);

const status = (over: Partial<DeviceStatus> = {}): DeviceStatus => ({
  deviceId: 'machine-b',
  deviceName: 'PC-B',
  appVersion: '1.8.0',
  lastPushOkAt: T0,
  pendingChanges: 0,
  at: T0,
  seenCutoverAt: T0,
  ...over,
});

const rowOf = (w: World): CutoverValue | null => w.bridge.row;

const seedingScript = (...pending: number[]): CutoverSyncProgress[] =>
  pending.map((rowsPending, index) => ({
    hubKnown: index > 0 || rowsPending === 0,
    rowsPending,
    rowsLocal: 100,
    pulled: false,
    problem: null,
  }));

const pairWithCode = (): ((state: CutoverState) => CutoverAction) => () => ({
  type: 'submit-pairing',
  hubUrl: 'https://hub.example.test',
  code: CODE,
});

// ── Migrador ────────────────────────────────────────────────────────────────

describe('cutover: camino del migrador', () => {
  it('gana el reclamo, importa, siembra y termina escribiendo cutover = done con el hub', async () => {
    const w = world();
    w.sync.paired = true;
    w.sync.script = seedingScript(100, 100, 40, 0);
    const { states, done } = start(w);
    await done;

    assert.deepEqual(
      [...new Set(kinds(states))],
      ['checking', 'importing', 'local-migration', 'seeding', 'finishing', 'done'],
    );
    assert.deepEqual(w.events, ['remove-db', 'import', 'open-db:existing', 'after-import']);
    assert.equal(w.bridge.row?.state, 'done');
    assert.equal(w.bridge.row?.deviceId, SELF.deviceId);
    assert.equal(w.bridge.completedWith?.hub.url, 'https://hub.example.test');
    assert.equal(w.bridge.completedWith?.hub.enrollSecret, SECRET);
    assert.equal(w.progress.value?.completed, true);
    assert.equal(w.bridge.closed, 1);
    assert.equal(w.sync.started, 1, 'ya emparejado: arranca el motor con lo que hay');
  });

  it('la siembra enseña lo que falta y no termina hasta que el motor habló con el hub', async () => {
    const w = world();
    w.sync.paired = true;
    // Antes de hablar con el hub no hay filas marcadas: aun así NO está sembrado.
    w.sync.script = [
      { hubKnown: false, rowsPending: 100, rowsLocal: 100, pulled: false, problem: null },
      { hubKnown: false, rowsPending: 100, rowsLocal: 100, pulled: false, problem: null },
      { hubKnown: true, rowsPending: 60, rowsLocal: 100, pulled: false, problem: null },
      {
        hubKnown: true,
        rowsPending: 60,
        rowsLocal: 100,
        pulled: false,
        problem: 'The hub is over its storage or request quota. Afterplay will keep trying.',
      },
      { hubKnown: true, rowsPending: 0, rowsLocal: 100, pulled: true, problem: null },
    ];
    const { states, done } = start(w);
    await done;

    const seeding = states.filter((s) => s.kind === 'seeding');
    assert.deepEqual(
      seeding.map((s) => [s.rowsLeft, s.rowsTotal, s.problem === null]),
      [
        [100, 100, true],
        [60, 100, true],
        [60, 100, false],
      ],
    );
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('da un toque al sync de vez en cuando mientras siembra (levanta una pausa por cuota)', async () => {
    const w = world();
    w.sync.paired = true;
    w.sync.script = [
      ...seedingScript(100),
      ...Array.from({ length: 200 }, () => ({
        hubKnown: true,
        rowsPending: 10,
        rowsLocal: 100,
        pulled: false,
        problem: 'quota',
      })),
      DONE_PROGRESS,
    ];
    const { done } = start(w);
    await done;
    assert.ok(w.sync.nudges >= 2, `toques: ${w.sync.nudges}`);
  });

  it('sin emparejar pide la dirección y el código; un fallo se enseña y se vuelve a pedir', async () => {
    const w = world();
    w.sync.pairResults = [
      { ok: false, message: 'That code is not valid or has expired.' },
      { ok: true },
    ];
    w.sync.script = seedingScript(100, 0);
    const { states, done } = start(w, { 'needs-pairing': pairWithCode() });
    await done;

    const asks = states.filter((s) => s.kind === 'needs-pairing');
    assert.equal(asks.length, 2);
    assert.equal(asks[0].reason, 'first-pc');
    assert.equal(asks[0].error, null);
    assert.equal(asks[1].error, 'That code is not valid or has expired.');
    assert.equal(w.sync.pairs.length, 2);
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('un fallo al pedir el secreto de alta deja el corte en migrating y se reanuda sin reimportar', async () => {
    const w = world();
    w.sync.paired = true;
    w.sync.enroll = { ok: false, message: "Couldn't ask the hub for an enrollment secret." };
    const { states, done, controller } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.equal(last?.kind, 'error');
    assert.equal(last?.kind === 'error' && last.code, 'finish-failed');
    assert.equal(w.bridge.row?.state, 'migrating');
    assert.equal(w.events.filter((e) => e === 'import').length, 1);

    w.sync.enroll = {
      ok: true,
      grant: { url: 'https://hub.example.test', enrollSecret: SECRET, expiresAt: T0 + HOUR },
    };
    controller.dispatch({ type: 'retry' });
    await done;
    assert.equal(w.events.filter((e) => e === 'import').length, 1, 'no se vuelve a importar');
    assert.equal(w.bridge.row?.state, 'done');
  });
});

describe('cutover: la pregunta de los rezagados', () => {
  it('con un PC sin informar: pregunta; continuar sigue con la importación y no se repite', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.statuses = [status({ at: T0 - 30 * HOUR })];
    const { states, done } = start(w, { 'question-lagging': () => ({ type: 'continue' }) });
    await done;

    const question = states.find((s) => s.kind === 'question-lagging');
    assert.ok(question && question.kind === 'question-lagging');
    assert.equal(question.devices.length, 1);
    assert.equal(question.devices[0].deviceName, 'PC-B');
    assert.equal(question.devices[0].reason, 'stale');
    assert.equal(question.devices[0].lastReportAt, T0 - 30 * HOUR);
    assert.equal(
      w.progress.writes.some((p) => p.laggingAck),
      true,
    );
    assert.equal(w.events.filter((e) => e === 'import').length, 1);
  });

  it('con cambios sin subir también pregunta; esperar vuelve a comprobar y sigue solo cuando informa', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.statuses = [status({ pendingChanges: 4 })];
    let waits = 0;
    const { states, done } = start(w, {
      'question-lagging': () => {
        waits++;
        if (waits === 2) w.bridge.statuses = [status({ pendingChanges: 0, at: w.now })];
        return { type: 'wait' };
      },
    });
    await done;

    assert.equal(waits >= 2, true);
    assert.equal(
      states.some((s) => s.kind === 'question-lagging' && s.rechecking),
      true,
    );
    // No hizo falta `continue`: el PC informó y la pregunta desapareció.
    assert.equal(
      w.progress.writes.some((p) => p.laggingAck),
      false,
    );
    assert.equal(w.events.includes('import'), true);
  });

  it('la pregunta se vuelve a comprobar sola con el tiempo, sin pulsar nada', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.statuses = [status({ pendingChanges: 2 })];
    w.tick = (n) => {
      if (n === 3) w.bridge.statuses = [];
    };
    const { done } = start(w);
    await done;
    assert.equal(w.events.includes('import'), true);
  });

  it('un PC que aún no ha leído el reclamo: espera en silencio y sigue cuando lo confirma', async () => {
    const w = world();
    w.sync.paired = true;
    w.timing = { confirmGraceMs: 60_000 };
    w.bridge.statuses = [status({ seenCutoverAt: null })];
    w.tick = (n) => {
      if (n === 3) w.bridge.statuses = [status({ seenCutoverAt: T0, at: w.now })];
    };
    const { states, done } = start(w);
    await done;
    const waiting = states.find((s) => s.kind === 'waiting-devices');
    assert.ok(waiting?.kind === 'waiting-devices');
    assert.deepEqual(waiting.devices, ['PC-B']);
    assert.equal(kinds(states).includes('question-lagging'), false);
    // La instantánea se saca DESPUÉS de que pase la comprobación.
    const calls = w.bridge.calls;
    assert.ok(calls.lastIndexOf('statuses') < calls.indexOf('snapshot'));
  });

  it('un «0 pendientes» anterior al reclamo no basta: tras el margen se pregunta', async () => {
    const w = world();
    w.sync.paired = true;
    w.timing = { confirmGraceMs: 5_000 };
    w.bridge.statuses = [status({ seenCutoverAt: T0 - 10_000 })];
    const { states, done } = start(w, { 'question-lagging': () => ({ type: 'continue' }) });
    await done;
    assert.equal(kinds(states).includes('waiting-devices'), true);
    const question = states.find((s) => s.kind === 'question-lagging');
    assert.ok(question?.kind === 'question-lagging');
    assert.equal(question.devices[0].reason, 'not-confirmed');
    assert.ok(kinds(states).indexOf('waiting-devices') < kinds(states).indexOf('question-lagging'));
  });

  it('un PC de save_backups sin device_status se pregunta enseguida (never-reported)', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.machines = [
      { machineId: SELF.deviceId, machineName: 'PC-A' },
      { machineId: 'machine-old', machineName: 'PC-Viejo' },
    ];
    const { states, done } = start(w, { 'question-lagging': () => ({ type: 'continue' }) });
    await done;
    assert.equal(kinds(states).includes('waiting-devices'), false);
    const question = states.find((s) => s.kind === 'question-lagging');
    assert.ok(question?.kind === 'question-lagging');
    assert.deepEqual(
      question.devices.map((d) => [d.deviceName, d.reason]),
      [['PC-Viejo', 'never-reported']],
    );
  });

  it('si no se puede leer save_backups, se registra y se sigue sin esa lista', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.machinesError = new LegacyCutoverError('malformed', 'no');
    const { states, done } = start(w);
    await done;
    assert.equal(kinds(states).includes('question-lagging'), false);
    assert.equal(
      w.log.some((l) => l.includes('save_backups')),
      true,
    );
    assert.equal(w.events.includes('import'), true);
  });

  it('un PC al día no provoca ninguna pregunta', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.statuses = [status({ at: T0 - HOUR }), { ...status({ deviceId: 'machine-a' }) }];
    const { states, done } = start(w);
    await done;
    assert.equal(
      states.some((s) => s.kind === 'question-lagging'),
      false,
    );
  });
});

describe('cutover: fallos y garantía de no dejar nada a medias', () => {
  it('si la importación falla: borra Afterplay2.db, suelta el reclamo y enseña el error', async () => {
    const w = world();
    w.sync.paired = true;
    w.importErrors = [new Error('La validación de la importación ha fallado')];
    const { states, controller, done } = start(w);
    await new Promise((resolve) => setImmediate(resolve));

    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(last.code, 'import-failed');
    assert.equal(w.dbFile, false, 'Afterplay2.db borrada');
    assert.equal(w.bridge.row, null, 'reclamo soltado');
    assert.equal(w.progress.value, null, 'sin marca: la 1.x queda como estaba');
    assert.equal(w.events.includes('open-db:existing'), false);

    // Reintentar vuelve a empezar de cero y esta vez pasa.
    controller.dispatch({ type: 'retry' });
    await done;
    assert.equal(rowOf(w)?.state, 'done');
  });

  it('con puente importa la FOTO del remoto, no la réplica local', async () => {
    const w = world();
    w.sync.paired = true;
    const { done } = start(w);
    await done;
    assert.deepEqual(w.bridge.snapshots, ['backups/Afterplay-remote-test.db']);
    assert.deepEqual(w.importSources, ['backups/Afterplay-remote-test.db']);
    assert.ok(
      w.bridge.calls.indexOf('snapshot') > w.bridge.calls.indexOf('claim'),
      'tras el reclamo',
    );
  });

  it('sin puente (sin credenciales) importa la copia local y no hay foto', async () => {
    const w = world();
    w.bridgeConfigured = false;
    w.sync.paired = true;
    const { done } = start(w);
    await done;
    assert.deepEqual(w.importSources, [null]);
    assert.equal(w.bridge.snapshots.length, 0);
  });

  it('si la foto del remoto falla, no se importa nada y el reclamo se suelta', async () => {
    const w = world();
    w.bridge.snapshotRemote = () => Promise.reject(new Error('sin red'));
    const { states } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(w.importSources.length, 0);
    assert.equal(w.bridge.row, null);
    assert.ok(w.removedSnapshots.length > 0, 'la foto a medias se borra');
  });

  it('un buzón pendiente en el REMOTO bloquea antes de importar y suelta el reclamo', async () => {
    const w = world();
    w.bridge.pendingMailbox = 3;
    const { states } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(last.code, 'import-blocked');
    assert.match(last.message, /3 pending/);
    assert.equal(w.importSources.length, 0, 'no llegó a importar');
    assert.equal(w.bridge.row, null, 'reclamo soltado');
    assert.deepEqual(w.removedSnapshots, ['backups/Afterplay-remote-test.db']);
  });

  it('cambios sin subir de ESTE PC (cola local) se preguntan como "este PC"; continuar los descarta', async () => {
    const w = world();
    w.sync.paired = true;
    w.localPending = 12;
    const { states, done } = start(w, {
      'question-lagging': () => ({ type: 'continue' }),
    });
    await done;
    const question = states.find((s) => s.kind === 'question-lagging');
    assert.ok(question?.kind === 'question-lagging');
    assert.deepEqual(
      question.devices.map((d) => [d.deviceId, d.self, d.pendingChanges, d.reason]),
      [[SELF.deviceId, true, 12, 'pending-changes']],
    );
    assert.equal(rowOf(w)?.state, 'done');
  });

  it('el device_status propio del remoto también cuenta como cambios sin subir de este PC', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.statuses = [
      status({ deviceId: SELF.deviceId, deviceName: 'PC-A', pendingChanges: 4 }),
    ];
    const { states, controller, done } = start(w, {
      'question-lagging': () => ({ type: 'continue' }),
    });
    await done;
    const question = states.find((s) => s.kind === 'question-lagging');
    assert.ok(question?.kind === 'question-lagging');
    assert.equal(question.devices[0]?.self, true);
    assert.equal(question.devices[0]?.pendingChanges, 4);
    assert.equal(controller.state.kind, 'done');
  });

  it('si la cola local no se puede mirar (null) y no hay otro aviso, no se pregunta', async () => {
    const w = world();
    w.sync.paired = true;
    w.localPending = null;
    const { states, done } = start(w);
    await done;
    assert.equal(kinds(states).includes('question-lagging'), false);
  });

  it('un bloqueo del importador (buzón pendiente) se distingue de un fallo de validación', async () => {
    const w = world();
    w.importErrors = [new ImportBlockedError('El buzón del móvil tiene 2 orden(es) pendiente(s).')];
    const { states } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(last.code, 'import-blocked');
    assert.match(last.message, /2 orden/);
    assert.equal(w.bridge.row, null);
  });

  it('sin red al soltar el reclamo: la marca queda y el siguiente intento lo reanuda (already-mine)', async () => {
    const w = world();
    w.sync.paired = true;
    w.importErrors = [new Error('boom')];
    const release = w.bridge.releaseCutover.bind(w.bridge);
    w.bridge.releaseCutover = () => Promise.reject(new Error('sin red'));
    const { states, controller, done } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(states.at(-1)?.kind, 'error');
    assert.equal(w.bridge.row?.state, 'migrating');
    assert.ok(w.progress.value);

    w.bridge.releaseCutover = release;
    controller.dispatch({ type: 'retry' });
    await done;
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('la 1.8 no instalada (sin app_meta) enseña bridge-missing y se puede reintentar', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.failWith = new LegacyCutoverError('missing-table', 'app_meta no existe');
    const { states, controller, done } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(last.code, 'bridge-missing');

    w.bridge.failWith = null;
    controller.dispatch({ type: 'retry' });
    await done;
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('un error de red de Turso no filtra su texto (puede llevar la dirección)', async () => {
    const w = world();
    w.bridge.failWith = new Error('fetch failed https://mi-base-secreta.turso.io');
    const { states } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(last.code, 'bridge-failed');
    assert.equal(last.message.includes('turso'), false);
    assert.equal(w.log.join('\n').includes('turso'), false);
  });

  it('nunca escribe secretos ni códigos en el log', async () => {
    const w = world();
    w.sync.pairResults = [{ ok: false, message: 'That code is not valid.' }, { ok: true }];
    w.sync.script = seedingScript(10, 0);
    const { done } = start(w, { 'needs-pairing': pairWithCode() });
    await done;
    const log = w.log.join('\n');
    assert.equal(log.includes(SECRET), false);
    assert.equal(log.includes(CODE), false);
  });
});

// ── Secundario ──────────────────────────────────────────────────────────────

const doneByOther = (w: World, expiresAt = T0 + 7 * 24 * HOUR): void => {
  w.bridge.row = {
    state: 'done',
    deviceId: 'machine-b',
    deviceName: 'PC-B',
    appVersion: '2.0.0',
    at: T0 - HOUR,
  };
  w.bridge.hub = { url: 'https://hub.example.test', enrollSecret: SECRET, expiresAt };
};

describe('cutover: camino del secundario', () => {
  it('con el secreto vigente: empareja solo, baja todo y hace la migración local', async () => {
    const w = world();
    doneByOther(w);
    w.sync.script = [
      { hubKnown: false, rowsPending: 0, rowsLocal: 3, pulled: false, problem: null },
      { hubKnown: true, rowsPending: 0, rowsLocal: 40, pulled: false, problem: null },
      DONE_PROGRESS,
    ];
    const { states, done } = start(w);
    await done;

    assert.deepEqual(w.sync.secretPairs, [
      { hubUrl: 'https://hub.example.test', enrollSecret: SECRET },
    ]);
    assert.equal(w.sync.pairs.length, 0);
    assert.deepEqual(
      [...new Set(kinds(states))],
      ['checking', 'pairing', 'pulling', 'local-migration', 'done'],
    );
    assert.deepEqual(
      states.filter((s) => s.kind === 'pulling').map((s) => s.rowsLocal),
      [3, 40],
    );
    assert.deepEqual(w.events, ['open-db:fresh', 'secondary-local']);
    assert.equal(w.events.includes('import'), false, 'no importa');
    assert.equal(w.bridge.calls.includes('release'), false);
    assert.equal(w.progress.value?.role, 'secondary');
    assert.equal(w.progress.value?.completed, true);
    // El secundario no escribe nada en el puente.
    assert.equal(
      w.bridge.calls.some((c) => c === 'complete' || c === 'release'),
      false,
    );
  });

  it('con el secreto caducado pide un código y empareja con él', async () => {
    const w = world();
    doneByOther(w, T0 - 1);
    const { states, done } = start(w, { 'needs-pairing': pairWithCode() });
    await done;

    const ask = states.find((s) => s.kind === 'needs-pairing');
    assert.ok(ask && ask.kind === 'needs-pairing');
    assert.equal(ask.reason, 'secret-expired');
    assert.equal(ask.hubUrl, 'https://hub.example.test');
    assert.equal(ask.canRetrySecret, false);
    assert.equal(w.sync.secretPairs.length, 0, 'no se gasta un intento con un secreto caducado');
    assert.equal(w.sync.pairs.length, 1);
  });

  it('con el secreto rechazado enseña el motivo y deja reintentarlo o dar un código', async () => {
    const w = world();
    doneByOther(w);
    w.sync.secretResults = [{ ok: false, message: "Couldn't reach the hub." }, { ok: true }];
    const { states, done } = start(w, {
      'needs-pairing': () => ({ type: 'retry' }),
    });
    await done;
    const ask = states.find((s) => s.kind === 'needs-pairing');
    assert.ok(ask && ask.kind === 'needs-pairing');
    assert.equal(ask.reason, 'secret-failed');
    assert.equal(ask.error, "Couldn't reach the hub.");
    assert.equal(ask.canRetrySecret, true);
    assert.equal(w.sync.secretPairs.length, 2);
  });

  it('si otro PC está migrando espera y, cuando termina, sigue como secundario', async () => {
    const w = world();
    w.bridge.row = {
      state: 'migrating',
      deviceId: 'machine-b',
      deviceName: 'PC-B',
      appVersion: '2.0.0',
      at: T0 - HOUR,
    };
    w.tick = (n) => {
      if (n === 3) doneByOther(w);
    };
    const { states, done } = start(w);
    await done;

    const waiting = states.find((s) => s.kind === 'waiting-other');
    assert.ok(waiting && waiting.kind === 'waiting-other');
    assert.equal(waiting.deviceName, 'PC-B');
    assert.equal(waiting.since, T0 - HOUR);
    assert.equal(w.sleeps >= 3, true);
    assert.equal(w.sync.secretPairs.length, 1);
    assert.equal(w.progress.value?.completed, true);
  });

  it('si el otro PC falla y suelta el reclamo, este lo reclama y migra él', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.row = {
      state: 'migrating',
      deviceId: 'machine-b',
      deviceName: 'PC-B',
      appVersion: '2.0.0',
      at: T0 - HOUR,
    };
    w.tick = (n) => {
      if (n === 2) w.bridge.row = null;
    };
    const { states, done } = start(w);
    await done;
    assert.equal(
      states.some((s) => s.kind === 'waiting-other'),
      true,
    );
    assert.equal(w.events.includes('import'), true);
    assert.equal(w.bridge.row?.deviceId, SELF.deviceId);
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('un fallo de la migración local se enseña y se reintenta sin repetir la bajada', async () => {
    const w = world();
    doneByOther(w);
    w.secondaryLocalError = new Error('disco lleno');
    const { states, controller, done } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(last.code, 'local-migration-failed');

    w.secondaryLocalError = null;
    controller.dispatch({ type: 'retry' });
    await done;
    assert.equal(w.progress.value?.completed, true);
  });
});

// ── Reanudación ─────────────────────────────────────────────────────────────

describe('cutover: reanudar tras cerrar la app', () => {
  const claimedByMe = (w: World): void => {
    w.bridge.row = { state: 'migrating', ...SELF, at: T0 - HOUR };
  };

  it('reclamado pero sin importar: vuelve a la pregunta y a importar', async () => {
    const w = world();
    w.sync.paired = true;
    claimedByMe(w);
    w.progress.value = { version: 1, role: 'migrator', startedAt: T0 - HOUR };
    w.bridge.statuses = [status({ pendingChanges: 1 })];
    const { states, done } = start(w, { 'question-lagging': () => ({ type: 'continue' }) });
    await done;
    assert.equal(
      states.some((s) => s.kind === 'question-lagging'),
      true,
    );
    assert.equal(w.events.includes('import'), true);
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('ya había elegido continuar: no se vuelve a preguntar', async () => {
    const w = world();
    w.sync.paired = true;
    claimedByMe(w);
    w.progress.value = { version: 1, role: 'migrator', startedAt: T0 - HOUR, laggingAck: true };
    w.bridge.statuses = [status({ pendingChanges: 1 })];
    const { states, done } = start(w);
    await done;
    assert.equal(
      states.some((s) => s.kind === 'question-lagging'),
      false,
    );
  });

  it('importado: no repite la importación ni los pasos locales hechos y sigue emparejando', async () => {
    const w = world();
    claimedByMe(w);
    w.progress.value = {
      version: 1,
      role: 'migrator',
      startedAt: T0 - HOUR,
      imported: true,
      localDone: true,
    };
    w.sync.script = seedingScript(100, 0);
    const { states, done } = start(w, { 'needs-pairing': pairWithCode() });
    await done;
    assert.deepEqual(w.events, ['open-db:existing']);
    assert.equal(
      states.some((s) => s.kind === 'importing'),
      false,
    );
    assert.equal(
      states.some((s) => s.kind === 'needs-pairing'),
      true,
    );
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('sembrado: solo falta pedir el secreto y terminar', async () => {
    const w = world();
    w.sync.paired = true;
    claimedByMe(w);
    w.progress.value = {
      version: 1,
      role: 'migrator',
      startedAt: T0 - HOUR,
      imported: true,
      localDone: true,
      seeded: true,
    };
    const { states, done } = start(w);
    await done;
    assert.deepEqual([...new Set(kinds(states))], ['checking', 'finishing', 'done']);
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('cutover ya en done a nombre de este PC (se cerró antes de anotarlo): solo cierra en local', async () => {
    const w = world();
    w.bridge.row = { state: 'done', ...SELF, at: T0 - HOUR };
    w.progress.value = {
      version: 1,
      role: 'migrator',
      startedAt: T0 - 2 * HOUR,
      imported: true,
      localDone: true,
      seeded: true,
    };
    const { done } = start(w);
    await done;
    assert.equal(w.bridge.calls.includes('complete'), false);
    assert.equal(w.events.includes('import'), false);
    assert.equal(w.progress.value?.completed, true);
  });

  it('secundario a medias: no reclama, no importa y retoma la bajada', async () => {
    const w = world();
    doneByOther(w);
    w.sync.paired = true;
    w.progress.value = { version: 1, role: 'secondary', startedAt: T0 - HOUR };
    const { done } = start(w);
    await done;
    assert.equal(w.bridge.calls.includes('claim'), false);
    assert.equal(w.sync.secretPairs.length, 0, 'ya estaba emparejado');
    assert.equal(w.sync.started, 1);
    assert.deepEqual(w.events, ['open-db:fresh', 'secondary-local']);
  });

  it('secundario con la migración local hecha: solo espera la bajada', async () => {
    const w = world();
    doneByOther(w);
    w.sync.paired = true;
    w.progress.value = { version: 1, role: 'secondary', startedAt: T0 - HOUR, localDone: true };
    const { done } = start(w);
    await done;
    assert.equal(w.events.includes('secondary-local'), false);
  });

  it('con la marca de completado no hace nada más', async () => {
    const w = world();
    w.progress.value = { version: 1, role: 'migrator', startedAt: T0, completed: true };
    const { states, done } = start(w);
    await done;
    assert.equal(w.bridge.calls.length, 0);
    assert.equal(states.at(-1)?.kind, 'done');
  });
});

// ── Sin Turso ───────────────────────────────────────────────────────────────

describe('cutover: un solo PC, sin Turso (§19.5)', () => {
  it('importa y migra en local, sin reclamo ni emparejado', async () => {
    const w = world();
    w.bridgeConfigured = false;
    const { states, done } = start(w);
    await done;
    assert.deepEqual(w.events, ['remove-db', 'import', 'open-db:existing', 'after-import']);
    assert.equal(
      states.some((s) => s.kind === 'needs-pairing'),
      false,
    );
    assert.equal(w.sync.pairs.length, 0);
    assert.equal(w.progress.value?.role, 'local');
    assert.equal(w.progress.value?.completed, true);
  });

  it('si la importación falla no deja base ni marca', async () => {
    const w = world();
    w.bridgeConfigured = false;
    w.importErrors = [new Error('boom')];
    const { states } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    assert.ok(last?.kind === 'error');
    assert.equal(last.code, 'import-failed');
    assert.equal(w.dbFile, false);
  });

  it('si ya había reclamado con Turso y las credenciales desaparecen, no migra a ciegas', async () => {
    const w = world();
    w.bridgeConfigured = false;
    w.progress.value = { version: 1, role: 'migrator', startedAt: T0 };
    const { states } = start(w);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(states.at(-1)?.kind, 'error');
    assert.equal(w.events.includes('import'), false);
  });
});

// ── Estado y acciones ───────────────────────────────────────────────────────

describe('cutover: estado y acciones', () => {
  it('las acciones que no tocan al estado actual se ignoran', async () => {
    const w = world();
    w.sync.paired = true;
    w.bridge.statuses = [status({ pendingChanges: 1 })];
    const { controller, done } = start(w, {
      // Antes de la pregunta llega un `retry` (no vale) y luego `continue`.
      'question-lagging': () => {
        controller.dispatch({ type: 'retry' });
        return { type: 'continue' };
      },
    });
    await done;
    assert.equal(w.bridge.row?.state, 'done');
  });

  it('un estado repetido no se vuelve a emitir', async () => {
    const w = world();
    w.sync.paired = true;
    w.sync.script = [
      ...Array.from({ length: 5 }, () => ({
        hubKnown: true,
        rowsPending: 7,
        rowsLocal: 7,
        pulled: false,
        problem: null,
      })),
      DONE_PROGRESS,
    ];
    const { states, done } = start(w);
    await done;
    assert.equal(states.filter((s) => s.kind === 'seeding').length, 1);
  });

  it('el estado inicial es idle y solo se puede correr una vez a la vez', async () => {
    const w = world();
    w.sync.paired = true;
    const controller = new CutoverController(deps(w));
    assert.equal(controller.state.kind, 'idle');
    const first = controller.run();
    await assert.rejects(controller.run(), /ya está en marcha/);
    await first;
    assert.equal(controller.state.kind, 'done');
  });
});
