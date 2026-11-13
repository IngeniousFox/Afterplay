import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { compareByCreation } from '../../../../../../shared/entityIds';
import {
  buildChapter,
  type Chapter,
  type ChapterScope,
  type ChapterStateEvent,
  type ChapterUnlock,
  type ManualBlock,
} from '../../../../../../shared/memory/chapters';
import {
  deriveMoments,
  type MemorySession,
  type Moment,
} from '../../../../../../shared/memory/moments';
import type { RecapPayload } from '../../../../../../shared/memory/payload';
import { chapterHash, legacyChapterHash } from '../../../../../memories/hash';
import { localLegacyIds } from '../../../schema';
import {
  openQueryDb,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getMemoryFacts, insertMemory, type MemoryFacts } from '../memories';
import {
  chapterSignature,
  loadMemoryFactsSnapshot,
  memoryChapterFor,
  recheckMemorySignature,
  recheckStoredMemorySignatures,
  scopeFromKey,
} from '../memorySignature';

// La firma de los recaps con ids 2.0 y su recálculo para los recaps
// importados (AFTERPLAY-2.0.md §19.5).
//
// La prueba central NO usa `toLegacyIds`: reconstruye el capítulo "como lo
// habría visto la 1.x" traduciendo los HECHOS a ids numéricos, lo construye
// con `buildChapter`/`deriveMoments` y lo firma con `src/main/memories/hash.ts`
// (la función que selló de verdad los recaps 1.x). Si el recálculo casa con
// esa firma, casaría con la guardada.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const JUNE: ChapterScope = { type: 'month', year: 2025, month: 5 };
const NOW = new Date('2026-01-15T12:00:00');
const payload = { headline: 'x', narrative: 'y' } as unknown as RecapPayload;

/** Junio de 2025: dos juegos, sesiones, un completado y una decisión. */
function seedJune(): { alfa: string; beta: string } {
  const alfa = seedGame(fx.ctx, { title: 'Alfa' });
  const beta = seedGame(fx.ctx, { title: 'Beta' });
  const ptAlfa = seedPlaythrough(fx.ctx, { gameId: alfa });
  const ptBeta = seedPlaythrough(fx.ctx, { gameId: beta, manualHours: 3 });
  seedSession(fx.ctx, { playthroughId: ptAlfa, startedAt: new Date('2025-06-02T20:00:00') });
  seedSession(fx.ctx, {
    playthroughId: ptAlfa,
    startedAt: new Date('2025-06-09T21:00:00'),
    endedAt: new Date('2025-06-09T23:30:00'),
  });
  seedSession(fx.ctx, { playthroughId: ptBeta, startedAt: new Date('2025-06-05T18:00:00') });
  seedStateEvent(fx.ctx, {
    playthroughId: ptAlfa,
    type: 'started',
    occurredAt: new Date('2025-06-02T20:00:00'),
  });
  seedStateEvent(fx.ctx, {
    playthroughId: ptBeta,
    type: 'completed',
    occurredAt: new Date('2025-06-20T10:00:00'),
  });
  return { alfa, beta };
}

/** Los mismos hechos con ids numéricos, como los leía la 1.x. */
interface LegacyFacts {
  sessions: MemorySession<number>[];
  events: ChapterStateEvent<number>[];
  titlesByGame: Map<number, string>;
  manualBlocks: ManualBlock<number>[];
  unlocks: ChapterUnlock<number>[];
  moments: Moment<number>[];
}

function asLegacyFacts(facts: MemoryFacts, gameIds: ReadonlyMap<string, number>): LegacyFacts {
  const game = (id: string): number => gameIds.get(id) as number;
  const sessionRank = new Map(
    facts.sessions
      .map((s) => s.id)
      .sort(compareByCreation)
      .map((id, index) => [id, 100 + index]),
  );
  const sessions = facts.sessions.map((s) => ({
    ...s,
    id: sessionRank.get(s.id) as number,
    gameId: game(s.gameId),
  }));
  const manualHoursByGame = new Map([...facts.manualHoursByGame].map(([id, h]) => [game(id), h]));
  return {
    sessions,
    events: facts.events.map((e) => ({ ...e, gameId: game(e.gameId) })),
    titlesByGame: new Map([...facts.titlesByGame].map(([id, t]) => [game(id), t])),
    manualBlocks: facts.manualBlocks.map((b) => ({ ...b, gameId: game(b.gameId) })),
    unlocks: facts.unlocks.map((u) => ({ ...u, gameId: game(u.gameId) })),
    moments: deriveMoments(sessions, manualHoursByGame),
  };
}

function legacyJuneChapter(gameIds: ReadonlyMap<string, number>): Chapter<number> {
  const legacy = asLegacyFacts(getMemoryFacts(fx.ctx), gameIds);
  const chapter = buildChapter(
    JUNE,
    legacy.sessions,
    legacy.events,
    legacy.titlesByGame,
    legacy.moments,
    NOW,
    legacy.manualBlocks,
    legacy.unlocks,
  );
  assert.ok(chapter);
  return chapter;
}

function writeLegacyIds(gameIds: ReadonlyMap<string, number>): void {
  // Tabla local: se escribe directamente, como hace el importador.
  for (const [newId, legacyId] of gameIds) {
    fx.ctx.db.insert(localLegacyIds).values({ legacyTable: 'games', legacyId, newId }).run();
  }
}

describe('chapterSignature', () => {
  it('es la misma fórmula que src/main/memories/hash.ts (las dos generaciones)', () => {
    const { alfa, beta } = seedJune();
    const chapter = legacyJuneChapter(
      new Map([
        [alfa, 7],
        [beta, 3],
      ]),
    );
    assert.equal(chapterSignature(chapter), chapterHash(chapter));
    assert.equal(chapterSignature(chapter, 'noDecisions'), legacyChapterHash(chapter));
    assert.notEqual(chapterHash(chapter), legacyChapterHash(chapter));
  });
});

describe('scopeFromKey', () => {
  it('lee meses y años, y rechaza lo que no tenga la forma', () => {
    assert.deepEqual(scopeFromKey('month', '2025-06'), JUNE);
    assert.deepEqual(scopeFromKey('year', '2025'), { type: 'year', year: 2025 });
    assert.equal(scopeFromKey('month', '2025-13'), null);
    assert.equal(scopeFromKey('month', '2025'), null);
    assert.equal(scopeFromKey('year', '2025-06'), null);
  });
});

describe('recheckMemorySignature', () => {
  it('recap 1.x vigente: casa con ids 1.x y devuelve la firma 2.0 que hay que guardar', () => {
    const { alfa, beta } = seedJune();
    // Ids 1.x en orden contrario al de los ids 2.0, para que el orden de los
    // juegos dentro de la firma cambie de verdad al traducir.
    const gameIds = new Map([
      [alfa, alfa < beta ? 9 : 2],
      [beta, alfa < beta ? 2 : 9],
    ]);
    const stored = chapterHash(legacyJuneChapter(gameIds));
    const snapshot = loadMemoryFactsSnapshot(fx.ctx);
    const chapter = memoryChapterFor(snapshot, JUNE, NOW);
    assert.ok(chapter);
    // Con los ids nuevos la firma antigua no casa: por eso hace falta esto.
    assert.notEqual(chapterSignature(chapter), stored);

    const check = recheckMemorySignature(
      snapshot,
      { scopeType: 'month', scopeKey: '2025-06', sourceHash: stored },
      { now: NOW, legacyGameIds: gameIds },
    );
    assert.deepEqual(check, {
      status: 'match',
      ids: 'legacy',
      generation: 'noAchievements',
      sourceHash: chapterSignature(chapter),
    });
  });

  it('recap 1.x sellado con la firma anterior (sin decisiones): se resella en esa generación', () => {
    const { alfa, beta } = seedJune();
    const gameIds = new Map([
      [alfa, 1],
      [beta, 2],
    ]);
    const stored = legacyChapterHash(legacyJuneChapter(gameIds));
    const snapshot = loadMemoryFactsSnapshot(fx.ctx);
    const check = recheckMemorySignature(
      snapshot,
      { scopeType: 'month', scopeKey: '2025-06', sourceHash: stored },
      { now: NOW, legacyGameIds: gameIds },
    );
    const chapter = memoryChapterFor(snapshot, JUNE, NOW);
    assert.ok(chapter);
    assert.deepEqual(check, {
      status: 'match',
      ids: 'legacy',
      generation: 'noDecisions',
      sourceHash: chapterSignature(chapter, 'noDecisions'),
    });
  });

  it('recap ya sellado en 2.0: casa sin necesidad del mapa', () => {
    seedJune();
    const snapshot = loadMemoryFactsSnapshot(fx.ctx);
    const chapter = memoryChapterFor(snapshot, JUNE, NOW);
    assert.ok(chapter);
    const sourceHash = chapterSignature(chapter);
    assert.deepEqual(
      recheckMemorySignature(
        snapshot,
        { scopeType: 'month', scopeKey: '2025-06', sourceHash },
        {
          now: NOW,
        },
      ),
      { status: 'match', ids: 'v2', generation: 'noAchievements', sourceHash },
    );
  });

  it('hechos distintos (recap ya obsoleto en la 1.x): no casa y hay que dejar la firma vieja', () => {
    const { alfa, beta } = seedJune();
    const gameIds = new Map([
      [alfa, 1],
      [beta, 2],
    ]);
    const stored = chapterHash(legacyJuneChapter(gameIds));
    // Después de sellar, aparece otra sesión en junio.
    const otro = seedGame(fx.ctx, { title: 'Gamma' });
    seedSession(fx.ctx, {
      playthroughId: seedPlaythrough(fx.ctx, { gameId: otro }),
      startedAt: new Date('2025-06-15T10:00:00'),
    });
    const snapshot = loadMemoryFactsSnapshot(fx.ctx);
    const check = recheckMemorySignature(
      snapshot,
      { scopeType: 'month', scopeKey: '2025-06', sourceHash: stored },
      { now: NOW, legacyGameIds: new Map([...gameIds, [otro, 3]]) },
    );
    assert.equal(check.status, 'mismatch');
  });

  it('un juego del capítulo sin id 1.x: no se puede comparar', () => {
    const { alfa } = seedJune();
    const check = recheckMemorySignature(
      loadMemoryFactsSnapshot(fx.ctx),
      { scopeType: 'month', scopeKey: '2025-06', sourceHash: 'vieja' },
      { now: NOW, legacyGameIds: new Map([[alfa, 1]]) },
    );
    assert.equal(check.status, 'mismatch');
    assert.equal(check.status === 'mismatch' && check.unmappedGameIds?.length, 1);
  });

  it('periodo sin nada que contar y clave rota', () => {
    seedJune();
    const snapshot = loadMemoryFactsSnapshot(fx.ctx);
    assert.deepEqual(
      recheckMemorySignature(
        snapshot,
        { scopeType: 'month', scopeKey: '2025-08', sourceHash: 'x' },
        { now: NOW },
      ),
      { status: 'no_chapter' },
    );
    assert.deepEqual(
      recheckMemorySignature(
        snapshot,
        { scopeType: 'month', scopeKey: 'junio', sourceHash: 'x' },
        { now: NOW },
      ),
      { status: 'invalid_scope' },
    );
  });
});

describe('recheckStoredMemorySignatures', () => {
  it('recorre los recaps de la base con el mapa de local_legacy_ids, sin escribir', () => {
    const { alfa, beta } = seedJune();
    const gameIds = new Map([
      [alfa, 41],
      [beta, 40],
    ]);
    writeLegacyIds(gameIds);
    const stored = chapterHash(legacyJuneChapter(gameIds));
    const base = { payload, model: 'm', promptVersion: 5 };
    insertMemory(fx.ctx, { ...base, scopeType: 'month', scopeKey: '2025-06', sourceHash: stored });
    insertMemory(fx.ctx, { ...base, scopeType: 'year', scopeKey: '2025', sourceHash: 'obsoleta' });

    const results = recheckStoredMemorySignatures(fx.ctx, { now: NOW });
    assert.deepEqual(
      results.map((r) => [r.id, r.check.status]),
      [
        ['month:2025-06', 'match'],
        ['year:2025', 'mismatch'],
      ],
    );
    // No escribe: la firma guardada sigue siendo la 1.x.
    assert.equal(results[0]?.storedHash, stored);
    assert.equal(recheckStoredMemorySignatures(fx.ctx, { now: NOW })[0]?.storedHash, stored);
  });
});
