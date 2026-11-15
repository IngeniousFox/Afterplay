import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReadCache } from '../src/web/readCache';

// La caché por secuencia de las lecturas (§9.7), sin base de datos.

describe('ReadCache', () => {
  it('devuelve lo guardado con la misma secuencia y nada con otra', () => {
    const cache = new ReadCache();
    cache.set(1, 'a', { x: 1 });
    assert.deepEqual(cache.get(1, 'a'), { x: 1 });
    assert.equal(cache.get(1, 'b'), undefined);
    assert.equal(cache.get(2, 'a'), undefined);
    assert.equal(cache.size, 0, 'la secuencia nueva vacía todo');
    // Y la antigua tampoco vuelve.
    assert.equal(cache.get(1, 'a'), undefined);
  });

  it('con tope de entradas expulsa la menos reciente', () => {
    const cache = new ReadCache(2);
    cache.set(1, 'a', 1);
    cache.set(1, 'b', 2);
    assert.equal(cache.get(1, 'a'), 1); // `a` pasa a ser la más reciente
    cache.set(1, 'c', 3);
    assert.equal(cache.size, 2);
    assert.equal(cache.get(1, 'b'), undefined);
    assert.equal(cache.get(1, 'a'), 1);
    assert.equal(cache.get(1, 'c'), 3);
  });

  it('con tope de bytes expulsa hasta caber y no guarda lo que se comería media caché', () => {
    const cache = new ReadCache(100, 100);
    cache.set(1, 'a', 'x'.repeat(40));
    cache.set(1, 'b', 'x'.repeat(40));
    cache.set(1, 'c', 'x'.repeat(40));
    assert.equal(cache.get(1, 'a'), undefined, 'la más antigua se fue para que cupieran');
    assert.equal(cache.size, 2);
    cache.set(1, 'enorme', 'x'.repeat(60));
    assert.equal(cache.get(1, 'enorme'), undefined);
    assert.equal(cache.size, 2, 'lo enorme no echa a nadie');
  });

  it('reescribir una clave no duplica su peso', () => {
    const cache = new ReadCache(100, 100);
    for (let i = 0; i < 10; i++) cache.set(1, 'a', 'x'.repeat(40));
    cache.set(1, 'b', 'x'.repeat(40));
    assert.equal(cache.size, 2);
  });
});
