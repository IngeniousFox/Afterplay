import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { EnrollRequest, EnrollResponse } from '../../../shared/sync/protocol';
import {
  mergeCredentialBundles,
  type CredentialEntry,
  type CredentialsBundle,
} from '../../../shared/sync/credentialsBundle';
import { SyncRequestError } from '../../../shared/sync/protocol';
import { OTHER, T0 } from '../../db/v2/__tests__/helpers';
import {
  insertSynced,
  openQueryDb,
  seedGame,
  type QueryFixture,
} from '../../db/v2/queries/common/__tests__/fixtures';
import { createSyncEngine, type SyncChange, type SyncLogger } from '../engine';
import {
  CREDENTIALS_SYNC_INTERVAL_MS,
  IMPORTED_LIBRARY_CONFLICT,
  SyncRuntime,
  type CredentialsSource,
  type SyncCredentialsStore,
  type SyncRuntimeDeps,
} from '../runtime';
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

const markImported = (s: Setup): void => {
  insertSynced(s.fx.ctx, 'devices', {
    id: 'legacy',
    name: 'Afterplay 1.x',
    kind: 'legacy',
    os: 'windows',
    firstSeenAt: new Date(T0),
  });
};

describe('emparejar una biblioteca importada de la 1.x', () => {
  const SECRET_OK = `aes1.tenant.${'a'.repeat(43)}`;

  it('rechaza (con código y con secreto) un hub que ya tiene datos y no guarda nada', async () => {
    for (const via of ['code', 'secret'] as const) {
      const s = setup();
      markImported(s);
      s.hub.seq = 7;
      const result =
        via === 'code'
          ? await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'K7-93' })
          : await s.runtime.pairWithSecret({
              hubUrl: 'https://hub.example',
              enrollSecret: SECRET_OK,
            });
      assert.deepEqual(result, { ok: false, message: IMPORTED_LIBRARY_CONFLICT }, via);
      assert.equal(s.credentials.value, null, via);
      assert.equal(s.credentials.writes, 0, via);
      assert.equal(s.runtime.isActive, false, via);
      assert.notEqual(readSyncState(s.fx.local.db).shortDeviceId, 'abc123', via);
    }
  });

  it('acepta un hub vacío: es la siembra del migrador', async () => {
    const s = setup();
    markImported(s);
    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'K7-93' });
    assert.equal(result.ok, true);
    assert.deepEqual(s.credentials.value, { hubUrl: 'https://hub.example', token: TOKEN });
  });

  it('acepta un hub con datos si este PC ya había sincronizado con él', async () => {
    const s = setup();
    markImported(s);
    s.hub.seq = 7;
    s.fx.local.db.$client
      .prepare(`UPDATE "local_sync_state" SET "hubId" = 'hub-1' WHERE "id" = 1`)
      .run();
    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'K7-93' });
    assert.equal(result.ok, true);
  });

  it('una base sin filas importadas (secundario del corte) se empareja con un hub poblado', async () => {
    const s = setup();
    s.hub.seq = 7;
    const secret = await s.runtime.pairWithSecret({
      hubUrl: 'https://hub.example',
      enrollSecret: SECRET_OK,
    });
    assert.equal(secret.ok, true);
    assert.equal(s.transports.length, 1, 'solo el del ciclo normal: no se consultó el hub antes');
  });

  it('si no se puede mirar el hub, rechaza en vez de arriesgar la mezcla', async () => {
    const s = setup();
    markImported(s);
    s.hub.failures.push(new SyncRequestError('network', 'sin red'));
    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'K7-93' });
    assert.equal(result.ok, false);
    assert.equal(s.credentials.value, null);
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

describe('sync rapido antes de crear (§10.7)', () => {
  it('sin hub emparejado resuelve al instante y no toca la red', async () => {
    const s = setup();
    await s.runtime.start();

    await s.runtime.syncOnceWithin(3000);

    assert.equal(s.transports.length, 0);
    assert.equal(statusCalls(s.hub), 0);
  });

  it('en modo E2E no hace nada', async () => {
    const s = setup({ isE2E: true }, { paired: true });
    await s.runtime.start();

    await s.runtime.syncOnceWithin(3000);

    assert.equal(statusCalls(s.hub), 0);
  });

  it('con hub activo lanza un ciclo y vuelve cuando termina', async () => {
    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    const before = statusCalls(s.hub);

    await s.runtime.syncOnceWithin(3000);

    assert.ok(statusCalls(s.hub) > before, 'hubo un ciclo nuevo');
  });

  it('no lanza aunque el hub falle', async () => {
    const s = setup({}, { paired: true });
    await s.runtime.start(2000);
    s.hub.calls.length = 0;

    await assert.doesNotReject(s.runtime.syncOnceWithin(50));
  });
});

describe('credenciales con el hub', () => {
  // Valores inventados: ninguna clave real.
  const entry = (value: string | null, updatedAt: number): CredentialEntry => ({
    value,
    updatedAt,
  });

  /** Las credenciales de este PC en memoria. */
  class MemorySource implements CredentialsSource {
    bundle: CredentialsBundle = {};
    applied: CredentialsBundle[] = [];
    readBundle(): CredentialsBundle {
      return { ...this.bundle };
    }
    apply(changes: CredentialsBundle): void {
      this.applied.push(changes);
      this.bundle = { ...this.bundle, ...changes };
    }
  }

  /** Un hub que fusiona como el real y apunta lo que le suben. */
  const withCredentials = (
    options: { paired?: boolean; fail?: boolean; hubHas?: CredentialsBundle } = {},
  ): Setup & {
    source: MemorySource;
    uploads: { baseUrl: string; token: string; body: unknown }[];
    hubBundle: { current: CredentialsBundle };
  } => {
    const source = new MemorySource();
    const hubBundle = { current: options.hubHas ?? {} };
    const uploads: { baseUrl: string; token: string; body: unknown }[] = [];
    const s = setup(
      {
        credentialsSource: source,
        exchangeCredentials: (target, body) => {
          uploads.push({ baseUrl: target.baseUrl, token: target.token, body });
          if (options.fail) return Promise.reject(new SyncRequestError('network', 'sin red'));
          hubBundle.current = mergeCredentialBundles(hubBundle.current, body.entries);
          return Promise.resolve({ entries: hubBundle.current });
        },
      },
      { paired: options.paired ?? true },
    );
    return { ...s, source, uploads, hubBundle };
  };

  it('al arrancar emparejado intercambia una vez, con el token del dispositivo', async () => {
    const s = withCredentials();
    s.source.bundle = { steamApiKey: entry('clave-steam', 10) };

    await s.runtime.start(2000);
    await waitFor(() => s.uploads.length === 1);

    assert.deepEqual(s.uploads[0], {
      baseUrl: 'https://hub.example',
      token: TOKEN,
      body: { entries: { steamApiKey: entry('clave-steam', 10) } },
    });
    assert.deepEqual(s.hubBundle.current, { steamApiKey: entry('clave-steam', 10) });
    assert.deepEqual(s.source.applied, [], 'lo propio no se vuelve a aplicar');
  });

  it('lo que el hub tiene más nuevo se aplica, y lo que es más nuevo aquí no', async () => {
    const s = withCredentials({
      hubHas: {
        steamApiKey: entry('steam-del-hub', 20),
        raApiKey: entry('ra-vieja-del-hub', 5),
        s3Bucket: entry(null, 30),
      },
    });
    s.source.bundle = {
      steamApiKey: entry('steam-local', 10),
      raApiKey: entry('ra-nueva-local', 15),
      s3Bucket: entry('bucket-local', 12),
    };

    assert.equal(await s.runtime.syncCredentials(), 'applied');

    assert.deepEqual(s.source.applied, [
      { steamApiKey: entry('steam-del-hub', 20), s3Bucket: entry(null, 30) },
    ]);
    // Y el hub se quedó con la local más nueva.
    assert.deepEqual(s.hubBundle.current.raApiKey, entry('ra-nueva-local', 15));
  });

  it('una clave que este PC no tiene se baja', async () => {
    const s = withCredentials({ hubHas: { anthropicApiKey: entry('clave-anthropic', 7) } });

    assert.equal(await s.runtime.syncCredentials(), 'applied');

    assert.deepEqual(s.source.applied, [{ anthropicApiKey: entry('clave-anthropic', 7) }]);
  });

  it('un borrado del hub de algo que aquí nunca existió no se aplica', async () => {
    const s = withCredentials({ hubHas: { raApiKey: entry(null, 7) } });

    assert.equal(await s.runtime.syncCredentials(), 'synced');

    assert.deepEqual(s.source.applied, []);
  });

  it('con el mismo sello y otro valor gana el hub; con el mismo valor no se aplica nada', async () => {
    const s = withCredentials({
      hubHas: { steamApiKey: entry('valor-del-hub', 10), raApiKey: entry('igual', 10) },
    });
    s.source.bundle = { steamApiKey: entry('valor-local', 10), raApiKey: entry('igual', 10) };

    assert.equal(await s.runtime.syncCredentials(), 'applied');
    assert.deepEqual(s.source.applied, [{ steamApiKey: entry('valor-del-hub', 10) }]);

    assert.equal(await s.runtime.syncCredentials(), 'synced');
    assert.equal(s.source.applied.length, 1);
  });

  it('un fallo del hub no aplica nada y se puede reintentar', async () => {
    const s = withCredentials({ fail: true });
    s.source.bundle = { steamApiKey: entry('clave', 1) };

    assert.equal(await s.runtime.syncCredentials(), 'failed');
    assert.equal(await s.runtime.syncCredentials(), 'failed');

    assert.equal(s.uploads.length, 2);
    assert.deepEqual(s.source.applied, []);
  });

  it('una respuesta con claves desconocidas (o de Turso) se descarta entera', async () => {
    const source = new MemorySource();
    const s = setup(
      {
        credentialsSource: source,
        exchangeCredentials: () =>
          Promise.resolve({
            entries: { databaseUrl: entry('libsql://otra', 99) } as unknown as CredentialsBundle,
          }),
      },
      { paired: true },
    );

    assert.equal(await s.runtime.syncCredentials(), 'failed');
    assert.deepEqual(source.applied, []);
  });

  it('no hace dos intercambios a la vez', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = new MemorySource();
    const s = setup(
      {
        credentialsSource: source,
        exchangeCredentials: async () => {
          await gate;
          return { entries: {} };
        },
      },
      { paired: true },
    );

    const first = s.runtime.syncCredentials();
    assert.equal(await s.runtime.syncCredentials(), 'busy');
    release();
    assert.equal(await first, 'synced');
  });

  it('sin emparejar no pide nada; al emparejar sí', async () => {
    const s = withCredentials({ paired: false });
    s.source.bundle = { steamApiKey: entry('clave', 1) };

    assert.equal(await s.runtime.syncCredentials(), 'not-paired');
    assert.equal(s.uploads.length, 0);

    const result = await s.runtime.pair({ hubUrl: 'https://hub.example', code: 'K7-93' });
    assert.equal(result.ok, true);
    await waitFor(() => s.uploads.length === 1);
  });

  it('en modo E2E o con un hub bloqueado no pide nada', async () => {
    for (const overrides of [{ isE2E: true }, { isHubBlocked: () => true }]) {
      const uploads: unknown[] = [];
      const s = setup(
        {
          ...overrides,
          credentialsSource: new MemorySource(),
          exchangeCredentials: (_target, body) => {
            uploads.push(body);
            return Promise.resolve({ entries: {} });
          },
        },
        { paired: true },
      );

      assert.equal(await s.runtime.syncCredentials(), 'not-paired');
      assert.equal(uploads.length, 0);
    }
  });

  it('tras un ciclo correcto repite el intercambio, pero no más de una vez cada 10 minutos', async () => {
    const s = withCredentials();
    await s.runtime.start(2000);
    await waitFor(() => s.uploads.length === 1);

    // Un ciclo poco después del arranque: no.
    s.runtime.syncNow();
    await waitFor(() => statusCalls(s.hub) >= 2);
    await pause(30);
    assert.equal(s.uploads.length, 1);

    // Pasados los 10 minutos, el siguiente ciclo correcto sí.
    s.fx.wall.advance(CREDENTIALS_SYNC_INTERVAL_MS + 1);
    const before = statusCalls(s.hub);
    s.runtime.syncNow();
    await waitFor(() => statusCalls(s.hub) > before);
    await waitFor(() => s.uploads.length === 2);

    // Y otra vez enseguida: no.
    const again = statusCalls(s.hub);
    s.runtime.syncNow();
    await waitFor(() => statusCalls(s.hub) > again);
    await pause(30);
    assert.equal(s.uploads.length, 2);
  });
});

describe('secreto de alta (migración, §19.3.1)', () => {
  // 43 caracteres base64url: la forma de un secreto del hub (el valor es de prueba).
  const SECRET = `aes1.tenant.${'k'.repeat(43)}`;
  const recording = (): { logger: SyncLogger; lines: string[] } => {
    const lines: string[] = [];
    const push = (...args: unknown[]): void => {
      lines.push(args.map(String).join(' '));
    };
    return { logger: { info: push, warn: push, error: push }, lines };
  };

  it('pide el secreto al hub con el token de este PC y devuelve dirección, secreto y caducidad', async () => {
    const calls: { baseUrl: string; token: string }[] = [];
    const s = setup(
      {
        requestEnrollSecret: (options) => {
          calls.push({ baseUrl: options.baseUrl, token: options.token });
          return Promise.resolve({ enrollSecret: SECRET, expiresAt: T0 + 7 * 86_400_000 });
        },
      },
      { paired: true },
    );
    await s.runtime.start(2000);

    const result = await s.runtime.requestEnrollSecret();

    assert.deepEqual(calls, [{ baseUrl: 'https://hub.example', token: TOKEN }]);
    assert.deepEqual(result, {
      ok: true,
      grant: { url: 'https://hub.example', enrollSecret: SECRET, expiresAt: T0 + 7 * 86_400_000 },
    });
  });

  it('sin emparejar, o en E2E, no llama al hub', async () => {
    let called = 0;
    const requestEnrollSecret = (): Promise<never> => {
      called++;
      return Promise.reject(new Error('no debería llamarse'));
    };
    const unpaired = setup({ requestEnrollSecret });
    assert.equal((await unpaired.runtime.requestEnrollSecret()).ok, false);
    const e2e = setup({ isE2E: true, requestEnrollSecret }, { paired: true });
    assert.equal((await e2e.runtime.requestEnrollSecret()).ok, false);
    assert.equal(called, 0);
  });

  it('un fallo del hub se cuenta con su código y nunca lanza; una respuesta rara no se acepta', async () => {
    const down = setup(
      {
        requestEnrollSecret: () => Promise.reject(new SyncRequestError('unauthorized', 'no', 401)),
      },
      { paired: true },
    );
    await down.runtime.start(2000);
    const failed = await down.runtime.requestEnrollSecret();
    assert.equal(failed.ok, false);

    const odd = setup(
      {
        requestEnrollSecret: () => Promise.resolve({ enrollSecret: 'otra-cosa', expiresAt: 1 }),
      },
      { paired: true },
    );
    await odd.runtime.start(2000);
    assert.equal((await odd.runtime.requestEnrollSecret()).ok, false);
  });

  it('empareja con dirección + secreto por el mismo camino que el código y guarda su propio token', async () => {
    const s = setup();

    const result = await s.runtime.pairWithSecret({
      hubUrl: ' https://hub.example/ ',
      enrollSecret: ` ${SECRET} `,
    });

    assert.equal(result.ok, true);
    assert.equal(s.enrollCalls.length, 1);
    assert.equal(s.enrollCalls[0].baseUrl, 'https://hub.example');
    assert.deepEqual(s.enrollCalls[0].request, {
      enrollSecret: SECRET,
      deviceId: s.fx.local.deviceId,
      deviceName: 'PC de prueba',
      protocolVersion: 1,
      schemaVersion: 1,
    });
    assert.deepEqual(s.credentials.value, { hubUrl: 'https://hub.example', token: TOKEN });
    assert.equal(readSyncState(s.fx.local.db).shortDeviceId, 'abc123');
    assert.equal(s.runtime.isActive, true);
  });

  it('rechaza un secreto sin forma, y con el PC ya emparejado o en E2E, sin llamar al hub', async () => {
    const s = setup();
    assert.equal(
      (await s.runtime.pairWithSecret({ hubUrl: 'https://hub.example', enrollSecret: 'x' })).ok,
      false,
    );
    const paired = setup({}, { paired: true });
    assert.equal(
      (await paired.runtime.pairWithSecret({ hubUrl: 'https://hub.example', enrollSecret: SECRET }))
        .ok,
      false,
    );
    const e2e = setup({ isE2E: true });
    assert.equal(
      (await e2e.runtime.pairWithSecret({ hubUrl: 'https://hub.example', enrollSecret: SECRET }))
        .ok,
      false,
    );
    assert.equal(s.enrollCalls.length + paired.enrollCalls.length + e2e.enrollCalls.length, 0);
  });

  it('un secreto caducado o sustituido dice que no vale y no deja nada guardado', async () => {
    const s = setup(
      {},
      {
        enroll: () => Promise.reject(new SyncRequestError('enroll_code_invalid', 'caducado', 400)),
      },
    );

    const result = await s.runtime.pairWithSecret({
      hubUrl: 'https://hub.example',
      enrollSecret: SECRET,
    });

    assert.equal(result.ok, false);
    assert.equal(s.credentials.value, null);
    assert.equal(s.runtime.isActive, false);
  });

  it('el secreto jamás va al log ni al mensaje de error, ni al emparejar ni al pedirlo', async () => {
    const { logger, lines } = recording();
    const raw = SECRET.split('.')[2];
    const s = setup(
      {
        logger,
        requestEnrollSecret: () => Promise.resolve({ enrollSecret: SECRET, expiresAt: T0 + 1 }),
      },
      {
        enroll: () =>
          Promise.reject(new SyncRequestError('enroll_code_invalid', 'secreto caducado', 400)),
      },
    );

    const failed = await s.runtime.pairWithSecret({
      hubUrl: 'https://hub.example',
      enrollSecret: SECRET,
    });
    const issued = setup(
      {
        logger,
        requestEnrollSecret: () => Promise.reject(new SyncRequestError('network', 'fallo', 0)),
      },
      { paired: true },
    );
    await issued.runtime.start(2000);
    const denied = await issued.runtime.requestEnrollSecret();

    const everything = JSON.stringify([lines, failed, denied]);
    assert.ok(lines.length > 0, 'sí se registra el fallo, con su código');
    assert.ok(!everything.includes(raw));
  });
});
