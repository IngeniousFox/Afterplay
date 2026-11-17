import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CredentialsBundle } from '../../../src/shared/sync/credentialsBundle';
import { SYNC_ROUTES } from '../../../src/shared/sync/protocol';
import { CREDENTIALS_BUNDLE_PURPOSE } from '../src/credentialBundle';
import { openSecret } from '../../core/secretBox';
import { HOST, makeWorld, pairDevice, type World } from './helpers';

// Paquete de credenciales del hub: se fusiona entre PCs, se guarda cifrado y
// alimenta a IGDB para la PWA. Todo con valores inventados y un `fetch` falso.

const SECRETS_KEY = 'clave-maestra-de-prueba-con-mas-de-32-caracteres';
const SECRET_VALUE = 'valor-secreto-de-prueba';

const entry = (
  value: string | null,
  updatedAt: number,
): { value: string | null; updatedAt: number } => ({
  value,
  updatedAt,
});

const exchange = (world: World, token: string, entries: unknown): Promise<Response> =>
  world.call(SYNC_ROUTES.credentials, { token, body: { entries } });

const entriesOf = async (response: Response): Promise<CredentialsBundle> =>
  ((await response.json()) as { entries: CredentialsBundle }).entries;

async function readyWorld(fetchImpl?: typeof fetch): Promise<{
  world: World;
  token: string;
  tenantId: string;
}> {
  const world = makeWorld(HOST, { secretsKey: SECRETS_KEY, fetch: fetchImpl });
  const { token, tenantId } = await pairDevice(world);
  return { world, token, tenantId };
}

interface StoreInternals {
  credentialStore: {
    storage: { exec(sql: string): Record<string, unknown>[] };
    has(): boolean;
  };
}
const internals = (world: World, tenantId: string): StoreInternals['credentialStore'] =>
  (world.services.get(tenantId) as unknown as StoreInternals).credentialStore;

describe('POST /sync/v1/credentials', () => {
  it('devuelve lo subido y luego lo entrega a otro PC (fusión en los dos sentidos)', async () => {
    const { world, token } = await readyWorld();

    const first = await exchange(world, token, { steamApiKey: entry('clave-steam', 10) });
    assert.equal(first.status, 200);
    assert.deepEqual(await entriesOf(first), { steamApiKey: entry('clave-steam', 10) });

    // Otro PC sube otra clave y recibe las dos.
    const second = await exchange(world, token, { raApiKey: entry('clave-ra', 20) });
    assert.deepEqual(await entriesOf(second), {
      steamApiKey: entry('clave-steam', 10),
      raApiKey: entry('clave-ra', 20),
    });

    // Un PC sin nada solo descarga.
    assert.deepEqual(await entriesOf(await exchange(world, token, {})), {
      steamApiKey: entry('clave-steam', 10),
      raApiKey: entry('clave-ra', 20),
    });
  });

  it('gana la entrada más nueva y en un empate se queda la guardada', async () => {
    const { world, token } = await readyWorld();
    await exchange(world, token, { steamApiKey: entry('vieja', 10) });

    const newer = await entriesOf(
      await exchange(world, token, { steamApiKey: entry('nueva', 11) }),
    );
    assert.deepEqual(newer.steamApiKey, entry('nueva', 11));

    const older = await entriesOf(
      await exchange(world, token, { steamApiKey: entry('antigua', 5) }),
    );
    assert.deepEqual(older.steamApiKey, entry('nueva', 11));

    const tie = await entriesOf(await exchange(world, token, { steamApiKey: entry('empate', 11) }));
    assert.deepEqual(tie.steamApiKey, entry('nueva', 11));
  });

  it('un borrado más nuevo se propaga', async () => {
    const { world, token } = await readyWorld();
    await exchange(world, token, { steamApiKey: entry('clave', 10) });

    const deleted = await entriesOf(await exchange(world, token, { steamApiKey: entry(null, 30) }));
    assert.deepEqual(deleted.steamApiKey, entry(null, 30));
    assert.deepEqual(
      (await entriesOf(await exchange(world, token, {}))).steamApiKey,
      entry(null, 30),
    );
  });

  it('admite el destino de las partidas guardadas y valida sus valores', async () => {
    const { world, token } = await readyWorld();
    const ok = await exchange(world, token, { saveStorageProvider: entry('s3', 1) });
    assert.equal(ok.status, 200);
    const bad = await exchange(world, token, { saveStorageProvider: entry('azure', 2) });
    assert.equal(bad.status, 400);
  });

  it('rechaza claves desconocidas, Turso y valores fuera de forma con 400', async () => {
    const { world, token } = await readyWorld();
    const cases: unknown[] = [
      { otraCosa: entry('x', 1) },
      { databaseUrl: entry('libsql://x', 1) },
      { databaseAuthToken: entry('x', 1) },
      { steamApiKey: entry('', 1) },
      { steamApiKey: entry('con\nsalto', 1) },
      { steamApiKey: entry('a'.repeat(4097), 1) },
      { steamApiKey: entry('x', -1) },
      { steamApiKey: entry('x', 1.5) },
      { steamApiKey: { value: 'x', updatedAt: 1, extra: true } },
      { steamApiKey: 'x' },
    ];
    for (const entries of cases) {
      assert.equal((await exchange(world, token, entries)).status, 400, JSON.stringify(entries));
    }
    assert.equal((await world.call(SYNC_ROUTES.credentials, { token, body: {} })).status, 400);
  });

  it('exige el token del dispositivo y solo admite POST', async () => {
    const { world, token } = await readyWorld();
    assert.equal(
      (await world.call(SYNC_ROUTES.credentials, { body: { entries: {} } })).status,
      401,
    );
    assert.equal(
      (
        await world.call(SYNC_ROUTES.credentials, {
          token: 'ap1.abc.desconocido-0123456789',
          body: { entries: {} },
        })
      ).status,
      401,
    );
    assert.equal((await world.call(SYNC_ROUTES.credentials, { token, method: 'GET' })).status, 405);
  });

  it('sin HUB_SECRETS_KEY responde un error claro y no guarda nada', async () => {
    const world = makeWorld(HOST, {});
    const { token, tenantId } = await pairDevice(world);

    const response = await exchange(world, token, { steamApiKey: entry(SECRET_VALUE, 1) });

    assert.equal(response.status, 500);
    const body = (await response.json()) as { error: string; message: string };
    assert.equal(body.error, 'internal');
    assert.match(body.message, /HUB_SECRETS_KEY/);
    assert.ok(!JSON.stringify(body).includes(SECRET_VALUE));
    assert.equal(internals(world, tenantId).has(), false);
  });

  it('en el almacenamiento solo hay el sobre cifrado, que se abre con la clave del Worker', async () => {
    const { world, token, tenantId } = await readyWorld();
    await exchange(world, token, { steamApiKey: entry(SECRET_VALUE, 10) });

    const store = internals(world, tenantId);
    const rows = store.storage.exec('SELECT envelope FROM worker_credentials');
    assert.equal(rows.length, 1);
    const envelope = String(rows[0].envelope);
    assert.match(envelope, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    assert.ok(!envelope.includes(SECRET_VALUE));
    assert.deepEqual(
      JSON.parse(await openSecret(SECRETS_KEY, CREDENTIALS_BUNDLE_PURPOSE, tenantId, envelope)),
      { steamApiKey: entry(SECRET_VALUE, 10) },
    );
  });

  it('no reescribe el sobre si el intercambio no cambia nada', async () => {
    const { world, token, tenantId } = await readyWorld();
    await exchange(world, token, { steamApiKey: entry('clave', 10) });
    const store = internals(world, tenantId);
    const before = String(
      store.storage.exec('SELECT envelope FROM worker_credentials')[0].envelope,
    );

    await exchange(world, token, { steamApiKey: entry('otra', 10) });
    await exchange(world, token, {});

    const after = String(store.storage.exec('SELECT envelope FROM worker_credentials')[0].envelope);
    assert.equal(after, before);
  });
});

describe('IGDB de la PWA con el paquete de credenciales', () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://id.twitch.tv/')) {
      calls.push(String(init?.body));
      return Response.json({ access_token: 'token-de-prueba', expires_in: 3600 });
    }
    return Response.json([]);
  }) as typeof fetch;

  const search = (world: World): Promise<Response> =>
    world.call('/api/v2/search?q=zelda', { email: HOST });

  it('busca con las claves de Twitch del paquete', async () => {
    calls.length = 0;
    const { world, token } = await readyWorld(fakeFetch);
    await exchange(world, token, {
      twitchClientId: entry('cliente-bundle', 5),
      twitchClientSecret: entry('secreto-bundle', 5),
    });

    const response = await search(world);

    assert.equal(response.status, 200);
    assert.match(calls[0], /client_id=cliente-bundle/);
    assert.match(calls[0], /client_secret=secreto-bundle/);
  });

  it('con el paquete incompleto responde igdb_not_configured', async () => {
    calls.length = 0;
    const { world, token } = await readyWorld(fakeFetch);
    // Solo el id: el paquete no sirve.
    await exchange(world, token, { twitchClientId: entry('cliente-bundle', 5) });

    const response = await search(world);

    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { error: string }).error, 'igdb_not_configured');
    assert.equal(calls.length, 0);
  });

  it('sin paquete responde igdb_not_configured', async () => {
    const { world } = await readyWorld(fakeFetch);
    const response = await search(world);
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { error: string }).error, 'igdb_not_configured');
  });
});
