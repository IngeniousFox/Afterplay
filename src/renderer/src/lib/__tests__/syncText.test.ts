import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeAgo } from '../syncText';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

describe('describeAgo', () => {
  it('nunca, ahora, minutos, horas y días', () => {
    assert.equal(describeAgo(null, NOW), 'never');
    assert.equal(describeAgo(NOW - 5_000, NOW), 'just now');
    assert.equal(describeAgo(NOW - 5 * MIN, NOW), '5 min ago');
    assert.equal(describeAgo(NOW - 3 * 60 * MIN, NOW), '3 h ago');
    assert.equal(describeAgo(NOW - 30 * 60 * MIN, NOW), 'yesterday');
    assert.equal(describeAgo(NOW - 72 * 60 * MIN, NOW), '3 days ago');
  });

  it('una hora en el futuro (reloj raro) cuenta como ahora', () => {
    assert.equal(describeAgo(NOW + 10 * MIN, NOW), 'just now');
  });
});
