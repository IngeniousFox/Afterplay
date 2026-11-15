// Worker `afterplay-hub` (§9.1): punto de entrada. Construye el `Backend` real
// (Durable Objects + Access) y delega en `router.ts`, que es lo que se prueba.
// NO está desplegado (ver wrangler.jsonc).

import { authenticate } from './access';
import { DIRECTORY_OBJECT_NAME } from './do/directory';
import { handleRequest, type Backend, type DirectoryApi } from './router';
import { bindTenant, type TenantRpc } from './tenantBinding';
import type { TenantHubObject } from './do/tenantHub';
import type { DirectoryObject } from './do/directory';

export { TenantHubObject } from './do/tenantHub';
export { DirectoryObject } from './do/directory';

export interface Env {
  TENANT_HUB: DurableObjectNamespace<TenantHubObject>;
  DIRECTORY: DurableObjectNamespace<DirectoryObject>;
  ADMIN_EMAIL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // Solo desarrollo (.dev.vars).
  ENVIRONMENT?: string;
  DEV_EMAIL?: string;
}

// Caché de inquilinos que ya se sabe que existen. Es estado de módulo A
// PROPÓSITO y no es el problema que la 1.x prohibía (§5.2 regla 1): no guarda
// datos de nadie, solo "este id existe", que no cambia nunca (los inquilinos no
// se borran). Sirve para no preguntar al Directory (una petición a un DO, que
// cuenta para el cupo, §9.7) en cada ciclo de sondeo de cada PC. Los ids que
// NO existen no se cachean: un atacante no puede llenarla.
const KNOWN_TENANTS = new Set<string>();
const KNOWN_TENANTS_MAX = 1000;

function buildBackend(env: Env): Backend {
  const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(DIRECTORY_OBJECT_NAME));
  return {
    tenant: (tenantId) =>
      bindTenant(
        env.TENANT_HUB.get(env.TENANT_HUB.idFromName(tenantId)) as unknown as TenantRpc,
        tenantId,
      ),
    directory: directory as unknown as DirectoryApi,
    async tenantExists(tenantId) {
      if (KNOWN_TENANTS.has(tenantId)) return true;
      const exists = await directory.tenantExists(tenantId);
      if (exists && KNOWN_TENANTS.size < KNOWN_TENANTS_MAX) KNOWN_TENANTS.add(tenantId);
      return exists;
    },
    authenticateAccess: (request) => authenticate(request, env, Date.now()),
    adminEmail: env.ADMIN_EMAIL,
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, buildBackend(env));
  },
} satisfies ExportedHandler<Env>;
