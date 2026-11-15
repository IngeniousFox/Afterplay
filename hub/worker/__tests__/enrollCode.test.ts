import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatEnrollCode, splitEnrollCode } from '../src/enrollCode';

describe('código de emparejado', () => {
  it('ida y vuelta', () => {
    const shown = formatEnrollCode('7k2m9p', 'K7M2P-9XQ4T');
    assert.equal(shown, '7k2m9p-K7M2P-9XQ4T');
    assert.deepEqual(splitEnrollCode(shown), { tenantId: '7k2m9p', code: 'K7M2P9XQ4T' });
  });

  it('tolera mayúsculas, espacios, guiones y las confusiones O/I/L', () => {
    assert.deepEqual(splitEnrollCode(' 7K2M9P k7m2p 9xq4t '), {
      tenantId: '7k2m9p',
      code: 'K7M2P9XQ4T',
    });
    assert.deepEqual(splitEnrollCode('OIL2M9-KOIL0-9XQ4T'), {
      tenantId: '0112m9',
      code: 'K01109XQ4T',
    });
  });

  it('rechaza lo que no tiene la forma', () => {
    for (const bad of [
      '',
      'abc',
      '7k2m9p-K7M2P',
      '7k2m9p-K7M2P-9XQ4TT',
      '7k2m9u-K7M2P-9XQ4T',
      42,
      null,
    ]) {
      assert.equal(splitEnrollCode(bad), null, String(bad));
    }
    assert.equal(splitEnrollCode('a'.repeat(1000)), null);
  });
});
