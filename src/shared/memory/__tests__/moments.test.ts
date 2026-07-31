import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MemorySession } from '../moments';
import {
  deriveMoments,
  LONGEST_MIN_PRIOR_SESSIONS,
  momentsBySession,
  RETURN_GAP_DAYS,
} from '../moments';

// Fábrica de sesiones medidas: fechas legibles, duración en horas, y el fin
// calculado del tirón — los tests hablan de jugadas, no de milisegundos.
let nextId = 1;
const session = (
  gameId: number,
  startedAt: string,
  hours: number,
  overrides: Partial<MemorySession> = {},
): MemorySession => {
  const start = new Date(startedAt);
  return {
    id: nextId++,
    gameId,
    startedAt: start,
    endedAt: new Date(start.getTime() + hours * 3600 * 1000),
    durationSec: Math.round(hours * 3600),
    isManual: false,
    ...overrides,
  };
};

describe('deriveMoments', () => {
  it('marca la primera sesión medida de cada juego, y solo esa', () => {
    const sessions = [
      session(1, '2026-01-10T18:00', 2),
      session(1, '2026-01-11T18:00', 1),
      session(2, '2026-02-01T20:00', 3),
    ];
    const firsts = deriveMoments(sessions).filter((m) => m.type === 'first_session');
    assert.equal(firsts.length, 2);
    assert.deepEqual(
      firsts.map((m) => m.gameId),
      [1, 2],
    );
    assert.equal(firsts[0].sessionId, sessions[0].id);
  });

  it('una sesión manual no puede ser la primera — la primera medida se lo lleva', () => {
    const manual = session(1, '2025-06-01T00:00', 40, { isManual: true });
    const real = session(1, '2026-01-10T18:00', 2);
    const firsts = deriveMoments([manual, real]).filter((m) => m.type === 'first_session');
    assert.equal(firsts.length, 1);
    assert.equal(firsts[0].sessionId, real.id);
  });

  it('detecta un regreso tras el hueco mínimo, y calla por debajo', () => {
    const a = session(1, '2026-01-10T18:00', 2);
    const backSoon = session(1, '2026-03-01T18:00', 1); // ~50 días — no
    const backLate = session(1, '2026-07-15T18:00', 1); // ~136 días — sí
    const returns = deriveMoments([a, backSoon, backLate]).filter((m) => m.type === 'return');
    assert.equal(returns.length, 1);
    assert.equal(returns[0].sessionId, backLate.id);
    assert.ok(returns[0].awayDays >= RETURN_GAP_DAYS);
  });

  it('el récord de duración solo existe con historial suficiente detrás', () => {
    // Cinco sesiones de 1h: ninguna puede ser récord todavía (las primeras
    // partidas siempre "baten" algo y eso no es noticia).
    const warmup = Array.from({ length: LONGEST_MIN_PRIOR_SESSIONS }, (_, i) =>
      session(1, `2026-01-${String(i + 1).padStart(2, '0')}T18:00`, 1),
    );
    const record = session(1, '2026-02-01T18:00', 4);
    const tie = session(1, '2026-02-02T18:00', 4); // empatar no es batir
    const moments = deriveMoments([...warmup, record, tie]);
    const records = moments.filter((m) => m.type === 'longest_session');
    assert.equal(records.length, 1);
    assert.equal(records[0].sessionId, record.id);
    assert.equal(records[0].previousBestSec, 3600);
  });

  it('cruzar horas anuncia solo el umbral más alto de la pasada', () => {
    const grind = session(1, '2026-01-10T00:00', 24); // 0 → 24h: nada
    const marathon = session(1, '2026-01-20T00:00', 30); // 24 → 54h: cruza 25 y 50
    const hits = deriveMoments([grind, marathon]).filter((m) => m.type === 'hours_milestone');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hours, 50);
    assert.equal(hits[0].sessionId, marathon.id);
  });

  it('las horas manuales elevan la línea base: no se celebra lo ya jugado', () => {
    const short = session(1, '2026-01-10T18:00', 2); // 24 → 26h con base 24
    const hits = deriveMoments([short], new Map([[1, 24]])).filter(
      (m) => m.type === 'hours_milestone',
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].hours, 25);
  });

  it('una sesión manual acumula horas pero no protagoniza el hito', () => {
    const manualGrind = session(1, '2026-01-05T00:00', 30, { isManual: true });
    const after = session(1, '2026-01-10T18:00', 1);
    const hits = deriveMoments([manualGrind, after]).filter((m) => m.type === 'hours_milestone');
    // La manual cruzó las 25 pero no puede ser momento; la medida posterior
    // ya está por encima del umbral, así que tampoco lo cruza. Silencio.
    assert.equal(hits.length, 0);
  });

  it('la sesión nº 25 es un hito; una abierta no cuenta para nada', () => {
    const many = Array.from({ length: 24 }, (_, i) =>
      session(1, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}:00`, 0.5),
    );
    const open = session(1, '2026-02-01T18:00', 1, { endedAt: null, durationSec: null });
    const twentyFifth = session(1, '2026-02-02T18:00', 0.5);
    const hits = deriveMoments([...many, open, twentyFifth]).filter(
      (m) => m.type === 'sessions_milestone',
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].count, 25);
    assert.equal(hits[0].sessionId, twentyFifth.id);
  });

  it('momentsBySession agrupa varios momentos de la misma sesión', () => {
    // Base manual de 24h: la primera sesión medida es a la vez
    // first_session y cruce de las 25h.
    const first = session(1, '2026-01-10T18:00', 2);
    const map = momentsBySession(deriveMoments([first], new Map([[1, 24]])));
    assert.equal(map.get(first.id)?.length, 2);
  });
});
