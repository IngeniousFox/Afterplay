import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isClock, LEGACY_DEVICE_SHORT_ID, parseClock } from '../../../../../shared/sync/clock';
import { isUuid, uuidv7 } from '../../../../../shared/sync/ids';
import { assignLegacyClocks, legacyClockAt, nextLegacyClock } from '../legacyClocks';
import {
  isLegacyUuid,
  LEGACY_ID_EPOCH_MS,
  legacyUuid,
  MAX_LEGACY_ID,
  uuidTimestampMs,
} from '../legacyIds';

describe('ids deterministas de lo importado (UUIDv7, desviación de §19.5)', () => {
  it('mismo origen, mismo id; y es un UUIDv7 válido en minúsculas', () => {
    const a = legacyUuid('sessions', 42);
    assert.equal(a, legacyUuid('sessions', 42));
    assert.ok(isUuid(a) && a === a.toLowerCase());
    assert.equal(a[14], '7', 'versión 7');
    assert.ok('89ab'.includes(a[19]), 'variante RFC');
    assert.equal(uuidTimestampMs(a), LEGACY_ID_EPOCH_MS + 42);
    assert.ok(isLegacyUuid(a));
  });

  it('dentro de una tabla, el orden de los ids es el de los ids antiguos', () => {
    const ids = [1, 2, 9, 10, 11, 99, 100, 1000, 12345, 2 ** 31].map((n) =>
      legacyUuid('iterations', n),
    );
    assert.deepEqual([...ids].sort(), ids);
  });

  it('tablas distintas con el mismo id antiguo no chocan', () => {
    assert.notEqual(legacyUuid('sessions', 7), legacyUuid('state_events', 7));
  });

  it('todo id importado ordena antes que cualquier UUIDv7 real', () => {
    const real = uuidv7(Date.UTC(2020, 0, 1));
    assert.ok(legacyUuid('games', MAX_LEGACY_ID) < real);
    assert.ok(!isLegacyUuid(uuidv7()));
  });

  it('rechaza ids antiguos fuera de rango', () => {
    for (const bad of [0, -1, 1.5, MAX_LEGACY_ID + 1, Number.NaN]) {
      assert.throws(() => legacyUuid('games', bad), RangeError);
    }
  });
});

describe('relojes de lo importado (§19.5 "Relojes")', () => {
  it('crecen en el orden (fecha, id) y llevan el id corto legacy', () => {
    const { clocks } = assignLegacyClocks(
      [
        { domainMs: 2000, key: 3 },
        { domainMs: 1000, key: 9 },
        { domainMs: 2000, key: 1 },
        { domainMs: null, key: 5 },
      ],
      10_000,
    );
    const order = [...clocks.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1)).map(([k]) => k);
    assert.deepEqual(order, [5, 9, 1, 3]);
    for (const clock of clocks.values()) {
      assert.ok(isClock(clock));
      assert.equal(parseClock(clock).dev, LEGACY_DEVICE_SHORT_ID);
    }
    // Misma fecha: el segundo es el siguiente al primero.
    assert.equal(clocks.get(3), nextLegacyClock(clocks.get(1) as string));
  });

  it('recorta al techo las fechas futuras y lo cuenta', () => {
    const { clocks, clamped } = assignLegacyClocks([{ domainMs: 50_000, key: 1 }], 10_000);
    assert.equal(clamped, 1);
    assert.equal(parseClock(clocks.get(1) as string).ms, 10_000);
    assert.equal(parseClock(legacyClockAt(-5, 10)).ms, 1, 'nunca el milisegundo de BOTTOM');
  });

  it('el contador agotado pasa al milisegundo siguiente', () => {
    const next = nextLegacyClock(`0000000001000-9999-${LEGACY_DEVICE_SHORT_ID}`);
    assert.equal(next, `0000000001001-0000-${LEGACY_DEVICE_SHORT_ID}`);
  });
});
