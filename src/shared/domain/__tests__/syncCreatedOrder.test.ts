import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareRowsByCreation } from '../creationOrder';
import { deriveGameDetail, type DetailIterationRow, type DetailStateEventRow } from '../gameDetail';
import { deriveLibrary, type LibraryIterationRow, type LibraryStateEventRow } from '../library';
import {
  resolvePlaythroughForPlay,
  type PlaythroughRow,
  type PlaythroughStateEventRow,
} from '../resolvePlaythrough';
import { splitSpendByPlaythrough, type SpendStateEvent } from '../spend';
import { latestRealStateEvent } from '../../playthroughState';

// El orden de creación en la 2.0 (AFTERPLAY-2.0.md §10.7, F-09): lo decide
// `syncCreated` (texto del reloj, comparable como string) y el id solo
// desempata. Cada test pone el id al revés que el reloj para demostrar que
// manda el reloj; los de abajo del todo comprueban que SIN `syncCreated` (la
// 1.x y el Worker) sigue mandando el id. Datos inventados.

// Relojes de ancho fijo y orden creciente: `EARLY` < `LATE`.
const EARLY = '0001700000000-0000-aaaaaa';
const LATE = '0001700000500-0000-bbbbbb';

describe('compareRowsByCreation', () => {
  it('manda syncCreated aunque el id diga lo contrario', () => {
    const older = { id: 'zzz', syncCreated: EARLY };
    const newer = { id: 'aaa', syncCreated: LATE };
    assert.ok(compareRowsByCreation(older, newer) < 0);
    assert.ok(compareRowsByCreation(newer, older) > 0);
  });

  it('con el mismo reloj desempata el id', () => {
    assert.ok(
      compareRowsByCreation({ id: 'a', syncCreated: EARLY }, { id: 'b', syncCreated: EARLY }) < 0,
    );
  });

  it('sin syncCreated en alguna de las dos filas, el id (la 1.x y el Worker)', () => {
    assert.ok(compareRowsByCreation({ id: 'a' }, { id: 'b' }) < 0);
    assert.ok(compareRowsByCreation({ id: 2 }, { id: 10 }) < 0);
    assert.ok(compareRowsByCreation({ id: 'a', syncCreated: LATE }, { id: 'b' }) < 0);
    assert.ok(
      compareRowsByCreation({ id: 'a', syncCreated: null }, { id: 'b', syncCreated: EARLY }) < 0,
    );
  });
});

// ── resolvePlaythroughForPlay ───────────────────────────────────────────────

const NOW = new Date('2026-03-15T19:00:00Z');
const GAME = { endless: false, isEmulated: false, officialPlatforms: null };

describe('resolvePlaythroughForPlay con dos playthroughs activos', () => {
  // El de id MENOR es el creado después (su PC tenía el reloj de pared atrasado).
  const playthroughs: PlaythroughRow[] = [
    { id: 'p-b', label: 'Playthrough 1', syncCreated: EARLY },
    { id: 'p-a', label: 'Playthrough 2', syncCreated: LATE },
  ];
  const started = (id: string, iterationId: string, at: string): PlaythroughStateEventRow => ({
    id,
    iterationId,
    type: 'started',
    occurredAt: new Date(at),
  });

  it('el vigente a fecha `at` es el de syncCreated mayor, aunque su id sea menor', () => {
    const decision = resolvePlaythroughForPlay({
      playthroughs,
      events: [
        started('e1', 'p-b', '2026-03-01T10:00:00Z'),
        started('e2', 'p-a', '2026-03-02T10:00:00Z'),
      ],
      game: GAME,
      at: NOW,
      now: NOW,
    });
    assert.deepEqual(decision, { kind: 'use', iterationId: 'p-a' });
  });

  it('también cuando el activo es solo el de hoy (arranque posterior a `at`)', () => {
    const decision = resolvePlaythroughForPlay({
      playthroughs,
      events: [
        started('e1', 'p-b', '2026-03-20T10:00:00Z'),
        started('e2', 'p-a', '2026-03-21T10:00:00Z'),
      ],
      game: GAME,
      at: NOW,
      now: NOW,
    });
    assert.deepEqual(decision, { kind: 'use', iterationId: 'p-a' });
  });

  it('la "última" que se reanuda o numera es la de syncCreated mayor', () => {
    // Los dos en pausa: se reanuda el creado después, que es el de id menor.
    const decision = resolvePlaythroughForPlay({
      playthroughs,
      events: [
        { ...started('e1', 'p-b', '2026-03-01T10:00:00Z'), type: 'on_hold' },
        { ...started('e2', 'p-a', '2026-03-02T10:00:00Z'), type: 'on_hold' },
      ],
      game: GAME,
      at: NOW,
      now: NOW,
    });
    assert.equal(decision.kind, 'resume');
    assert.ok(decision.kind === 'resume');
    assert.equal(decision.iterationId, 'p-a');
  });

  it('sin syncCreated (1.x, Worker) manda el id, como siempre', () => {
    const decision = resolvePlaythroughForPlay({
      playthroughs: playthroughs.map(({ id, label }) => ({ id, label })),
      events: [
        started('e1', 'p-b', '2026-03-01T10:00:00Z'),
        started('e2', 'p-a', '2026-03-02T10:00:00Z'),
      ],
      game: GAME,
      at: NOW,
      now: NOW,
    });
    // El de id mayor es 'p-b'.
    assert.deepEqual(decision, { kind: 'use', iterationId: 'p-b' });
  });

  it('dos eventos en el mismo instante: gana el creado después por syncCreated, no por id', () => {
    // Mismo instante: 'started' escrito después (por reloj) que 'on_hold'.
    const decision = resolvePlaythroughForPlay({
      playthroughs: [{ id: 'p-1', label: 'Playthrough 1' }],
      events: [
        { id: 'z', iterationId: 'p-1', type: 'started', occurredAt: NOW, syncCreated: LATE },
        { id: 'a', iterationId: 'p-1', type: 'on_hold', occurredAt: NOW, syncCreated: EARLY },
      ],
      game: GAME,
      at: NOW,
      now: NOW,
    });
    assert.deepEqual(decision, { kind: 'use', iterationId: 'p-1' });
  });
});

// ── latestRealStateEvent ────────────────────────────────────────────────────

describe('latestRealStateEvent: desempate de eventos en el mismo instante', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  it('gana el de syncCreated mayor aunque su id sea menor', () => {
    const latest = latestRealStateEvent([
      { id: 'b', type: 'completed', occurredAt: at, syncCreated: EARLY },
      { id: 'a', type: 'started', occurredAt: at, syncCreated: LATE },
    ]);
    assert.equal(latest?.type, 'started');
  });
  it('sin syncCreated gana el id mayor', () => {
    const latest = latestRealStateEvent([
      { id: 'b', type: 'completed', occurredAt: at },
      { id: 'a', type: 'started', occurredAt: at },
    ]);
    assert.equal(latest?.type, 'completed');
  });
});

// ── deriveGameDetail ────────────────────────────────────────────────────────

describe('deriveGameDetail: orden por syncCreated', () => {
  const iterations: DetailIterationRow[] = [
    { id: 'i-a', manualTotalPlayed: null, syncCreated: LATE },
    { id: 'i-b', manualTotalPlayed: null, syncCreated: EARLY },
  ];
  const ev = (
    id: string,
    iterationId: string,
    type: DetailStateEventRow['type'],
    occurredAt: string,
    syncCreated?: string,
  ): DetailStateEventRow => ({
    id,
    iterationId,
    type,
    occurredAt: new Date(occurredAt),
    datePrecision: 'day',
    syncCreated,
  });

  it('los playthroughs salen en orden de syncCreated, no de id', () => {
    const derived = deriveGameDetail({
      iterations,
      sessions: [],
      stateEvents: [],
      spendEvents: [],
    });
    assert.deepEqual(
      derived.iterations.map((entry) => entry.iteration.id),
      ['i-b', 'i-a'],
    );
  });

  it('el reparto del gasto recorre los playthroughs en ese orden', () => {
    // 'i-b' es el primero por reloj y se cierra el día 10: el gasto del día 5
    // es suyo. Por id, 'i-a' sería el primero y, abierto, se lo quedaría.
    const derived = deriveGameDetail({
      iterations,
      sessions: [],
      stateEvents: [ev('e1', 'i-b', 'completed', '2026-01-10T00:00:00Z', EARLY)],
      spendEvents: [{ amount: 20, occurredAt: new Date('2026-01-05T00:00:00Z') }],
    });
    const spendOf = (id: string): number | undefined =>
      derived.iterations.find((entry) => entry.iteration.id === id)?.spend;
    assert.equal(spendOf('i-b'), 20);
    assert.equal(spendOf('i-a'), 0);
  });

  it('el primer started en el mismo instante es el creado antes por syncCreated', () => {
    const derived = deriveGameDetail({
      iterations: [{ id: 'i-a', manualTotalPlayed: null, syncCreated: EARLY }],
      sessions: [],
      stateEvents: [
        ev('e-1', 'i-a', 'started', '2026-01-02T00:00:00Z', LATE),
        ev('e-2', 'i-a', 'started', '2026-01-02T00:00:00Z', EARLY),
      ],
      spendEvents: [],
    });
    assert.equal(derived.iterations[0].startEvent?.id, 'e-2');
  });

  it('el primer plan_to_play es el creado antes por syncCreated', () => {
    const derived = deriveGameDetail({
      iterations: [{ id: 'i-a', manualTotalPlayed: null, syncCreated: EARLY }],
      sessions: [],
      stateEvents: [
        ev('e-1', 'i-a', 'plan_to_play', '2026-01-02T00:00:00Z', LATE),
        ev('e-2', 'i-a', 'plan_to_play', '2026-01-03T00:00:00Z', EARLY),
      ],
      spendEvents: [],
    });
    assert.equal(derived.firstPlanEvent?.id, 'e-2');
  });

  it('el estado del playthrough en un empate lo decide syncCreated', () => {
    const derived = deriveGameDetail({
      iterations: [{ id: 'i-a', manualTotalPlayed: null, syncCreated: EARLY }],
      sessions: [],
      stateEvents: [
        ev('e-9', 'i-a', 'completed', '2026-01-02T00:00:00Z', EARLY),
        ev('e-1', 'i-a', 'started', '2026-01-02T00:00:00Z', LATE),
      ],
      spendEvents: [],
    });
    assert.equal(derived.iterations[0].currentState, 'started');
    assert.equal(derived.currentState, 'started');
  });
});

// ── deriveLibrary ───────────────────────────────────────────────────────────

describe('deriveLibrary: orden por syncCreated', () => {
  const game = { id: 'g', addedAt: new Date('2026-01-01T00:00:00Z'), promotedAt: null };
  const iteration = (id: string, hours: number, syncCreated?: string): LibraryIterationRow => ({
    id,
    gameId: 'g',
    manualTotalPlayed: hours,
    sessionCount: 0,
    trackedSeconds: 0,
    lastSessionAt: null,
    firstSessionAt: null,
    syncCreated,
  });

  it('las horas se suman en orden de syncCreated (el de la lista, no el del id)', () => {
    // Por id sería i-a(0.1) + i-b(0.2) + i-c(0.3); por reloj, c + b + a. En
    // coma flotante las dos sumas difieren en el último bit y el orden se ve.
    const summary = deriveLibrary({
      games: [game],
      iterations: [
        iteration('i-a', 0.1, '0001700000300-0000-aaaaaa'),
        iteration('i-b', 0.2, '0001700000200-0000-aaaaaa'),
        iteration('i-c', 0.3, '0001700000100-0000-aaaaaa'),
      ],
      stateEvents: [],
      liveSessions: [],
    }).get('g')!;
    assert.equal(summary.totalHours, 0.3 + 0.2 + 0.1);
    assert.notEqual(0.3 + 0.2 + 0.1, 0.1 + 0.2 + 0.3);
    assert.deepEqual(
      summary.manualIterations.map((entry) => entry.iterationId),
      ['i-c', 'i-b', 'i-a'],
    );
  });

  it('sin syncCreated las suma por id, como la 1.x y el Worker', () => {
    const summary = deriveLibrary({
      games: [game],
      iterations: [iteration('i-c', 0.3), iteration('i-b', 0.2), iteration('i-a', 0.1)],
      stateEvents: [],
      liveSessions: [],
    }).get('g')!;
    assert.deepEqual(
      summary.manualIterations.map((entry) => entry.iterationId),
      ['i-a', 'i-b', 'i-c'],
    );
  });

  it('el estado actual en un empate lo decide syncCreated, no el id', () => {
    const at = new Date('2026-02-01T00:00:00Z');
    const event = (
      id: string,
      type: LibraryStateEventRow['type'],
      syncCreated: string,
    ): LibraryStateEventRow => ({
      id,
      gameId: 'g',
      iterationId: 'i-a',
      type,
      occurredAt: at,
      syncCreated,
    });
    const summary = deriveLibrary({
      games: [game],
      iterations: [iteration('i-a', 1, EARLY)],
      stateEvents: [event('z', 'completed', EARLY), event('a', 'on_hold', LATE)],
      liveSessions: [],
    }).get('g')!;
    assert.equal(summary.currentState, 'on_hold');
  });
});

// ── splitSpendByPlaythrough ─────────────────────────────────────────────────

describe('splitSpendByPlaythrough: orden por syncCreated', () => {
  const closed = (id: string, at: string, syncCreated: string): SpendStateEvent => ({
    id,
    type: 'completed',
    occurredAt: new Date(at),
    syncCreated,
  });

  it('el primero por reloj es el que reclama el gasto, no el de id menor', () => {
    const iterations = [
      { id: 'i-1', syncCreated: LATE },
      { id: 'i-9', syncCreated: EARLY },
    ];
    const events = new Map<string, readonly SpendStateEvent[]>([
      ['i-9', [closed('e1', '2026-01-10T00:00:00Z', EARLY)]],
    ]);
    const split = splitSpendByPlaythrough(iterations, events, [
      { amount: 5, occurredAt: new Date('2026-01-05T00:00:00Z') },
      { amount: 7, occurredAt: new Date('2026-01-20T00:00:00Z') },
    ]);
    assert.equal(split.get('i-9'), 5);
    assert.equal(split.get('i-1'), 7);
  });

  it('sin syncCreated manda el id', () => {
    const split = splitSpendByPlaythrough(
      [{ id: 'i-9' }, { id: 'i-1' }],
      new Map<string, readonly SpendStateEvent[]>([
        ['i-1', [{ id: 'e1', type: 'completed', occurredAt: new Date('2026-01-10T00:00:00Z') }]],
      ]),
      [{ amount: 5, occurredAt: new Date('2026-01-05T00:00:00Z') }],
    );
    assert.equal(split.get('i-1'), 5);
  });
});
