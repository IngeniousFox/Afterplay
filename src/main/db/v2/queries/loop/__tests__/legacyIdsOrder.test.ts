import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildChapter } from '../../../../../../shared/memory/chapters';
import { deriveMoments, type MemorySession } from '../../../../../../shared/memory/moments';
import { toLegacyIds } from '../memorySignature';

// `toLegacyIds` firma como la 1.x: el orden de los momentos es el de los ids
// 1.x (= el id de sesión importado), NO `syncCreated` (§10.7, F-09). Si el
// momento arrastrase `sessionSyncCreated`, el hash volvería a desempatar por
// el reloj y dejaría de casar con los recaps ya sellados. Datos inventados.

const session = (id: string, gameId: string, syncCreated: string): MemorySession => {
  const startedAt = new Date('2026-06-05T18:00:00Z');
  return {
    id,
    gameId,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 2 * 3_600_000),
    durationSec: 7200,
    isManual: false,
    syncCreated,
  };
};

describe('toLegacyIds', () => {
  it('ordena los momentos por id de sesión y no lleva sessionSyncCreated', () => {
    // 's-1' (id menor) se creó DESPUÉS por reloj.
    const sessions = [
      session('s-1', 'g-1', '0001700000500-0000-bbbbbb'),
      session('s-2', 'g-2', '0001700000000-0000-aaaaaa'),
    ];
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 5 },
      sessions,
      [],
      new Map([
        ['g-1', 'Juego Uno'],
        ['g-2', 'Juego Dos'],
      ]),
      deriveMoments(sessions),
      new Date('2026-07-15T12:00:00Z'),
    )!;
    assert.ok(chapter.moments.every((moment) => moment.sessionSyncCreated !== undefined));

    const converted = toLegacyIds(
      chapter,
      new Map([
        ['g-1', 11],
        ['g-2', 22],
      ]),
    );
    assert.ok('chapter' in converted);
    const moments = converted.chapter.moments;
    assert.equal(
      moments.some((moment) => 'sessionSyncCreated' in moment),
      false,
    );
    // El rango sigue el id: s-1 → 0, s-2 → 1.
    assert.deepEqual(
      moments.map((moment) => [moment.gameId, moment.sessionId]),
      [
        [11, 0],
        [22, 1],
      ],
    );
  });
});
