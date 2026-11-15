import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describePairError, describeSyncProblem } from '../status';

// Las frases que ve el usuario cuando el sync no va: tienen que decir QUÉ hacer.

describe('describeSyncProblem', () => {
  it('sin fallo guardado no hay problema', () => {
    assert.equal(describeSyncProblem(null, null), null);
  });

  it('reloj adelantado: dice que se arregla corrigiendo la hora', () => {
    const problem = describeSyncProblem('clock_ahead', 'el reloj de este PC está adelantado');
    assert.match(problem?.message ?? '', /clock is ahead/);
    assert.equal(problem?.retrying, true);
  });

  it('esquema o protocolo viejos: pide actualizar y no reintenta', () => {
    for (const code of ['schema_too_old', 'protocol_mismatch']) {
      const problem = describeSyncProblem(code, 'x');
      assert.equal(problem?.message, 'Update Afterplay to keep syncing.');
      assert.equal(problem?.retrying, false);
    }
  });

  it('no autorizado: pide volver a emparejar', () => {
    const problem = describeSyncProblem('unauthorized', 'token revocado');
    assert.match(problem?.message ?? '', /no longer authorized/);
    assert.match(problem?.message ?? '', /pair it again/);
    assert.equal(problem?.retrying, false);
  });

  it('red, cupo y hub atrasado se reintentan solos', () => {
    for (const code of ['network', 'quota_exceeded', 'hub_behind']) {
      assert.equal(describeSyncProblem(code, 'x')?.retrying, true, code);
    }
  });

  it('un fallo desconocido enseña el mensaje del motor', () => {
    const problem = describeSyncProblem('internal', 'boom');
    assert.match(problem?.message ?? '', /boom/);
    assert.equal(problem?.retrying, true);
  });
});

describe('describePairError', () => {
  it('traduce los códigos del protocolo', () => {
    assert.match(describePairError('enroll_code_invalid', 'x'), /not valid or has expired/);
    assert.match(describePairError('network', 'x'), /reach the hub/);
    assert.match(describePairError('schema_too_old', 'x'), /too old/);
  });

  it('lo desconocido pasa tal cual', () => {
    assert.equal(describePairError(null, 'mensaje crudo'), 'mensaje crudo');
  });
});
