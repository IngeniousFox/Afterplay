import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveLibrary,
  type LibraryGameRow,
  type LibraryGameSummary,
  type LibraryIterationRow,
  type LibraryLiveSession,
  type LibraryStateEventRow,
} from '../library';
import type { GameId, IterationId } from '../../entityIds';

// La biblioteca en el único sitio donde está escrita. Cubre lo que fijaban
// por separado getGames.test.ts / queryPerformance.test.ts en el escritorio y
// los tests de buildLibraryData / getStatsSummary en el Worker (la
// "paridad"); aquí se prueba la regla que ahora llaman los dos.

const ADDED_AT = new Date('2026-01-01T00:00:00Z');
let nextId = 1;

const game = (
  id: GameId,
  extra: { addedAt?: Date; promotedAt?: Date | null } = {},
): LibraryGameRow => ({
  id,
  addedAt: extra.addedAt ?? ADDED_AT,
  promotedAt: extra.promotedAt ?? null,
});

const iteration = (
  id: IterationId,
  gameId: GameId,
  extra: Partial<LibraryIterationRow> = {},
): LibraryIterationRow => ({
  id,
  gameId,
  manualTotalPlayed: null,
  sessionCount: 0,
  trackedSeconds: 0,
  lastSessionAt: null,
  firstSessionAt: null,
  ...extra,
});

const event = (
  gameId: GameId,
  iterationId: IterationId,
  type: LibraryStateEventRow['type'],
  occurredAt: string | Date,
): LibraryStateEventRow => ({
  id: String(nextId++),
  gameId,
  iterationId,
  type,
  occurredAt: new Date(occurredAt),
});

const derive = (input: {
  games: LibraryGameRow[];
  iterations?: LibraryIterationRow[];
  stateEvents?: LibraryStateEventRow[];
  liveSessions?: LibraryLiveSession[];
  timeZone?: string | null;
}): Map<GameId, LibraryGameSummary> =>
  deriveLibrary({
    games: input.games,
    iterations: input.iterations ?? [],
    stateEvents: input.stateEvents ?? [],
    liveSessions: input.liveSessions ?? [],
    timeZone: input.timeZone,
  });

const ms = (iso: string): number => new Date(iso).getTime();

describe('horas y sesiones', () => {
  it('suma playthroughs (manual + medido) y cuenta todas las sesiones, la abierta incluida', () => {
    const summary = derive({
      games: [game('1')],
      iterations: [
        iteration('1', '1', { manualTotalPlayed: 12.5, sessionCount: 3, trackedSeconds: 5400 }),
        iteration('2', '1', { sessionCount: 1, trackedSeconds: 0 }),
      ],
    }).get('1')!;
    assert.equal(summary.totalHours, 14);
    assert.equal(summary.sessionCount, 4);
  });

  it('acepta los enteros del driver como bigint', () => {
    const summary = derive({
      games: [game('1')],
      iterations: [
        iteration('1', '1', {
          sessionCount: 2n,
          trackedSeconds: 7200n,
          lastSessionAt: BigInt(ms('2026-02-01T00:00:00Z')),
        }),
      ],
    }).get('1')!;
    assert.equal(summary.totalHours, 2);
    assert.equal(summary.sessionCount, 2);
    assert.equal(summary.lastPlayedAt?.toISOString(), '2026-02-01T00:00:00.000Z');
  });

  it('un juego sin playthroughs sale a cero, y las filas de juegos fuera de la lista se ignoran', () => {
    const summaries = derive({
      games: [game('1')],
      iterations: [iteration('9', '99', { sessionCount: 5, trackedSeconds: 3600 })],
    });
    assert.deepEqual(summaries.get('1'), {
      totalHours: 0,
      sessionCount: 0,
      currentState: null,
      lastPlayedAt: null,
      isLive: false,
      liveSince: null,
      manualIterations: [],
    });
    assert.equal(summaries.has('99'), false);
  });
});

describe('el estado actual', () => {
  it('es el último evento REAL: el plan_to_play no tapa un completed del pasado', () => {
    const summary = derive({
      games: [game('1')],
      iterations: [iteration('1', '1')],
      stateEvents: [
        event('1', '1', 'completed', '2020-01-01T00:00:00Z'),
        event('1', '1', 'plan_to_play', '2025-01-01T00:00:00Z'),
      ],
    }).get('1')!;
    assert.equal(summary.currentState, 'completed');
  });
});

describe('"Last played"', () => {
  it('la más reciente de las dos fuentes, aunque haya sesiones', () => {
    const summary = derive({
      games: [game('1')],
      iterations: [
        iteration('1', '1', { sessionCount: 1, lastSessionAt: ms('2025-01-15T00:00:00Z') }),
      ],
      stateEvents: [event('1', '1', 'completed', '2025-06-01T00:00:00Z')],
    }).get('1')!;
    assert.equal(summary.lastPlayedAt?.toISOString(), '2025-06-01T00:00:00.000Z');
  });

  it('el evento que escribe el alta (o el promote) no cuenta como jugada', () => {
    const promotedAt = new Date('2026-05-01T10:00:00Z');
    const summaries = derive({
      games: [game('1'), game('2', { promotedAt })],
      iterations: [iteration('1', '1'), iteration('2', '2')],
      stateEvents: [
        event('1', '1', 'completed', new Date(ADDED_AT.getTime() + 1_000)),
        event('2', '2', 'started', '2024-01-01T00:00:00Z'),
        event('2', '2', 'completed', new Date(promotedAt.getTime() + 2)),
      ],
    });
    assert.equal(summaries.get('1')!.lastPlayedAt, null);
    // El started con fecha propia sigue valiendo aunque el último sea papeleo.
    assert.equal(summaries.get('2')!.lastPlayedAt?.toISOString(), '2024-01-01T00:00:00.000Z');
  });

  it('un juego con sesiones y sin log sale por su última sesión', () => {
    const summary = derive({
      games: [game('1')],
      iterations: [
        iteration('1', '1', { sessionCount: 1, lastSessionAt: ms('2025-01-15T00:00:00Z') }),
      ],
    }).get('1')!;
    assert.equal(summary.lastPlayedAt?.toISOString(), '2025-01-15T00:00:00.000Z');
  });
});

describe('el año de las horas manuales', () => {
  it('manda el fin sobre el principio, y sin log la primera sesión', () => {
    const manual = derive({
      games: [game('1')],
      iterations: [
        iteration('1', '1', { manualTotalPlayed: 90 }),
        iteration('2', '1', {
          manualTotalPlayed: 50,
          sessionCount: 1,
          firstSessionAt: ms('2024-07-01T12:00:00Z'),
        }),
        iteration('3', '1', { manualTotalPlayed: 3 }),
      ],
      stateEvents: [
        event('1', '1', 'started', '2022-03-01T12:00:00Z'),
        event('1', '1', 'completed', '2023-03-01T12:00:00Z'),
      ],
    }).get('1')!.manualIterations;
    assert.deepEqual(manual, [
      { iterationId: '1', hours: 90, year: 2023 },
      { iterationId: '2', hours: 50, year: 2024 },
      { iterationId: '3', hours: 3, year: null },
    ]);
  });

  it('el artefacto del alta no fecha unas horas: sin otra pista, solo cuentan en All Time', () => {
    const [manual] = derive({
      games: [game('1')],
      iterations: [iteration('1', '1', { manualTotalPlayed: 50 })],
      stateEvents: [event('1', '1', 'completed', ADDED_AT)],
    }).get('1')!.manualIterations;
    assert.equal(manual.year, null);
  });

  it('el año se lee en la zona del que mira', () => {
    // Medianoche LOCAL del 1 de enero en Madrid = 23:00Z del 31 de diciembre.
    const derived = (timeZone: string): number | null =>
      derive({
        games: [game('1')],
        iterations: [iteration('1', '1', { manualTotalPlayed: 60 })],
        stateEvents: [event('1', '1', 'completed', '2018-12-31T23:00:00Z')],
        timeZone,
      }).get('1')!.manualIterations[0].year;
    assert.equal(derived('Europe/Madrid'), 2019);
    assert.equal(derived('UTC'), 2018);
  });
});

describe('en vivo', () => {
  it('gana el arranque más reciente entre las sesiones en marcha de un juego', () => {
    const summaries = derive({
      games: [game('1'), game('2')],
      liveSessions: [
        { gameId: '1', startedAt: ms('2026-01-01T10:00:00Z') },
        { gameId: '1', startedAt: new Date('2026-01-02T10:00:00Z') },
      ],
    });
    assert.equal(summaries.get('1')!.isLive, true);
    assert.equal(summaries.get('1')!.liveSince?.toISOString(), '2026-01-02T10:00:00.000Z');
    assert.equal(summaries.get('2')!.isLive, false);
  });
});
