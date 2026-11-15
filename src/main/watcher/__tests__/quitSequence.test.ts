import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runQuitSequence, type QuitSteps } from '../quitSequence';

// El cierre ordenado (§10.6) con pasos de mentira: lo que se prueba es el
// ORDEN (sesiones, backups, subida) y los TOPES (cada paso lento deja salir).
// Los topes van en milisegundos reales pero diminutos.

const never = (): Promise<void> => new Promise(() => {});
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = { warn: (): void => {} };

describe('cierre ordenado', () => {
  it('corre los pasos en orden: sesiones, backups, subida final', async () => {
    const events: string[] = [];
    const steps: QuitSteps = {
      closeSessions: () => {
        events.push('sesiones');
      },
      flushSaveBackups: async (timeoutMs) => {
        await sleep(5);
        events.push(`backups:${timeoutMs}`);
      },
      flushSync: async () => {
        await sleep(5);
        events.push('subida');
      },
    };

    const outcome = await runQuitSequence(steps, { ...quiet, saveBackupsTimeoutMs: 1234 });

    assert.equal(outcome, 'done');
    // La subida va DESPUÉS de los backups: no se adelanta aunque tarde menos.
    assert.deepEqual(events, ['sesiones', 'backups:1234', 'subida']);
  });

  it('sin paso de backups (hoy) salta de las sesiones a la subida', async () => {
    const events: string[] = [];

    const outcome = await runQuitSequence(
      {
        closeSessions: () => {
          events.push('sesiones');
        },
        flushSync: async () => {
          events.push('subida');
        },
      },
      quiet,
    );

    assert.equal(outcome, 'done');
    assert.deepEqual(events, ['sesiones', 'subida']);
  });

  it('un backup colgado se corta en su tope y la subida final corre igual', async () => {
    const events: string[] = [];
    const warnings: string[] = [];

    const startedAt = Date.now();
    const outcome = await runQuitSequence(
      {
        closeSessions: () => {
          events.push('sesiones');
        },
        flushSaveBackups: never,
        flushSync: async () => {
          events.push('subida');
        },
      },
      { warn: (message) => warnings.push(message), saveBackupsTimeoutMs: 30, totalTimeoutMs: 2000 },
    );

    assert.equal(outcome, 'done');
    assert.deepEqual(events, ['sesiones', 'subida']);
    assert.ok(Date.now() - startedAt < 1500, 'no esperó al tope global');
    assert.ok(warnings.some((message) => message.includes('backups')));
  });

  it('un paso que lanza no impide los siguientes', async () => {
    const events: string[] = [];
    const warnings: string[] = [];

    const outcome = await runQuitSequence(
      {
        closeSessions: () => {
          throw new Error('base no disponible');
        },
        flushSaveBackups: () => Promise.reject(new Error('sin nube')),
        flushSync: async () => {
          events.push('subida');
        },
      },
      { warn: (message) => warnings.push(message) },
    );

    assert.equal(outcome, 'done');
    assert.deepEqual(events, ['subida']);
    assert.equal(warnings.length, 2);
  });

  it('el tope global deja salir aunque la subida final no termine nunca', async () => {
    const events: string[] = [];

    const outcome = await runQuitSequence(
      {
        closeSessions: () => {
          events.push('sesiones');
        },
        flushSync: never,
      },
      { ...quiet, totalTimeoutMs: 30 },
    );

    assert.equal(outcome, 'timeout');
    assert.deepEqual(events, ['sesiones']);
  });

  it('no rechaza nunca, ni con todos los pasos rotos', async () => {
    await assert.doesNotReject(
      runQuitSequence(
        {
          closeSessions: () => Promise.reject(new Error('a')),
          flushSaveBackups: () => {
            throw new Error('b');
          },
          flushSync: () => Promise.reject(new Error('c')),
        },
        quiet,
      ),
    );
  });
});
