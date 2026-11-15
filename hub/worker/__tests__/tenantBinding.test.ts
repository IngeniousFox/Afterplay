import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bindTenant, type TenantRpc } from '../src/tenantBinding';
import { VERSION } from './helpers';

describe('bindTenant', () => {
  it('pasa el id del inquilino como primer argumento de cada llamada RPC', async () => {
    const calls: unknown[][] = [];
    const record =
      (name: string) =>
      async (...args: unknown[]): Promise<never> => {
        calls.push([name, ...args]);
        return undefined as never;
      };
    const rpc: TenantRpc = {
      status: record('status'),
      push: record('push'),
      pull: record('pull'),
      claimJob: record('claimJob'),
      doneJob: record('doneJob'),
      enroll: record('enroll'),
      createEnrollmentCode: record('createEnrollmentCode'),
      listTokens: record('listTokens'),
      revokeToken: record('revokeToken'),
    };
    const api = bindTenant(rpc, 'abc123');
    await api.status('tok', VERSION);
    await api.pull('tok', 5, 10, VERSION);
    await api.listTokens();
    await api.revokeToken('id-1');
    assert.deepEqual(calls, [
      ['status', 'abc123', 'tok', VERSION],
      ['pull', 'abc123', 'tok', 5, 10, VERSION],
      ['listTokens', 'abc123'],
      ['revokeToken', 'abc123', 'id-1'],
    ]);
  });
});
