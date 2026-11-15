import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseClock, RESERVED_DEVICE_ID, type Clock } from '../../../src/shared/sync/clock';
import { TIMER_STALE_MS } from '../../../src/shared/timerFreshness';
import type { SqlValue, WireRow } from '../../../src/shared/sync/merge';
import { ABANDONED_SESSION_MS } from '../hub';
import { T0, clockAt, makeHub, pullAll, push, seqOf, wire, type TestHub } from './helpers';

// Barrido de sesiones abandonadas del hub (§10.5, E-08, E-09).

const A = 'aaaaaa';
const B = 'bbbbbb';
const HOUR = 3_600_000;

/** Una sesión abierta del PC A, con todas sus columnas, como la subiría el cliente. */
function openSession(
  id: string,
  options: {
    startedMs?: number;
    lastSeenMs?: number | null;
    startedBy?: string;
    deviceId?: string;
    dev?: string;
  } = {},
): WireRow {
  const startedMs = options.startedMs ?? 0;
  const lastSeenMs = options.lastSeenMs === undefined ? startedMs : options.lastSeenMs;
  const dev = options.dev ?? A;
  const fields: Record<string, SqlValue> = {
    playthroughId: 'p1',
    emulatorId: null,
    deviceId: options.deviceId ?? 'pc-a',
    startedBy: options.startedBy ?? 'watcher',
    source: 'measured',
    startedAt: T0 + startedMs,
    endedAt: null,
    durationSec: null,
    datePrecision: 'datetime',
    lastSeenAt: lastSeenMs === null ? null : T0 + lastSeenMs,
    closedBy: null,
    note: null,
  };
  const clocks: Record<string, Clock> = {};
  for (const column of Object.keys(fields)) clocks[column] = clockAt(startedMs, dev);
  // La señal de vida la escribe el dueño cuando late.
  if (lastSeenMs !== null) clocks.lastSeenAt = clockAt(lastSeenMs, dev);
  return wire({ table: 'sessions', id, at: clockAt(startedMs, dev), fields, clocks });
}

/** El cierre real que haría el dueño, como parche de tres columnas. */
function ownerClose(id: string, base: WireRow, endedMs: number, clock: Clock): WireRow {
  return {
    ...base,
    fields: {
      ...base.fields,
      endedAt: T0 + endedMs,
      durationSec: Math.round((T0 + endedMs - Number(base.fields.startedAt)) / 1000),
      closedBy: 'owner',
    },
    clocks: { ...base.clocks, endedAt: clock, durationSec: clock, closedBy: clock },
    id,
  };
}

/** `push` que exige que no se rechace ninguna fila: una prueba no puede pasar en vacío. */
const put = (hub: TestHub['hub'], ...rows: WireRow[]): void => {
  assert.deepEqual(push(hub, ...rows).rejected, []);
};

/** Un hub cuya hora va 3 h por delante de T0: las filas de las pruebas no llegan adelantadas. */
const hubAt = (): ReturnType<typeof makeHub> => {
  const test = makeHub();
  test.time.now = T0 + 3 * HOUR;
  return test;
};

const sessionOf = (rows: WireRow[], id: string): WireRow => {
  const row = rows.find((r) => r.table === 'sessions' && r.id === id);
  assert.ok(row, `falta la sesión ${id}`);
  return row;
};

describe('barrido de sesiones abandonadas (§10.5)', () => {
  it('usa la misma ventana que el cronómetro', () => {
    assert.equal(ABANDONED_SESSION_MS, TIMER_STALE_MS);
    assert.equal(ABANDONED_SESSION_MS, 24 * HOUR);
  });

  it('E-08: cierra a las 24 h sin señal, en la última señal de vida', () => {
    const { hub, time } = hubAt();
    put(hub, openSession('s1', { startedMs: 0, lastSeenMs: HOUR }));
    const before = seqOf(hub);

    time.now = T0 + HOUR + ABANDONED_SESSION_MS - 1;
    assert.equal(hub.sweep().abandonedSessions, 0, 'un milisegundo antes, sigue abierta');

    time.now = T0 + HOUR + ABANDONED_SESSION_MS;
    assert.equal(hub.sweep().abandonedSessions, 1);
    assert.equal(seqOf(hub), before + 1, 'la fila cerrada recibe secuencia nueva');

    const row = sessionOf(pullAll(hub, before), 's1');
    assert.equal(row.fields.endedAt, T0 + HOUR);
    assert.equal(row.fields.durationSec, 3600);
    assert.equal(row.fields.closedBy, 'janitor');
    for (const column of ['endedAt', 'durationSec', 'closedBy']) {
      const clock = parseClock(row.clocks[column]);
      assert.equal(clock.dev, RESERVED_DEVICE_ID);
      // Justo encima de la última escritura del dueño, no la hora del hub.
      assert.equal(clock.ms, T0 + HOUR);
    }
    // Lo demás no se toca.
    assert.equal(row.fields.lastSeenAt, T0 + HOUR);
    assert.equal(row.fields.deviceId, 'pc-a');

    // Barrer otra vez no repite nada ni gasta secuencia.
    const after = seqOf(hub);
    assert.equal(hub.sweep().abandonedSessions, 0);
    assert.equal(seqOf(hub), after);
  });

  it('E-09: el cierre real del dueño, hecho offline antes del barrido, gana', () => {
    const { hub, time } = hubAt();
    const open = openSession('s1', { startedMs: 0, lastSeenMs: HOUR });
    put(hub, open);
    // A cerró bien a las 2 h, pero estuvo 30 h sin conexión.
    time.now = T0 + 30 * HOUR;
    assert.equal(hub.sweep().abandonedSessions, 1);
    put(hub, ownerClose('s1', open, 2 * HOUR, clockAt(2 * HOUR, A)));

    const row = sessionOf(pullAll(hub), 's1');
    assert.equal(row.fields.endedAt, T0 + 2 * HOUR);
    assert.equal(row.fields.durationSec, 7200);
    assert.equal(row.fields.closedBy, 'owner');
  });

  it('E-09 en el mismo milisegundo: el siguiente reloj del dueño también gana', () => {
    const { hub, time } = hubAt();
    const open = openSession('s1', { startedMs: 0, lastSeenMs: HOUR });
    put(hub, open);
    time.now = T0 + 30 * HOUR;
    hub.sweep();
    // El HybridClock de A, sin avanzar el reloj de pared, da el contador siguiente.
    put(hub, ownerClose('s1', open, HOUR, clockAt(HOUR, A, 1)));
    assert.equal(sessionOf(pullAll(hub), 's1').fields.closedBy, 'owner');
  });

  it('una nota de otro PC no sube el reloj del cierre del hub por encima del dueño', () => {
    const { hub, time } = hubAt();
    const open = openSession('s1', { startedMs: 0, lastSeenMs: HOUR });
    put(hub, open);
    // B escribe la nota (campo que cualquier PC puede tocar) a las 29 h.
    time.now = T0 + 29 * HOUR;
    put(hub, {
      ...open,
      fields: { note: 'buena tarde' },
      clocks: { note: clockAt(29 * HOUR, B) },
    });
    time.now = T0 + 30 * HOUR;
    assert.equal(hub.sweep().abandonedSessions, 1);
    const swept = sessionOf(pullAll(hub), 's1');
    assert.equal(parseClock(swept.clocks.endedAt).ms, T0 + HOUR);

    put(hub, ownerClose('s1', open, 2 * HOUR, clockAt(2 * HOUR, A)));
    const row = sessionOf(pullAll(hub), 's1');
    assert.equal(row.fields.closedBy, 'owner');
    assert.equal(row.fields.endedAt, T0 + 2 * HOUR);
    assert.equal(row.fields.note, 'buena tarde');
  });

  it('sin señal de vida cierra en el inicio, con duración 0', () => {
    const { hub, time } = hubAt();
    put(hub, openSession('s1', { startedMs: HOUR, lastSeenMs: null }));
    time.now = T0 + HOUR + ABANDONED_SESSION_MS;
    assert.equal(hub.sweep().abandonedSessions, 1);
    const row = sessionOf(pullAll(hub), 's1');
    assert.equal(row.fields.endedAt, T0 + HOUR);
    assert.equal(row.fields.durationSec, 0);
  });

  it('no toca las cerradas, las borradas ni las que tienen señal reciente', () => {
    const { hub, time } = hubAt();
    time.now = T0 + 30 * HOUR;
    const closed = openSession('closed');
    put(hub, ownerClose('closed', closed, HOUR, clockAt(HOUR, A)));
    put(hub, {
      ...openSession('deleted'),
      deleted: clockAt(5, A),
      clocks: { ...openSession('deleted').clocks, syncDeleted: clockAt(5, A) },
    });
    put(hub, openSession('fresh', { startedMs: 0, lastSeenMs: 20 * HOUR }));
    const before = seqOf(hub);
    assert.equal(hub.sweep().abandonedSessions, 0);
    assert.equal(seqOf(hub), before);
    assert.equal(sessionOf(pullAll(hub), 'fresh').fields.endedAt, null);
    assert.equal(sessionOf(pullAll(hub), 'closed').fields.closedBy, 'owner');
  });

  it('también cierra los cronómetros abandonados', () => {
    const { hub, time } = hubAt();
    push(
      hub,
      openSession('t1', { startedBy: 'timer', deviceId: 'web', dev: 'webweb', lastSeenMs: HOUR }),
    );
    time.now = T0 + HOUR + ABANDONED_SESSION_MS;
    assert.equal(hub.sweep().abandonedSessions, 1);
    assert.equal(sessionOf(pullAll(hub), 't1').fields.closedBy, 'janitor');
  });

  it('el eco del cierre (el cliente lo reenvía tal cual) se admite y no gasta secuencia', () => {
    const { hub, time } = hubAt();
    put(hub, openSession('s1', { lastSeenMs: HOUR }));
    time.now = T0 + 30 * HOUR;
    hub.sweep();
    const swept = sessionOf(pullAll(hub), 's1');
    const before = seqOf(hub);
    const echo = push(hub, swept);
    assert.equal(echo.rejected.length, 0);
    assert.equal(echo.accepted.length, 1);
    assert.equal(seqOf(hub), before);
  });

  it('un cliente no puede inventarse un cierre del barrido', () => {
    const { hub } = hubAt();
    const open = openSession('s1', { lastSeenMs: HOUR });
    put(hub, open);
    const forged = ownerClose(
      's1',
      open,
      HOUR,
      `${String(T0 + HOUR).padStart(13, '0')}-0001-${RESERVED_DEVICE_ID}`,
    );
    const res = push(hub, forged);
    assert.equal(res.rejected[0]?.reason, 'reserved_device');
    assert.equal(sessionOf(pullAll(hub), 's1').fields.endedAt, null);
  });
});
