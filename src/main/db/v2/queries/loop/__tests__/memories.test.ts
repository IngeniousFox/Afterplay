import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { RecapPayload } from '../../../../../../shared/memory/payload';
import {
  asOtherDevice,
  at,
  day,
  hours,
  insertSynced,
  openQueryDb,
  seedCatalog,
  seedEmulator,
  seedGame,
  seedPlaythrough,
  seedSession,
  seedStateEvent,
  seedUnlock,
  tombstoneOnly,
  type QueryFixture,
} from '../../common/__tests__/fixtures';
import { getLatestMemories, getMemory, getMemoryFacts, insertMemory } from '../memories';

// Hechos del Loop y recaps guardados sobre el esquema 2.0. Los dos primeros
// casos son los de `src/main/db/__tests__/manualHoursTotals.test.ts` (parte de
// getMemoryFacts); el resto, lo propio del 2.0: F-11, `'unknown'` (R-07),
// sesiones `legacy_manual`, desbloqueos del catálogo en JSON y recaps por id.

let fx: QueryFixture;
beforeEach(() => {
  fx = openQueryDb();
});
afterEach(() => fx.close());

const payload = (headline: string): RecapPayload =>
  ({ headline, narrative: 'Texto inventado.' }) as unknown as RecapPayload;

describe('getMemoryFacts: horas manuales con la misma pista que Stats (1.x)', () => {
  it('sin log de estados, el ancla es la PRIMERA sesión del playthrough', () => {
    const juego = seedGame(fx.ctx, { title: 'Detectado por el watcher' });
    const pt = seedPlaythrough(fx.ctx, { gameId: juego, manualHours: 50 });
    seedSession(fx.ctx, { playthroughId: pt, startedAt: new Date('2025-05-10T20:00:00') });
    seedSession(fx.ctx, { playthroughId: pt, startedAt: new Date('2025-03-02T18:00:00') });

    const facts = getMemoryFacts(fx.ctx);
    assert.deepEqual(facts.manualBlocks, [
      { gameId: juego, hours: 50, anchor: new Date('2025-03-02T18:00:00') },
    ]);
    assert.deepEqual([...facts.manualHoursByGame], [[juego, 50]]);
  });

  it('el log manda mientras diga algo: con un final tecleado, la sesión no pinta nada', () => {
    const juego = seedGame(fx.ctx, { title: 'Terminado en enero' });
    const pt = seedPlaythrough(fx.ctx, { gameId: juego, manualHours: 30 });
    seedSession(fx.ctx, { playthroughId: pt, startedAt: new Date('2026-04-01T12:00:00') });
    seedStateEvent(fx.ctx, {
      playthroughId: pt,
      type: 'completed',
      occurredAt: new Date('2026-01-20T18:00:00'),
    });

    assert.deepEqual(getMemoryFacts(fx.ctx).manualBlocks, [
      { gameId: juego, hours: 30, anchor: new Date('2026-01-20T18:00:00') },
    ]);
  });
});

describe('getMemoryFacts: forma 2.0', () => {
  it("los eventos viajan con datePrecision y sin addedAt/promotedAt; 'unknown' no ancla (R-07)", () => {
    const juego = seedGame(fx.ctx, { title: 'Alta con estado' });
    const pt = seedPlaythrough(fx.ctx, { gameId: juego, manualHours: 12 });
    // El papeleo del alta: un "completado" sin fecha conocida.
    seedStateEvent(fx.ctx, {
      playthroughId: pt,
      type: 'completed',
      occurredAt: at(0),
      datePrecision: 'unknown',
    });
    seedSession(fx.ctx, { playthroughId: pt, startedAt: day(10) });

    const facts = getMemoryFacts(fx.ctx);
    assert.deepEqual(facts.events, [
      { gameId: juego, type: 'completed', occurredAt: at(0), datePrecision: 'unknown' },
    ]);
    assert.equal('addedAt' in (facts.events[0] as object), false);
    assert.equal('promotedAt' in (facts.events[0] as object), false);
    // Sin el evento de papeleo, el ancla cae a la primera sesión.
    assert.deepEqual(facts.manualBlocks, [{ gameId: juego, hours: 12, anchor: day(10) }]);
  });

  it('sesiones: las de cualquier PC; sin asignar fuera; legacy_manual es isManual', () => {
    const juego = seedGame(fx.ctx, { title: 'Hollow Knight' });
    const pt = seedPlaythrough(fx.ctx, { gameId: juego });
    const propia = seedSession(fx.ctx, { playthroughId: pt, startedAt: day(1) });
    const ajena = asOtherDevice(fx.ctx).seedSession({ playthroughId: pt, startedAt: day(2) });
    const emu = seedEmulator(fx.ctx, { name: 'RetroArch' });
    seedSession(fx.ctx, { emulatorId: emu, startedAt: day(3) });
    const manual = insertSynced(fx.ctx, 'sessions', {
      playthroughId: pt,
      deviceId: fx.ctx.deviceId,
      startedBy: 'watcher',
      source: 'legacy_manual',
      startedAt: day(4),
      endedAt: day(4),
      durationSec: 7200,
      datePrecision: 'month',
    });

    // Ordenadas aquí: el orden de creación entre filas de la puerta y filas
    // "llegadas por sync" depende de los relojes, y no es lo que se prueba.
    const sessions = getMemoryFacts(fx.ctx).sessions.sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    );
    assert.deepEqual(
      sessions.map((s) => [s.id, s.gameId, s.isManual]),
      [
        [propia, juego, false],
        [ajena, juego, false],
        [manual, juego, true],
      ],
    );
    assert.equal(sessions[0]?.durationSec, hours(1) / 1000);
  });

  it('F-11: nada de un juego o playthrough con lápida, aunque el hijo siga vivo', () => {
    const vivo = seedGame(fx.ctx, { title: 'Vivo' });
    const ptVivo = seedPlaythrough(fx.ctx, { gameId: vivo });
    seedSession(fx.ctx, { playthroughId: ptVivo, startedAt: day(1) });

    const borrado = seedGame(fx.ctx, { title: 'Borrado' });
    const ptBorrado = seedPlaythrough(fx.ctx, { gameId: borrado, manualHours: 9 });
    seedSession(fx.ctx, { playthroughId: ptBorrado, startedAt: day(2) });
    seedStateEvent(fx.ctx, { playthroughId: ptBorrado, type: 'completed', occurredAt: day(2) });
    seedCatalog(fx.ctx, { gameId: borrado });
    seedUnlock(fx.ctx, { gameId: borrado, apiName: 'ACH_1', unlockedAt: day(2) });
    tombstoneOnly(fx.ctx, 'games', borrado);

    // Un playthrough con lápida en un juego vivo.
    const ptSuelto = seedPlaythrough(fx.ctx, { gameId: vivo, manualHours: 4 });
    seedStateEvent(fx.ctx, { playthroughId: ptSuelto, type: 'dropped', occurredAt: day(3) });
    seedSession(fx.ctx, { playthroughId: ptSuelto, startedAt: day(3) });
    tombstoneOnly(fx.ctx, 'playthroughs', ptSuelto);

    const facts = getMemoryFacts(fx.ctx);
    assert.deepEqual(
      facts.sessions.map((s) => s.gameId),
      [vivo],
    );
    assert.deepEqual(facts.events, []);
    assert.deepEqual(facts.manualBlocks, []);
    assert.deepEqual([...facts.titlesByGame], [[vivo, 'Vivo']]);
    assert.deepEqual(facts.unlocks, []);
  });
});

describe('getMemoryFacts: desbloqueos', () => {
  it('fiables, fundidos por logro (orígenes Steam juntos, RA aparte) y con su catálogo', () => {
    const juego = seedGame(fx.ctx, { title: 'Celeste' });
    seedCatalog(fx.ctx, {
      gameId: juego,
      items: [
        {
          apiName: 'SUMMIT',
          displayName: 'Cima',
          description: 'Llegar arriba',
          globalPercent: 4.5,
        },
        { apiName: 'BERRY', displayName: 'Fresa', globalPercent: 60 },
      ],
    });
    seedCatalog(fx.ctx, {
      gameId: juego,
      source: 'ra',
      items: [{ apiName: 'SUMMIT', displayName: 'Cima (RA)' }],
    });
    // El mismo logro de Steam atestiguado por Steam y por un emulador: una fila,
    // la fecha más temprana.
    seedUnlock(fx.ctx, { gameId: juego, apiName: 'SUMMIT', unlockedAt: day(5) });
    seedUnlock(fx.ctx, {
      gameId: juego,
      apiName: 'SUMMIT',
      origin: `emu@${fx.ctx.deviceId}`,
      unlockedAt: day(3),
    });
    // Mismo apiName en RA: otro logro.
    seedUnlock(fx.ctx, { gameId: juego, apiName: 'SUMMIT', source: 'ra', unlockedAt: day(7) });
    // Fecha de rescate: no fabrica historia.
    seedUnlock(fx.ctx, {
      gameId: juego,
      apiName: 'BERRY',
      unlockedAt: day(1),
      dateReliable: false,
    });
    // Sin su logro en el catálogo: fuera, como el inner join de la 1.x.
    seedUnlock(fx.ctx, { gameId: juego, apiName: 'FANTASMA', unlockedAt: day(2) });

    const unlocks = getMemoryFacts(fx.ctx).unlocks.sort(
      (a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime(),
    );
    assert.deepEqual(unlocks, [
      {
        gameId: juego,
        name: 'Cima',
        description: 'Llegar arriba',
        globalPercent: 4.5,
        unlockedAt: day(3),
      },
      {
        gameId: juego,
        name: 'Cima (RA)',
        description: null,
        globalPercent: null,
        unlockedAt: day(7),
      },
    ]);
  });

  it('un catálogo con lápida no da nombre: el desbloqueo no sale', () => {
    const juego = seedGame(fx.ctx, { title: 'Hades' });
    const catalogo = seedCatalog(fx.ctx, { gameId: juego });
    seedUnlock(fx.ctx, { gameId: juego, apiName: 'ACH_1', unlockedAt: day(1) });
    fx.ctx.store.remove('achievement_catalogs', catalogo);
    assert.deepEqual(getMemoryFacts(fx.ctx).unlocks, []);
  });
});

describe('recaps guardados', () => {
  it('insertMemory escribe encima: una fila por periodo, con la fecha de la última escritura', () => {
    const base = {
      scopeType: 'month' as const,
      scopeKey: '2025-06',
      sourceHash: 'firma-1',
      model: 'modelo-a',
      promptVersion: 4,
    };
    const id = insertMemory(fx.ctx, { ...base, payload: payload('Primera') });
    assert.equal(id, 'month:2025-06');
    fx.wall.advance(hours(1));
    insertMemory(fx.ctx, {
      ...base,
      payload: payload('Segunda'),
      sourceHash: 'firma-2',
      promptVersion: 5,
    });

    const all = getLatestMemories(fx.ctx);
    assert.equal(all.length, 1);
    assert.deepEqual(all[0], {
      scopeType: 'month',
      scopeKey: '2025-06',
      payload: payload('Segunda'),
      sourceHash: 'firma-2',
      promptVersion: 5,
      model: 'modelo-a',
      createdAt: at(hours(1)),
    });
    assert.equal(getMemory(fx.ctx, 'month', '2025-06')?.sourceHash, 'firma-2');
    assert.equal(getMemory(fx.ctx, 'month', '2025-07'), null);
  });

  it('getLatestMemories: solo vivos, del más reciente al más antiguo', () => {
    const write = (scopeType: 'month' | 'year', scopeKey: string, createdAt: Date): string =>
      insertMemory(fx.ctx, {
        scopeType,
        scopeKey,
        payload: payload(scopeKey),
        sourceHash: 'h',
        model: 'm',
        promptVersion: 5,
        createdAt,
      });
    write('month', '2025-01', day(1));
    write('year', '2024', day(3));
    const borrado = write('month', '2025-02', day(2));
    fx.ctx.store.remove('generated_memories', borrado);

    assert.deepEqual(
      getLatestMemories(fx.ctx).map((m) => m.scopeKey),
      ['2024', '2025-01'],
    );
    assert.equal(getMemory(fx.ctx, 'month', '2025-02'), null);

    // Regenerar un periodo borrado lo resucita.
    write('month', '2025-02', day(4));
    assert.deepEqual(
      getLatestMemories(fx.ctx).map((m) => m.scopeKey),
      ['2025-02', '2024', '2025-01'],
    );
  });
});
