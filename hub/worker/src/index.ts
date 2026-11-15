// Worker `afterplay-hub` (§9.1): punto de entrada. Construye el `Backend` real
// (Durable Objects + Access) y delega en `router.ts`, que es lo que se prueba.
// Desplegado solo como hub de desarrollo (`--env dev`, ver wrangler.jsonc).

import { authenticate } from './access';
import { authenticateAdminToken } from './adminToken';
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
  // Secret opcional: segunda puerta de /api/v2 para el anfitrión (adminToken.ts).
  HUB_ADMIN_TOKEN?: string;
  // Secret del hub (`wrangler secret put HUB_SECRETS_KEY`): cifra las claves de IGDB que
  // sube cada PC (F-29). Lo lee el Durable Object. Sin él, esa ruta responde un error claro.
  HUB_SECRETS_KEY?: string;
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
    authenticateAccess: async (request) =>
      (await authenticateAdminToken(request, env)) ?? authenticate(request, env, Date.now()),
    adminEmail: env.ADMIN_EMAIL,
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, buildBackend(env));
  },
} satisfies ExportedHandler<Env>;
