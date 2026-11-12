import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  isLocalCopyFresh,
  markRemotePullSucceeded,
  REMOTE_FRESH_MS,
  resetRemoteFreshness,
  setRemoteExpected,
} from '../remoteFreshness';

// La puerta que decide si el watcher puede fiarse de la copia local para
// cerrar un cronómetro del móvil. Si se abre de más, un PC que vuelve de
// suspensión pisa en Turso las horas de una sesión bien parada.
const NOW = Date.UTC(2026, 10, 12, 10, 0, 0);

describe('isLocalCopyFresh', () => {
  beforeEach(() => resetRemoteFreshness());

  it('sin Turso configurado la copia local es la unica: siempre vale', () => {
    assert.equal(isLocalCopyFresh(NOW), true);
  });

  it('con Turso configurado no vale hasta el primer pull', () => {
    setRemoteExpected(true);
    assert.equal(isLocalCopyFresh(NOW), false);
    markRemotePullSucceeded(NOW - 1000);
    assert.equal(isLocalCopyFresh(NOW), true);
  });

  it('caduca: un pull anterior a la ventana ya no cuenta', () => {
    setRemoteExpected(true);
    markRemotePullSucceeded(NOW - REMOTE_FRESH_MS);
    assert.equal(isLocalCopyFresh(NOW), true, 'el borde entra');
    markRemotePullSucceeded(NOW - REMOTE_FRESH_MS - 1);
    assert.equal(isLocalCopyFresh(NOW), false);
  });

  it('un reloj que salta hacia atras no da por buena la copia', () => {
    setRemoteExpected(true);
    markRemotePullSucceeded(NOW + 60_000);
    assert.equal(isLocalCopyFresh(NOW), false);
  });
});
