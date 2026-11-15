import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NodeSqlStorage } from '../../core/node/nodeStorage';
import { DirectoryStore, INVITATION_TTL_MS, TENANT_ID_ALPHABET } from '../src/directoryStore';

const HOST = 'host@example.com';

function makeStore(ids?: string[]): { store: DirectoryStore; time: { now: number } } {
  const time = { now: 1_000_000 };
  const queue = ids ? [...ids] : null;
  const store = new DirectoryStore(
    new NodeSqlStorage(),
    () => time.now,
    queue ? () => queue.shift() ?? 'zzzzzz' : undefined,
  );
  return { store, time };
}

describe('Directory: correo -> inquilino', () => {
  it('falla cerrado: un correo desconocido no tiene inquilino', () => {
    const { store } = makeStore();
    assert.equal(store.resolve('intruso@example.com', HOST), null);
    assert.equal(store.resolve('intruso@example.com', undefined), null);
    assert.equal(store.resolve('no-es-un-correo', 'no-es-un-correo'), null);
  });

  it('la primera entrada del anfitrión crea su inquilino y las siguientes lo reutilizan', () => {
    const { store } = makeStore();
    const first = store.resolve('Host@Example.com ', HOST);
    assert.ok(first?.created);
    assert.match(first.tenantId, new RegExp(`^[${TENANT_ID_ALPHABET}]{6}$`));
    const again = store.resolve(HOST, HOST);
    assert.deepEqual(again, { tenantId: first.tenantId, created: false });
    assert.ok(store.tenantExists(first.tenantId));
    assert.equal(store.tenantExists('nadie0'), false);
  });

  it('sin ADMIN_EMAIL nadie es anfitrión', () => {
    const { store } = makeStore();
    assert.equal(store.resolve(HOST, undefined), null);
    assert.equal(store.resolve(HOST, ''), null);
  });

  it('un invitado crea SU inquilino, distinto del del anfitrión, y la invitación se gasta', () => {
    const { store } = makeStore();
    const host = store.resolve(HOST, HOST)!;
    const invite = store.invite('Ana@example.com', HOST);
    assert.ok(invite.ok);
    const ana = store.resolve('ana@example.com', HOST)!;
    assert.ok(ana.created);
    assert.notEqual(ana.tenantId, host.tenantId);
    assert.notEqual(store.listInvitations()[0].acceptedAt, null);
    // Ya tiene inquilino: no se le puede invitar otra vez.
    assert.deepEqual(store.invite('ana@example.com', HOST), {
      ok: false,
      reason: 'already_member',
    });
  });

  it('la invitación caduca y se puede renovar', () => {
    const { store, time } = makeStore();
    store.invite('ana@example.com', HOST);
    time.now += INVITATION_TTL_MS + 1;
    assert.equal(store.resolve('ana@example.com', HOST), null);
    store.invite('ana@example.com', HOST);
    assert.ok(store.resolve('ana@example.com', HOST));
  });

  it('rechaza correos no válidos al invitar', () => {
    const { store } = makeStore();
    assert.deepEqual(store.invite('abc', HOST), { ok: false, reason: 'invalid_email' });
  });

  it('reintenta si el id sorteado ya existe', () => {
    const { store } = makeStore(['aaaaaa', 'aaaaaa', 'bbbbbb']);
    assert.equal(store.resolve(HOST, HOST)!.tenantId, 'aaaaaa');
    store.invite('ana@example.com', HOST);
    assert.equal(store.resolve('ana@example.com', HOST)!.tenantId, 'bbbbbb');
  });
});
