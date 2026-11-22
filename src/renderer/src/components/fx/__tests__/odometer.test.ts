// QUE BLINDA: que el odómetro (fx/Ticker, Odometer) solo anime los dígitos que
// cambian, alineando por la derecha: el cronómetro cambia de segundo en
// segundo y no puede hacer temblar las horas.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changedChars } from '../odometer';

describe('changedChars', () => {
  it('no anima nada en el primer pintado', () => {
    assert.deepEqual(changedChars(null, '01:02'), [false, false, false, false, false]);
  });

  it('marca solo el segundo que cambia', () => {
    assert.deepEqual(changedChars('00:00:09', '00:00:10'), [
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('alinea por la derecha cuando el texto crece', () => {
    assert.deepEqual(changedChars('9h', '10h'), [true, true, false]);
  });
});
