import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkHubUrl, isLoopbackHost } from '../hubUrl';

// La dirección del hub: por ella viaja el token del dispositivo, así que solo
// https, salvo un hub de desarrollo en esta misma máquina.

describe('checkHubUrl', () => {
  it('acepta https y la normaliza (sin barra final, sin parámetros)', () => {
    const check = checkHubUrl('  https://Hub.Ejemplo.dev/  ');
    assert.deepEqual(check, {
      ok: true,
      url: 'https://hub.ejemplo.dev',
      host: 'hub.ejemplo.dev',
      local: false,
    });
    const withPath = checkHubUrl('https://ejemplo.dev/api/?x=1#y');
    assert.equal(withPath.ok && withPath.url, 'https://ejemplo.dev/api');
  });

  it('acepta http solo en localhost, 127.0.0.1 y [::1]', () => {
    for (const url of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
      const check = checkHubUrl(url);
      assert.equal(check.ok, true, url);
      assert.equal(check.ok && check.local, true, url);
    }
  });

  it('rechaza http en cualquier otro sitio', () => {
    for (const url of [
      'http://hub.ejemplo.dev',
      'http://localhost.ejemplo.dev',
      'http://127.0.0.1.ejemplo.dev',
      'http://192.168.1.20',
    ]) {
      const check = checkHubUrl(url);
      assert.equal(check.ok, false, url);
      if (!check.ok) assert.match(check.message, /https/);
    }
  });

  it('rechaza lo que no es una dirección o no es http(s)', () => {
    for (const url of [
      '',
      '   ',
      'hub.ejemplo.dev',
      'no es una url',
      'ftp://hub.ejemplo.dev',
      'javascript:alert(1)',
    ]) {
      assert.equal(checkHubUrl(url).ok, false, JSON.stringify(url));
    }
  });

  it('rechaza usuario y contraseña dentro de la dirección', () => {
    const check = checkHubUrl('https://usuario:clave@hub.ejemplo.dev');
    assert.equal(check.ok, false);
  });

  it('https en localhost también vale', () => {
    assert.equal(checkHubUrl('https://localhost:8443').ok, true);
  });
});

describe('isLoopbackHost', () => {
  it('reconoce solo la propia máquina', () => {
    assert.equal(isLoopbackHost('localhost'), true);
    assert.equal(isLoopbackHost('LOCALHOST'), true);
    assert.equal(isLoopbackHost('127.0.0.1'), true);
    assert.equal(isLoopbackHost('[::1]'), true);
    assert.equal(isLoopbackHost('127.0.0.2'), false);
    assert.equal(isLoopbackHost('mi-localhost.dev'), false);
  });
});
