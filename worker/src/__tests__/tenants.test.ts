// QUE BLINDA: la regla 2 del §5.2, FALLAR CERRADO — resolveTenant SIEMPRE
// devuelve null (nunca el inquilino del dueno "por si acaso") ante un
// TENANTS con JSON roto, una entrada sin url/authToken, o un email que no
// esta en el mapa. Tambien el fallback de desarrollo, que exige DEV_EMAIL
// exacto incluso en local, y que el email se compara sin importar mayusculas.
//
// QUE ES REAL Y QUE ES DOBLE: resolveTenant es pura sobre un objeto Env
// literal — nada que doblar, ni red ni base de datos de por medio.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Env } from '../env';
import { resolveTenant } from '../tenants';

const baseEnv = (overrides: Partial<Env> = {}): Env => ({ ...overrides });

describe('resolveTenant', () => {
  it('TENANTS con JSON roto no reconoce a NADIE (falla cerrado, no abre a todos)', () => {
    const env = baseEnv({ TENANTS: '{esto no es json' });
    assert.equal(resolveTenant(env, 'alguien@x.com'), null);
  });

  it('una entrada sin url, sin authToken, o con cualquiera de los dos vacio, no cuenta', () => {
    const env = baseEnv({
      TENANTS: JSON.stringify({
        'sin-url@x.com': { authToken: 'tok' },
        'sin-token@x.com': { url: 'libsql://x' },
        'vacios@x.com': { url: '', authToken: '' },
      }),
    });
    assert.equal(resolveTenant(env, 'sin-url@x.com'), null);
    assert.equal(resolveTenant(env, 'sin-token@x.com'), null);
    assert.equal(resolveTenant(env, 'vacios@x.com'), null);
  });

  it('un email que no esta en el mapa nunca cae al inquilino del dueno', () => {
    const env = baseEnv({
      TENANTS: JSON.stringify({ 'dueno@x.com': { url: 'libsql://x', authToken: 'tok' } }),
    });
    assert.equal(resolveTenant(env, 'random@otro.com'), null);
  });

  it('reconoce el email SIN importar mayusculas', () => {
    const env = baseEnv({
      TENANTS: JSON.stringify({ 'dueno@x.com': { url: 'libsql://x', authToken: 'tok' } }),
    });
    assert.deepEqual(resolveTenant(env, 'DUENO@X.com'), {
      url: 'libsql://x',
      authToken: 'tok',
      igdb: null,
    });
  });

  it('igdb queda null si falta el clientId o el clientSecret, aunque el otro este', () => {
    const env = baseEnv({
      TENANTS: JSON.stringify({
        'a@x.com': { url: 'libsql://x', authToken: 'tok', twitchClientId: 'cid' },
      }),
    });
    assert.equal(resolveTenant(env, 'a@x.com')?.igdb, null);
  });

  it('con las dos claves de twitch presentes, igdb viaja completo', () => {
    const env = baseEnv({
      TENANTS: JSON.stringify({
        'a@x.com': {
          url: 'libsql://x',
          authToken: 'tok',
          twitchClientId: 'cid',
          twitchClientSecret: 'secret',
        },
      }),
    });
    assert.deepEqual(resolveTenant(env, 'a@x.com')?.igdb, {
      clientId: 'cid',
      clientSecret: 'secret',
    });
  });

  it('en desarrollo exige que el email COINCIDA con DEV_EMAIL: ni en local vale cualquiera', () => {
    const env = baseEnv({
      ENVIRONMENT: 'development',
      DEV_EMAIL: 'yo@x.com',
      TURSO_DATABASE_URL: 'libsql://dev',
      TURSO_AUTH_TOKEN: 'dev-tok',
    });
    assert.equal(resolveTenant(env, 'otro@x.com'), null);
    assert.deepEqual(resolveTenant(env, 'yo@x.com'), {
      url: 'libsql://dev',
      authToken: 'dev-tok',
      igdb: null,
    });
  });

  it('sin TENANTS y fuera de desarrollo, no hay ningun inquilino que devolver', () => {
    assert.equal(resolveTenant(baseEnv(), 'nadie@x.com'), null);
  });
});
