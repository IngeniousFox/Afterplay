import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SecretBoxError, openSecret, sealSecret } from '../secretBox';

// Valores inventados: nada de claves reales.
const KEY = 'una-clave-maestra-de-prueba-0123456789';
const OTHER_KEY = 'otra-clave-maestra-de-prueba-9876543210';

describe('secretBox', () => {
  it('cifra y descifra', async () => {
    const envelope = await sealSecret(KEY, 'igdb', 'tenant-a', 'hola secreto');
    assert.equal(await openSecret(KEY, 'igdb', 'tenant-a', envelope), 'hola secreto');
  });

  it('el sobre no contiene el texto en claro y tiene el formato v1.iv.cifrado', async () => {
    const envelope = await sealSecret(KEY, 'igdb', 'tenant-a', 'texto-muy-reconocible');
    assert.ok(!envelope.includes('texto-muy-reconocible'));
    assert.match(envelope, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  });

  it('el mismo texto da sobres distintos (iv nuevo)', async () => {
    const a = await sealSecret(KEY, 'igdb', 'tenant-a', 'igual');
    const b = await sealSecret(KEY, 'igdb', 'tenant-a', 'igual');
    assert.notEqual(a, b);
  });

  it('no abre con otra clave, otro inquilino u otra finalidad', async () => {
    const envelope = await sealSecret(KEY, 'igdb', 'tenant-a', 'x');
    await assert.rejects(openSecret(OTHER_KEY, 'igdb', 'tenant-a', envelope), SecretBoxError);
    await assert.rejects(openSecret(KEY, 'igdb', 'tenant-b', envelope), SecretBoxError);
    await assert.rejects(openSecret(KEY, 'otra', 'tenant-a', envelope), SecretBoxError);
  });

  it('detecta un sobre alterado o roto', async () => {
    const envelope = await sealSecret(KEY, 'igdb', 'tenant-a', 'x');
    const parts = envelope.split('.');
    const tail = parts[2].endsWith('AA') ? 'BB' : 'AA';
    const flipped = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}${tail}`;
    await assert.rejects(openSecret(KEY, 'igdb', 'tenant-a', flipped), SecretBoxError);
    await assert.rejects(openSecret(KEY, 'igdb', 'tenant-a', 'basura'), SecretBoxError);
    await assert.rejects(openSecret(KEY, 'igdb', 'tenant-a', 'v2.AAAA.AAAA'), SecretBoxError);
  });

  it('rechaza una clave maestra corta', async () => {
    await assert.rejects(sealSecret('corta', 'igdb', 't', 'x'), SecretBoxError);
  });
});
