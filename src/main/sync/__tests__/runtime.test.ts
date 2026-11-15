import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { EnrollRequest, EnrollResponse } from '../../../shared/sync/protocol';
import { SyncRequestError } from '../../../shared/sync/protocol';
import { OTHER, T0 } from '../../db/v2/__tests__/helpers';
import {
  openQueryDb,
  seedGame,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import { createSyncEngine, type SyncChange, type SyncLogger } from '../engine';
import { SyncRuntime, type SyncCredentialsStore, type SyncRuntimeDeps } from '../runtime';
import { readSyncState } from '../state';
import { FakeHub } from './fakeHub';

// El sync dentro de la app (runtime.ts) con una base 2.0 en memoria, un hub
// falso y un almacén de credenciales en memoria. Lo que se prueba son las
// DECISIONES del runtime: cuándo arranca, cuándo no, qué guarda al emparejar y
// qué para al desemparejar. El motor y el planificador ya tienen sus tests.

const open: QueryFixture[] = [];
const runtimes: SyncRuntime[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const fx of open.splice(0)) fx.close();
});

const silent: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };

class MemoryCredentials implements SyncCredentialsStore {
  value: { hubUrl: string; token: string } | null = null;
  writes = 0;
  read(): { hubUrl: string; token: string } | null {
    return this.value;
  }
  write(credentials: { hubUrl: string; token: string }): void {
    this.writes++;
    this.value = credentials;
  }
  clear(): void {
    this.value = null;
  }
}

const TOKEN = 'ap1.tenant.secret';

const enrollResponse = (patch: Partial<EnrollResponse> = {}): EnrollResponse => ({
  token: TOKEN,
  tenantId: 'tenant',
  shortDeviceId: 'abc123',
  hubId: 'hub-1',
  epoch: 1,
  serverTime: T0,
  ...patch,
});

interface Setup {
  fx: QueryFixture;
  hub: FakeHub;
  credentials: MemoryCredentials;
  runtime: SyncRuntime;
  changes: SyncChange[];
  statusEvents: { count: number };
  transports: { baseUrl: string; token: string }[];
  enrollCalls: { baseUrl: string; request: EnrollRequest }[];
}

const setup = (
  overrides: Partial<SyncRuntimeDeps> = {},
  options: { paired?: boolean; hub?: FakeHub; enroll?: () => Promise<EnrollResponse> } = {},
): Setup => {
  const fx = openQueryDb();
  open.push(fx);
  const hub = options.hub ?? new FakeHub(T0);
  const credentials = new MemoryCredentials();
  if (options.paired) credentials.value = { hubUrl: 'https://hub.example', token: TOKEN };
  const changes: SyncChange[] = [];
  const statusEvents = { count: 0 };
  const transports: { baseUrl: string; token: string }[] = [];
  const enrollCalls: { baseUrl: string; request: EnrollRequest }[] = [];
  const runtime = new SyncRuntime({
    local: fx.local,
    deviceName: 'PC de prueba',
    isE2E: false,
    isHubBlocked: () => false,
    credentials,
    onChange: (change) => changes.push(change),
    onStatus: () => {
      statusEvents.count++;
    },
    logger: silent,
    now: fx.wall.wall,
    createTransport: (transportOptions) => {
      transports.push(transportOptions);
      return hub;
    },
    enroll: (baseUrl, request) => {
      enrollCalls.push({ baseUrl, request });
      return options.enroll ? options.enroll() : Promise.resolve(enrollResponse());
    },
    // Debounce corto y periódico larguísimo: el test decide cuándo hay ciclos.
    schedulerOptions: { debounceMs: 15, intervalMs: 3_600_000 },
    ...overrides,
  });
  runtimes.push(runtime);
  return { fx, hub, credentials, runtime, changes, statusEvents, transports, enrollCalls };
};

const statusCalls = (hub: FakeHub): number => hub.calls.filter((c) => c.kind === 'status').length;

const waitFor = async (condition: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: la condición no llegó a cumplirse');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('arranque', () => {
  it('sin hub emparejado no crea nada y la app sigue como sin sync', async () => {
    const s = setup();

    await s.runtime.start();

    assert.equal(s.runtime.isActive, false);
    assert.equal(s.transports.length, 0, 'ni transporte');
    assert.equal(statusCalls(s.hub), 0, 'ni una petición');
    assert.deepEqual(s.runtime.status(), {
      available: true,
      paired: false,
      hubUrl: null,
      running: false,
      lastPushAt: null,
      lastPullAt: null,
      problem: null,
      disabledReason: null,
    });
  });

  it('en modo E2E no arranca aunque haya un hub emparejado, y no deja emparejar', async () => {
    const s = setup({ isE2E: true }, { paired: true });

    await s.runtime.start();
    const pairing = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'ABCD' });

    assert.equal(s.runtime.isActive, false);
    assert.equal(s.transports.length, 0);
    assert.equal(statusCalls(s.hub), 0);
    assert.equal(s.enrollCalls.length, 0, 'ni siquiera se llama al hub para emparejar');
    assert.equal(pairing.ok, false);
    assert.equal(s.runtime.status().available, false);
    assert.equal(s.runtime.status().paired, false);
  });

  it('con hub emparejado lanza el primer ciclo y lo espera (con tope)', async () => {
    const s = setup({}, { paired: true });

    await s.runtime.start(2000);

    assert.equal(s.runtime.isActive, true);
    assert.deepEqual(s.transports, [{ baseUrl: 'https://hub.example', token: TOKEN }]);
    assert.ok(statusCalls(s.hub) >= 1);
    const status = s.runtime.status();
    assert.equal(status.paired, true);
    assert.equal(status.hubUrl, 'https://hub.example');
    assert.equal(status.problem, null);
    assert.equal(status.lastPullAt, T0);
  });

  it('un perfil de desarrollo con un hub que no es de desarrollo no sincroniza', async () => {
    const s = setup({ isHubBlocked: () => true }, { paired: true });

    await s.runtime.start();

    assert.equal(s.runtime.isActive, false);
    assert.equal(s.transports.length, 0);
    assert.equal(statusCalls(s.hub), 0);
    const status = s.runtime.status();
    assert.equal(status.paired, true);
    assert.match(status.disabledReason ?? '', /development hub/);
  });

  it('lo que baja del hub se avisa con las tablas cambiadas', async () => {
    const hub = new FakeHub(T0);
    const other = openQueryDb({ deviceId: OTHER });
    open.push(other);
    seedGame(other.ctx, { title: 'Del otro PC' });
    const otherEngine = createSyncEngine({
      local: other.local,
      transport: hub,
      now: other.wall.wall,
    });
    assert.equal((await otherEngine.runCycle()).status, 'ok');
    const s = setup({}, { paired: true, hub });

    await s.runtime.start(2000);

    assert.ok(s.changes.length >= 1);
    assert.ok(s.changes.some((change) => change.tables.includes('games')));
  });
});

describe('cambios locales (la puerta de escritura avisa al planificador)', () => {
  it('una escritura confirmada en una tabla sincronizada dispara un ciclo a los 2 s (aquí 15 ms)', async () => {
    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    const before = statusCalls(s.hub);

    seedGame(s.fx.ctx, { title: 'Nuevo' });
    await waitFor(() => statusCalls(s.hub) > before);

    assert.ok(s.hub.count('games') >= 1, 'el juego llegó al hub');
  });

  it('una transacción que se deshace no dispara nada', async () => {
    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    const before = statusCalls(s.hub);

    assert.throws(() =>
      s.fx.local.store.transaction(() => {
        seedGame(s.fx.ctx, { title: 'Se deshace' });
        throw new Error('deshacer');
      }),
    );
    await pause(80);

    assert.equal(statusCalls(s.hub), before);
  });

  it('tras desemparejar, escribir ya no dispara ciclos', async () => {
    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    s.runtime.unpair();
    const before = statusCalls(s.hub);

    seedGame(s.fx.ctx, { title: 'Después de desemparejar' });
    await pause(80);

    assert.equal(statusCalls(s.hub), before);
  });
});

describe('emparejar', () => {
  it('canjea el código con la identidad de este PC, guarda el token y arranca', async () => {
    const s = setup();

    const result = await s.runtime.pair({ hubUrl: ' https://hub.example/ ', code: '  K7-93  ' });

    assert.equal(result.ok, true);
    assert.equal(s.enrollCalls.length, 1);
    assert.equal(s.enrollCalls[0].baseUrl, 'https://hub.example', 'dirección normalizada');
    assert.deepEqual(s.enrollCalls[0].request, {
      code: 'K7-93',
      deviceId: s.fx.local.deviceId,
      deviceName: 'PC de prueba',
      protocolVersion: 1,
      schemaVersion: 1,
    });
    assert.deepEqual(s.credentials.value, { hubUrl: 'https://hub.example', token: TOKEN });
    // applyEnrollment: el id corto del hub sustituye al sorteado, en la base y en el reloj.
    assert.equal(readSyncState(s.fx.local.db).shortDeviceId, 'abc123');
    assert.equal(s.fx.local.clock.dev, 'abc123');
    assert.equal(s.runtime.isActive, true);
    await waitFor(() => statusCalls(s.hub) >= 1);
    assert.ok(s.statusEvents.count >= 1, 'la interfaz se entera');
    if (result.ok) assert.equal(result.status.paired, true);
  });

  it('rechaza una dirección sin https (salvo localhost) sin llamar al hub', async () => {
    const s = setup();

    const plain = await s.runtime.pair({ hubUrl: 'http://hub.example', code: 'X' });
    const garbage = await s.runtime.pair({ hubUrl: 'no es una url', code: 'X' });

    assert.equal(plain.ok, false);
    assert.equal(garbage.ok, false);
    assert.equal(s.enrollCalls.length, 0);
    assert.equal(s.credentials.writes, 0);
  });

  it('admite http://localhost para un hub de desarrollo', async () => {
    const s = setup();

    const result = await s.runtime.pair({ hubUrl: 'http://localhost:8787', code: 'X' });

    assert.equal(result.ok, true);
    assert.equal(s.credentials.value?.hubUrl, 'http://localhost:8787');
  });

  it('exige código', async () => {
    const s = setup();

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: '   ' });

    assert.equal(result.ok, false);
    assert.equal(s.enrollCalls.length, 0);
  });

  it('un perfil de desarrollo no empareja con un hub de producción', async () => {
    const s = setup({ isHubBlocked: () => true });

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'X' });

    assert.equal(result.ok, false);
    assert.equal(s.enrollCalls.length, 0);
    assert.equal(s.credentials.writes, 0);
  });

  it('un código inválido dice por qué y no deja nada guardado ni arrancado', async () => {
    const s = setup(
      {},
      {
        enroll: () =>
          Promise.reject(new SyncRequestError('enroll_code_invalid', 'código caducado', 403)),
      },
    );

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'MALO' });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /not valid or has expired/);
    assert.equal(s.credentials.value, null);
    assert.equal(s.runtime.isActive, false);
    assert.equal(readSyncState(s.fx.local.db).shortDeviceId === 'abc123', false);
  });

  it('un hub caído se cuenta como falta de conexión', async () => {
    const s = setup(
      {},
      { enroll: () => Promise.reject(new SyncRequestError('network', 'fetch failed')) },
    );

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'X' });

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /reach the hub/);
  });

  it('una respuesta sin token de dispositivo no se guarda', async () => {
    const s = setup({}, { enroll: () => Promise.resolve(enrollResponse({ token: 'otra-cosa' })) });

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'X' });

    assert.equal(result.ok, false);
    assert.equal(s.credentials.value, null);
  });

  it('un id corto inválido del hub no deja el PC a medio emparejar', async () => {
    const s = setup(
      {},
      { enroll: () => Promise.resolve(enrollResponse({ shortDeviceId: 'legacy' })) },
    );

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'X' });

    assert.equal(result.ok, false);
    assert.equal(s.credentials.value, null, 'sin token guardado');
    assert.equal(s.runtime.isActive, false);
  });

  it('con el PC ya emparejado no se vuelve a emparejar sin desemparejar', async () => {
    const s = setup({}, { paired: true });

    const result = await s.runtime.pair({ hubUrl: 'https://otro.example', code: 'X' });

    assert.equal(result.ok, false);
    assert.equal(s.enrollCalls.length, 0);
  });
});

describe('desemparejar', () => {
  it('olvida el token, para el planificador y deja la app sin sync', async () => {
    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    assert.equal(s.runtime.isActive, true);

    const status = s.runtime.unpair();

    assert.equal(s.credentials.value, null);
    assert.equal(s.runtime.isActive, false);
    assert.equal(status.paired, false);
    assert.equal(status.hubUrl, null);
    const before = statusCalls(s.hub);
    s.runtime.syncNow();
    s.runtime.wake();
    await pause(40);
    assert.equal(statusCalls(s.hub), before, 'ni "sincronizar ahora" ni wake hacen nada');
  });

  it('se puede volver a emparejar después', async () => {
    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    s.runtime.unpair();

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'NUEVO' });

    assert.equal(result.ok, true);
    assert.equal(s.runtime.isActive, true);
  });
});

describe('estado y ciclos', () => {
  it('un token revocado se cuenta con una frase para el usuario y "sincronizar ahora" lo reintenta', async () => {
    const hub = new FakeHub(T0);
    hub.failures.push(new SyncRequestError('unauthorized', 'revocado', 401));
    const s = setup({}, { paired: true, hub });

    await s.runtime.start(2000);

    const status = s.runtime.status();
    assert.equal(status.problem?.code, 'unauthorized');
    assert.match(status.problem?.message ?? '', /no longer authorized/);
    assert.equal(status.problem?.retrying, false);

    const before = statusCalls(hub);
    s.runtime.syncNow();
    await waitFor(() => statusCalls(hub) > before && s.runtime.status().problem === null);
  });

  it('subida final al cerrar: sin sync no hace nada, con sync sube lo pendiente', async () => {
    const idle = setup();
    assert.equal(await idle.runtime.flushOnQuit(), 'skipped');

    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    seedGame(s.fx.ctx, { title: 'Último cambio' });

    const outcome = await s.runtime.flushOnQuit(2000);

    assert.equal(outcome, 'flushed');
    assert.ok(s.hub.count('games') >= 1, 'el último cambio llegó antes de salir');
    assert.equal(s.runtime.isActive, false);
  });
});
