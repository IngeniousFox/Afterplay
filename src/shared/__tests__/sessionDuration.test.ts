import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSessionDuration, splitSessionDuration } from '../sessionDuration';

// La regla que antes estaba copiada a mano en main/index.ts, en el toast de
// escritorio y en el panel del modo TV. Estos casos son el contrato que las
// tres cumplian por costumbre: si alguien cambia el redondeo, aqui salta.
describe('splitSessionDuration', () => {
  it('parte horas y minutos con la unidad aparte', () => {
    assert.deepEqual(splitSessionDuration(6420), { value: '1h 47', unit: 'm' });
    assert.deepEqual(splitSessionDuration(3600), { value: '1h 0', unit: 'm' });
    assert.deepEqual(splitSessionDuration(1500), { value: '25', unit: 'm' });
  });

  it('nunca baja de un minuto: una sesion corta existio igual', () => {
    assert.deepEqual(splitSessionDuration(0), { value: '1', unit: 'm' });
    assert.deepEqual(splitSessionDuration(40), { value: '1', unit: 'm' });
  });

  it('redondea al minuto mas cercano, no trunca', () => {
    // 89 s son 1,48 min -> 1m; 91 s son 1,52 -> 2m.
    assert.equal(splitSessionDuration(89).value, '1');
    assert.equal(splitSessionDuration(91).value, '2');
    // 59 min y 40 s redondean a 60 -> una hora justa, no "0h 60".
    assert.deepEqual(splitSessionDuration(3580), { value: '1h 0', unit: 'm' });
  });
});

describe('formatSessionDuration', () => {
  it('es exactamente la version partida pegada', () => {
    for (const seconds of [0, 40, 1500, 3580, 3600, 6420, 86_400]) {
      const { value, unit } = splitSessionDuration(seconds);
      assert.equal(formatSessionDuration(seconds), `${value}${unit}`);
    }
  });

  it('da el texto que pintaban las tres copias', () => {
    assert.equal(formatSessionDuration(6420), '1h 47m');
    assert.equal(formatSessionDuration(1500), '25m');
    assert.equal(formatSessionDuration(0), '1m');
  });
});
