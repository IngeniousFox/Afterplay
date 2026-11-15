import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildChapter, canonicalChapterFacts } from '../chapters';
import { deriveMoments, type MemorySession } from '../moments';

// El desempate de las sesiones y de los momentos con el mismo instante sigue
// a `syncCreated` y no al id (AFTERPLAY-2.0.md §10.7, F-09). Datos inventados.

const EARLY = '0001700000000-0000-aaaaaa';
const LATE = '0001700000500-0000-bbbbbb';

const session = (
  id: string,
  gameId: string,
  syncCreated: string | undefined,
  startedAt = '2026-06-05T18:00:00Z',
): MemorySession => {
  const start = new Date(startedAt);
  return {
    id,
    gameId,
    startedAt: start,
    endedAt: new Date(start.getTime() + 2 * 3_600_000),
    durationSec: 7200,
    isManual: false,
    syncCreated,
  };
};

describe('deriveMoments: sesiones con el mismo arranque', () => {
  it('la primera sesión es la creada antes por syncCreated, aunque su id sea mayor', () => {
    // Dos PCs offline jugaron al mismo juego en el mismo instante: 's-b' se
    // creó antes (reloj) pero su id es mayor.
    const moments = deriveMoments([session('s-a', '1', LATE), session('s-b', '1', EARLY)]);
    const first = moments.find((moment) => moment.type === 'first_session');
    assert.equal(first?.sessionId, 's-b');
    assert.equal(first?.sessionSyncCreated, EARLY);
  });

  it('sin syncCreated manda el id y el momento no lleva sessionSyncCreated', () => {
    const moments = deriveMoments([session('s-a', '1', undefined), session('s-b', '1', undefined)]);
    const first = moments.find((moment) => moment.type === 'first_session');
    assert.equal(first?.sessionId, 's-a');
    assert.equal('sessionSyncCreated' in (first ?? {}), false);
  });
});

describe('canonicalChapterFacts: orden de los momentos con el mismo instante', () => {
  const titles = new Map([
    ['1', 'Juego Uno'],
    ['2', 'Juego Dos'],
  ]);
  const gamesOf = (sessions: MemorySession[]): string[] => {
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 5 },
      sessions,
      [],
      titles,
      deriveMoments(sessions),
      new Date('2026-07-15T12:00:00Z'),
    );
    const facts = JSON.parse(canonicalChapterFacts(chapter!)) as { moments: { game: string }[] };
    return facts.moments.map((moment) => moment.game);
  };

  it('desempata por el reloj de la sesión y no por su id', () => {
    // Misma hora de arranque, dos juegos distintos: cada uno tiene su
    // first_session en el mismo instante. 's-1' tiene el id menor pero se creó
    // después.
    const sessions = [session('s-1', '1', LATE), session('s-2', '2', EARLY)];
    assert.deepEqual(gamesOf(sessions), ['2', '1']);
  });

  it('sin syncCreated, por id como siempre (los recaps de la 1.x firman igual)', () => {
    const sessions = [session('s-1', '1', undefined), session('s-2', '2', undefined)];
    assert.deepEqual(gamesOf(sessions), ['1', '2']);
  });
});
