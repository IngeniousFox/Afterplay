import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchRoute } from '../src/web/routes';
import type { WebRoute } from '../src/web/types';
import { HOST, makeWorld } from './helpers';

// El reparto de la API de la PWA dentro del Durable Object (web/routes.ts).

const noop = (): { ok: true; value: null } => ({ ok: true, value: null });
const ROUTES: WebRoute[] = [
  { method: 'GET', pattern: '/games/:id', handler: noop },
  { method: 'GET', pattern: '/games/:id/achievements', handler: noop },
  { method: 'POST', pattern: '/timer/start', handler: noop },
];

describe('matchRoute', () => {
  it('casa segmentos fijos y parámetros, decodificados', () => {
    const match = matchRoute(ROUTES, 'GET', '/games/a%20b/achievements');
    assert.equal(match.kind, 'found');
    assert.deepEqual(match.kind === 'found' ? match.params : null, { id: 'a b' });
  });

  it('distingue ruta desconocida de método no permitido', () => {
    assert.equal(matchRoute(ROUTES, 'GET', '/nada').kind, 'none');
    assert.deepEqual(matchRoute(ROUTES, 'GET', '/timer/start'), {
      kind: 'method',
      allow: ['POST'],
    });
  });

  it('un parámetro vacío o mal codificado no casa', () => {
    assert.equal(matchRoute(ROUTES, 'GET', '/games/').kind, 'none');
    assert.equal(matchRoute(ROUTES, 'GET', '/games/%E0%A4%A').kind, 'none');
  });
});

describe('/api/v2 hacia el Durable Object', () => {
  it('una ruta que no existe da 404 con el código del protocolo', async () => {
    const world = makeWorld();
    const response = await world.call('/api/v2/no-existe', { email: HOST });
    assert.equal(response.status, 404);
    assert.equal(((await response.json()) as { error: string }).error, 'not_found');
  });

  it('un POST con JSON roto es invalid_request', async () => {
    const world = makeWorld();
    const response = await world.call('/api/v2/timer/start', {
      method: 'POST',
      email: HOST,
      rawBody: '{roto',
    });
    assert.equal(response.status, 400);
  });
});
