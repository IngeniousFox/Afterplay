import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMajorUpgrade } from '../updateGate';

// El freno del actualizador (puente 1.8, D-07): solo una versión MAYOR nueva se
// frena; minor y patch siguen descargándose solos como siempre.

describe('isMajorUpgrade', () => {
  it('1.x -> 2.0 es mayor', () => {
    assert.equal(isMajorUpgrade('1.8.0', '2.0.0'), true);
    assert.equal(isMajorUpgrade('1.7.3', '2.0.0-beta.1'), true);
    assert.equal(isMajorUpgrade('1.7.3', 'v2.1.4'), true);
  });

  it('minor y patch no se frenan', () => {
    assert.equal(isMajorUpgrade('1.7.3', '1.8.0'), false);
    assert.equal(isMajorUpgrade('1.7.3', '1.7.4'), false);
    assert.equal(isMajorUpgrade('1.9.9', '1.10.0'), false);
  });

  it('una versión igual o más vieja no es una subida mayor', () => {
    assert.equal(isMajorUpgrade('2.0.0', '2.0.0'), false);
    assert.equal(isMajorUpgrade('2.0.0', '1.8.0'), false);
  });

  it('no frena lo que no entiende (sigue el comportamiento de siempre)', () => {
    assert.equal(isMajorUpgrade('1.8.0', 'latest'), false);
    assert.equal(isMajorUpgrade('dev', '2.0.0'), false);
    assert.equal(isMajorUpgrade('', ''), false);
  });
});
