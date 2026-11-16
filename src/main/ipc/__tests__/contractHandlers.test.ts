import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

// EL BORDE DEL CONTRATO IPC: validación de la entrada (§15.3).
//
// REAL: contractHandlers.ts y el contrato con sus esquemas de zod. DOBLADO:
// electron, para capturar lo que se registra en `ipcMain` y poder llamar a los
// manejadores a mano, como lo haría el proceso del renderer.

type Registered = (event: unknown, ...args: unknown[]) => unknown;
const invokeHandlers = new Map<string, Registered>();
const sendHandlers = new Map<string, Registered>();

mock.module('electron', {
  namedExports: {
    ipcMain: {
      handle: (channel: string, fn: Registered): void => {
        invokeHandlers.set(channel, fn);
      },
      on: (channel: string, fn: Registered): void => {
        sendHandlers.set(channel, fn);
      },
    },
  },
});

let helpers: typeof import('../contractHandlers');

before(async () => {
  helpers = await import('../contractHandlers');
});

beforeEach(() => {
  invokeHandlers.clear();
  sendHandlers.clear();
});

const call = (channel: string, ...args: unknown[]): unknown => {
  const registered = invokeHandlers.get(channel);
  assert.ok(registered, `${channel} debería estar registrado`);
  return registered({}, ...args);
};

describe('handle: la entrada se valida antes del manejador', () => {
  it('pasa los argumentos buenos al manejador, con su valor', async () => {
    const seen: unknown[][] = [];
    helpers.handle('sessions:close', async (_event, id, endedAt) => {
      seen.push([id, endedAt]);
      return null;
    });
    const endedAt = new Date('2026-01-02T03:04:05Z');
    await call('sessions:close', 'abc', endedAt);
    assert.deepEqual(seen, [['abc', endedAt]]);
  });

  it('rechaza un id que no es texto, con el canal en el mensaje, sin ejecutar nada', () => {
    let ran = false;
    helpers.handle('sessions:close', async () => {
      ran = true;
      return null;
    });
    assert.throws(
      () => call('sessions:close', 42, new Date()),
      (error: unknown) =>
        error instanceof helpers.IpcValidationError &&
        error.channel === 'sessions:close' &&
        /sessions:close/.test(error.message) &&
        /argument 0/.test(error.message),
    );
    assert.equal(ran, false);
  });

  it('rechaza un id vacío y una fecha que no es Date', () => {
    helpers.handle('sessions:close', async () => null);
    assert.throws(() => call('sessions:close', '', new Date()), /argument 0/);
    assert.throws(() => call('sessions:close', 'abc', '2026-01-01'), /argument 1/);
  });

  it('rechaza argumentos de más y de menos', () => {
    helpers.handle('games:delete', async () => true);
    assert.throws(() => call('games:delete'), /games:delete/);
    assert.throws(() => call('games:delete', 'a', 'b'), /games:delete/);
  });

  it('games:update admite solo su lista cerrada de campos', async () => {
    const patches: unknown[] = [];
    helpers.handle('games:update', async (_event, _id, patch) => {
      patches.push(patch);
      return null;
    });
    await call('games:update', 'g1', { notes: null, endless: true });
    assert.deepEqual(patches, [{ notes: null, endless: true }]);
    assert.throws(() => call('games:update', 'g1', { steamAppId: 1 }), /games:update/);
    assert.throws(() => call('games:update', 'g1', { addedAt: new Date() }), /games:update/);
    assert.throws(() => call('games:update', 'g1', { endless: 'yes' }), /argument 1/);
  });

  it('los argumentos opcionales se pueden omitir o mandar como undefined', async () => {
    const seen: unknown[][] = [];
    helpers.handle('saves:setEnabled', async (_event, ...args) => {
      seen.push(args);
      return true;
    });
    await call('saves:setEnabled', 'g1', true);
    await call('saves:setEnabled', 'g1', true, undefined);
    await call('saves:setEnabled', 'g1', false, 'Hades');
    assert.deepEqual(seen, [
      ['g1', true],
      ['g1', true, undefined],
      ['g1', false, 'Hades'],
    ]);
    assert.throws(() => call('saves:setEnabled', 'g1', true, 7), /argument 2/);
  });
});

describe('on: lo que se manda sin esperar respuesta', () => {
  it('ejecuta el manejador con la entrada buena', () => {
    let ran = 0;
    helpers.on('window:minimize', () => {
      ran += 1;
    });
    const registered = sendHandlers.get('window:minimize');
    assert.ok(registered);
    registered({});
    assert.equal(ran, 1);
  });

  it('registra y descarta una entrada que no cumple el contrato', () => {
    let ran = 0;
    helpers.on('window:minimize', () => {
      ran += 1;
    });
    const registered = sendHandlers.get('window:minimize');
    assert.ok(registered);
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args[0]);
    };
    try {
      registered({}, 'sobra');
    } finally {
      console.error = original;
    }
    assert.equal(ran, 0);
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]), /window:minimize/);
  });
});

describe('emit', () => {
  it('manda el canal y la carga al destino', () => {
    const sent: unknown[][] = [];
    const target = { send: (...args: unknown[]): void => void sent.push(args) };
    helpers.emit(target, 'window:maximized-change', true);
    helpers.emit(target, 'games:changed');
    assert.deepEqual(sent, [['window:maximized-change', true], ['games:changed']]);
  });
});
