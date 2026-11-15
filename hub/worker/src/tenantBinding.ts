// El Worker pasa el id del inquilino EXPLÍCITAMENTE en cada llamada RPC al
// `TenantHub` (el DO no se fía de `ctx.id.name`). Aquí está la forma de esa
// RPC y el adaptador que la presenta como `TenantApi` ya ligada a un inquilino.

import type { TenantApi } from './router';

/** `TenantApi` con el inquilino como primer argumento de cada método. */
export type TenantRpc = {
  [K in keyof TenantApi]: (
    tenantId: string,
    ...args: Parameters<TenantApi[K]>
  ) => ReturnType<TenantApi[K]>;
};

export function bindTenant(rpc: TenantRpc, tenantId: string): TenantApi {
  return {
    status: (...a) => rpc.status(tenantId, ...a),
    push: (...a) => rpc.push(tenantId, ...a),
    pull: (...a) => rpc.pull(tenantId, ...a),
    claimJob: (...a) => rpc.claimJob(tenantId, ...a),
    doneJob: (...a) => rpc.doneJob(tenantId, ...a),
    storeIgdbCredentials: (...a) => rpc.storeIgdbCredentials(tenantId, ...a),
    enroll: (...a) => rpc.enroll(tenantId, ...a),
    createEnrollmentCode: (...a) => rpc.createEnrollmentCode(tenantId, ...a),
    listTokens: (...a) => rpc.listTokens(tenantId, ...a),
    revokeToken: (...a) => rpc.revokeToken(tenantId, ...a),
    web: (...a) => rpc.web(tenantId, ...a),
  };
}
