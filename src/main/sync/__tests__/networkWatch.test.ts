import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { watchNetworkBack } from '../networkWatch';
import type { SchedulerTimers } from '../scheduler';

// "La red ha vuelto" (§8.5): solo el paso de sin-red a con-red avisa.

class ManualTimers implements SchedulerTimers {
  private callbacks = new Map<number, () => void>();
  private next = 1;
  setTimeout(callback: () => void): unknown {
    const id = this.next++;
    this.callbacks.set(id, callback);
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }
  /** Dispara los temporizadores pendientes (cada uno vuelve a armarse solo). */
  tick(): void {
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback();
  }
  get pending(): number {
    return this.callbacks.size;
  }
}

describe('watchNetworkBack', () => {
  it('avisa al volver la red, no mientras está caída ni mientras está bien', () => {
    const timers = new ManualTimers();
    let online = true;
    let backs = 0;
    watchNetworkBack({ isOnline: () => online, onBack: () => backs++, timers });

    timers.tick();
    assert.equal(backs, 0, 'con red todo el rato no hay nada que avisar');

    online = false;
    timers.tick();
    timers.tick();
    assert.equal(backs, 0, 'sin red tampoco');

    online = true;
    timers.tick();
    assert.equal(backs, 1);
    timers.tick();
    assert.equal(backs, 1, 'solo una vez por vuelta');
  });

  it('arrancar sin red y recuperarla también avisa', () => {
    const timers = new ManualTimers();
    let online = false;
    let backs = 0;
    watchNetworkBack({ isOnline: () => online, onBack: () => backs++, timers });

    online = true;
    timers.tick();

    assert.equal(backs, 1);
  });

  it('stop deja de preguntar', () => {
    const timers = new ManualTimers();
    let online = false;
    let backs = 0;
    const watch = watchNetworkBack({ isOnline: () => online, onBack: () => backs++, timers });

    watch.stop();
    online = true;
    timers.tick();

    assert.equal(backs, 0);
    assert.equal(timers.pending, 0);
  });
});
