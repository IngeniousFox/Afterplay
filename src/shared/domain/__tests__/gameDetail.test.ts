import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveGameDetail,
  type DerivedGameDetail,
  type DetailIterationRow,
  type DetailStateEventRow,
} from '../gameDetail';
import type { IterationId, SessionId, StateEventId } from '../../entityIds';

// La ficha de un juego, en el único sitio donde está escrita. Los casos son
// los que fijaban por separado src/main/db/__tests__/getGameById.test.ts y
// worker/src/queries/__tests__/gameDetailParity.test.ts (este último existía
// porque había DOS copias que comparar); aquí se prueba la regla que ahora
// llaman las dos fichas.

const HOUR_MS = 3_600_000;
let nextId = 1;
// Ids de texto con relleno: el orden de escritura (que la ficha mira en
// `firstPlanEvent`) se conserva también al comparar como texto.
const newId = (): string => String(nextId++).padStart(6, '0');

type Session = {
  id: SessionId;
  iterationId: IterationId | null;
  isManual: boolean;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  startedBy: 'watcher' | 'timer';
};

const session = (
  iterationId: number | null,
  startedAt: string,
  hours: number | null,
  extra: Partial<Session> = {},
): Session => {
  const start = new Date(startedAt);
  return {
    id: newId(),
    iterationId: iterationId === null ? null : String(iterationId),
    isManual: false,
    startedAt: start,
    endedAt: hours === null ? null : new Date(start.getTime() + hours * HOUR_MS),
    durationSec: hours === null ? null : Math.round(hours * 3600),
    startedBy: 'watcher',
    ...extra,
  };
};

type Event = DetailStateEventRow & { datePrecision: 'day' | 'datetime' };
const event = (
  iterationId: number,
  type: Event['type'],
  occurredAt: string,
  id: StateEventId = newId(),
): Event => ({
  id,
  iterationId: String(iterationId),
  type,
  occurredAt: new Date(occurredAt),
  datePrecision: 'day',
});

const iteration = (id: number, manualTotalPlayed: number | null = null): DetailIterationRow => ({
  id: String(id),
  manualTotalPlayed,
});

const derive = (input: {
  iterations?: DetailIterationRow[];
  sessions?: Session[];
  stateEvents?: Event[];
  spendEvents?: { amount: number; occurredAt: Date }[];
  isRunning?: (session: Session) => boolean;
}): DerivedGameDetail<DetailIterationRow, Session, Event> =>
  deriveGameDetail({
    iterations: input.iterations ?? [iteration(1)],
    sessions: input.sessions ?? [],
    stateEvents: input.stateEvents ?? [],
    spendEvents: input.spendEvents ?? [],
    isRunning: input.isRunning,
  });

describe('el inicio derivado del playthrough', () => {
  it('una sesión manual heredada NO arrastra el inicio ni lo marca como medido', () => {
    const started = event(1, 'started', '2026-01-10T00:00:00Z');
    const [first] = derive({
      sessions: [session(1, '2020-01-01T00:00:00Z', 30, { isManual: true })],
      stateEvents: [started],
    }).iterations;
    assert.equal(first.startedAt?.toISOString(), '2026-01-10T00:00:00.000Z');
    assert.equal(first.startedBySession, false);
    assert.equal(first.startEvent?.id, started.id);
    // Sus horas no se pierden: lo descartado es su fecha como medición.
    assert.equal(first.hours, 30);
  });

  it('una sesión MEDIDA anterior al evento sí manda sobre él', () => {
    const [first] = derive({
      sessions: [
        session(1, '2020-01-01T00:00:00Z', 30, { isManual: true }),
        session(1, '2025-12-20T18:30:00Z', 2),
      ],
      stateEvents: [event(1, 'started', '2026-01-10T00:00:00Z')],
    }).iterations;
    assert.equal(first.startedAt?.toISOString(), '2025-12-20T18:30:00.000Z');
    assert.equal(first.startedBySession, true);
  });

  it('el primer started es el más temprano, lleguen como lleguen los eventos', () => {
    const early = event(1, 'started', '2024-01-01T00:00:00Z');
    const [first] = derive({
      stateEvents: [event(1, 'started', '2025-01-01T00:00:00Z'), early],
    }).iterations;
    assert.equal(first.startEvent?.id, early.id);
  });
});

describe('el fin y el estado del playthrough', () => {
  it('solo hay fin si el playthrough SIGUE en un estado que lo deja', () => {
    const reopened = derive({
      stateEvents: [
        event(1, 'completed', '2024-01-01T00:00:00Z'),
        event(1, 'started', '2024-06-01T00:00:00Z'),
      ],
    }).iterations[0];
    assert.equal(reopened.endedAt, null);
    assert.equal(reopened.currentState, 'started');

    const parked = derive({
      stateEvents: [event(1, 'on_hold', '2024-03-01T00:00:00Z')],
    }).iterations[0];
    assert.equal(parked.endedAt?.toISOString(), '2024-03-01T00:00:00.000Z');
    assert.equal(parked.endEvent?.datePrecision, 'day');
  });

  it('el plan_to_play del alta no es estado: ni del playthrough ni del juego', () => {
    const detail = derive({
      iterations: [iteration(1), iteration(2)],
      stateEvents: [
        event(1, 'started', '2023-05-01T00:00:00Z'),
        event(1, 'completed', '2023-06-01T00:00:00Z'),
        event(1, 'plan_to_play', '2026-08-13T10:00:00Z'),
        event(2, 'started', '2026-07-01T00:00:00Z'),
      ],
      spendEvents: [
        { amount: 60, occurredAt: new Date('2023-04-20T00:00:00Z') },
        { amount: 25, occurredAt: new Date('2026-07-05T00:00:00Z') },
      ],
    });
    assert.equal(detail.iterations[0].currentState, 'completed');
    assert.equal(detail.currentState, 'started');
    assert.deepEqual(
      detail.iterations.map((entry) => entry.spend),
      [60, 25],
    );
    assert.equal(detail.totalSpend, 85);
  });

  it('un juego promovido del Plan sin más eventos es Unplayed (null)', () => {
    const detail = derive({ stateEvents: [event(1, 'plan_to_play', '2026-01-01T00:00:00Z')] });
    assert.equal(detail.currentState, null);
    assert.equal(detail.iterations[0].currentState, null);
  });
});

describe('las horas y el coste de la ficha', () => {
  it('suma manual + medido por playthrough y el total del juego', () => {
    const detail = derive({
      iterations: [iteration(1, 10), iteration(2)],
      sessions: [session(1, '2024-01-01T00:00:00Z', 2), session(2, '2024-02-01T00:00:00Z', 3)],
      spendEvents: [{ amount: 30, occurredAt: new Date('2024-01-01T00:00:00Z') }],
    });
    assert.deepEqual(
      detail.iterations.map((entry) => entry.hours),
      [12, 3],
    );
    assert.equal(detail.totalHours, 15);
    assert.equal(detail.costPerHour, 2);
  });

  it('sin horas no hay coste por hora', () => {
    const detail = derive({
      spendEvents: [{ amount: 30, occurredAt: new Date('2024-01-01T00:00:00Z') }],
    });
    assert.equal(detail.costPerHour, null);
  });

  it('una sesión de emulador sin playthrough no entra en ninguno', () => {
    const detail = derive({ sessions: [session(null, '2024-01-01T00:00:00Z', 5)] });
    assert.equal(detail.totalHours, 0);
    assert.deepEqual(detail.iterations[0].sessions, []);
  });
});

describe('en vivo', () => {
  it('por defecto toda sesión abierta lo está (la regla del escritorio)', () => {
    const detail = derive({ sessions: [session(1, '2026-01-01T10:00:00Z', null)] });
    assert.equal(detail.isLive, true);
    assert.equal(detail.liveSince?.toISOString(), '2026-01-01T10:00:00.000Z');
    // Abierta: cuenta como sesión pero no aporta horas todavía.
    assert.equal(detail.totalHours, 0);
  });

  it('con dos abiertas gana el arranque más reciente', () => {
    const detail = derive({
      sessions: [
        session(1, '2026-01-02T10:00:00Z', null),
        session(1, '2026-01-01T10:00:00Z', null),
      ],
    });
    assert.equal(detail.liveSince?.toISOString(), '2026-01-02T10:00:00.000Z');
  });

  it('isRunning descarta las abiertas que ya no siguen en marcha (la vara del Worker)', () => {
    const stale = session(1, '2026-01-01T10:00:00Z', null, { startedBy: 'timer' });
    const detail = derive({ sessions: [stale], isRunning: (s) => s.startedBy !== 'timer' });
    assert.equal(detail.isLive, false);
    assert.equal(detail.liveSince, null);
  });
});

describe('la primera entrada en el Plan', () => {
  it('es el primer plan_to_play ESCRITO (id), no el de fecha más temprana', () => {
    const first = event(1, 'plan_to_play', '2025-05-01T09:00:00Z', '100');
    const detail = derive({
      stateEvents: [first, event(1, 'plan_to_play', '2024-01-01T00:00:00Z', '101')],
    });
    assert.equal(detail.firstPlanEvent?.id, '100');
  });
});
