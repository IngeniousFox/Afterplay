// Andamio de los tests del Worker: un "mundo" en memoria con el Directory real
// y un TenantService real por inquilino (sobre SQLite de Node), sin
// Cloudflare. Es el mismo código que corre en los Durable Objects; solo cambia
// el almacenamiento.

import { PROTOCOL_VERSION, SYNC_ROUTES } from '../../../src/shared/sync/protocol';
import { APP_SCHEMA_VERSION } from '../../../src/main/db/v2/schemaVersion';
import { NodeSqlStorage } from '../../core/node/nodeStorage';
import { AccessError } from '../src/access';
import { DirectoryStore } from '../src/directoryStore';
import { handleRequest, type Backend, type DirectoryApi, type TenantApi } from '../src/router';
import { TenantService, type TenantServiceExtras } from '../src/tenantService';
import { drizzle } from 'drizzle-orm/node-sqlite';
import type { LocalDb } from '../../../src/main/db/v2/store';

export const HOST = 'host@example.com';
export const BASE = 'https://hub.test';
export const T0 = Date.UTC(2026, 0, 1);
export const VERSION = { protocolVersion: PROTOCOL_VERSION, schemaVersion: APP_SCHEMA_VERSION };

export function makeWorld(
  adminEmail: string | null = HOST,
  extras: TenantServiceExtras = {},
): World {
  const time = { now: T0 };
  const directoryStore = new DirectoryStore(new NodeSqlStorage(), () => time.now);
  const services = new Map<string, TenantService>();
  /** Inquilinos cuyo "Durable Object" se ha llegado a crear. */
  const touched: string[] = [];
  const backend: Backend = {
    tenant(tenantId) {
      let service = services.get(tenantId);
      if (!service) {
        touched.push(tenantId);
        // Las consultas del móvil, como en el DO pero con Drizzle sobre node:sqlite.
        const storage = new NodeSqlStorage();
        const queryDb = (): LocalDb => drizzle({ client: storage.db }) as unknown as LocalDb;
        service = new TenantService(storage, () => time.now, { tenantId }, queryDb, extras);
        services.set(tenantId, service);
      }
      return service as unknown as TenantApi;
    },
    directory: {
      resolve: async (email, admin) => directoryStore.resolve(email, admin),
      invite: async (email, by) => directoryStore.invite(email, by),
      tenantIds: async () => directoryStore.tenantIds(),
    } satisfies DirectoryApi,
    tenantExists: async (id) => directoryStore.tenantExists(id),
    authenticateAccess: async (request) => {
      const email = request.headers.get('x-test-email');
      if (!email) throw new AccessError('sin sesión');
      return { email };
    },
    adminEmail: adminEmail ?? undefined,
  };
  const call = (path: string, init: CallInit = {}): Promise<Response> =>
    handleRequest(makeRequest(path, init), backend);
  return { time, directoryStore, services, touched, backend, call };
}

export interface CallInit {
  method?: string;
  email?: string;
  token?: string;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
}

export function makeRequest(path: string, init: CallInit = {}): Request {
  const headers: Record<string, string> = { ...init.headers };
  if (init.email) headers['x-test-email'] = init.email;
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  const method = init.method ?? (body === undefined ? 'GET' : 'POST');
  // `duplex` es obligatorio en Node para cuerpos en flujo.
  return new Request(`${BASE}${path}`, { method, headers, body, duplex: 'half' } as RequestInit);
}

export const statusPath = `${SYNC_ROUTES.status}?protocolVersion=${VERSION.protocolVersion}&schemaVersion=${VERSION.schemaVersion}`;

/** El anfitrión entra, pide un código y un PC lo canjea: devuelve el token. */
export async function pairDevice(
  world: World,
  email = HOST,
  deviceId = 'pc-1',
): Promise<{ token: string; tenantId: string; code: string }> {
  const codeResponse = await world.call('/api/v2/devices/enroll-code', {
    method: 'POST',
    email,
  });
  const { code } = (await codeResponse.json()) as { code: string };
  const enrolled = await world.call(SYNC_ROUTES.enroll, {
    body: { ...VERSION, code, deviceId, deviceName: 'Sobremesa' },
  });
  const body = (await enrolled.json()) as { token: string; tenantId: string };
  return { token: body.token, tenantId: body.tenantId, code };
}

export interface World {
  time: { now: number };
  directoryStore: DirectoryStore;
  services: Map<string, TenantService>;
  touched: string[];
  backend: Backend;
  call: (path: string, init?: CallInit) => Promise<Response>;
}
