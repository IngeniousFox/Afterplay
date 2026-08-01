import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Chapter, ChapterStateEvent } from '../chapters';
import {
  buildChapter,
  canonicalChapterFacts,
  listClosedPeriodsWithActivity,
  scopeKeyOf,
  scopeRange,
} from '../chapters';
import type { MemorySession } from '../moments';
import { deriveMoments } from '../moments';

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

const completed = (gameId: number, occurredAt: string): ChapterStateEvent => ({
  gameId,
  type: 'completed',
  occurredAt: new Date(occurredAt),
});

const stateChange = (gameId: number, type: string, occurredAt: string): ChapterStateEvent => ({
  gameId,
  type,
  occurredAt: new Date(occurredAt),
});

const TITLES = new Map([
  [1, 'Hollow Knight'],
  [2, 'Outer Wilds'],
]);

const NOW = new Date('2026-07-15T12:00');

describe('scopeKeyOf / scopeRange', () => {
  it('genera las claves del contrato de la tabla', () => {
    assert.equal(scopeKeyOf({ type: 'month', year: 2026, month: 5 }), '2026-06');
    assert.equal(scopeKeyOf({ type: 'year', year: 2026 }), '2026');
  });

  it('el rango de un mes es [día 1, día 1 del siguiente) en hora local', () => {
    const { start, end } = scopeRange({ type: 'month', year: 2026, month: 11 });
    assert.equal(start.getTime(), new Date(2026, 11, 1).getTime());
    assert.equal(end.getTime(), new Date(2027, 0, 1).getTime());
  });
});

describe('buildChapter', () => {
  it('agrega horas, sesiones, dominante y completados del mes', () => {
    const sessions = [
      session(1, '2026-06-05T18:00', 2),
      session(1, '2026-06-10T18:00', 3),
      session(2, '2026-06-12T18:00', 1),
      session(2, '2026-07-01T18:00', 5), // fuera del mes
    ];
    const events = [completed(1, '2026-06-20T21:00')];
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 5 },
      sessions,
      events,
      TITLES,
      deriveMoments(sessions),
      NOW,
    );
    assert.ok(chapter);
    assert.equal(chapter.scopeKey, '2026-06');
    assert.equal(chapter.soFar, false);
    assert.equal(chapter.sessionCount, 3);
    assert.equal(Math.round(chapter.hours), 6);
    assert.equal(chapter.dominant?.gameId, 1);
    assert.equal(chapter.dominant?.title, 'Hollow Knight');
    assert.equal(chapter.completions.length, 1);
    // Los momentos del capítulo son solo los que cayeron dentro: las dos
    // first_session de junio, no la actividad de julio.
    assert.ok(chapter.moments.every((m) => m.occurredAt.getMonth() === 5));
  });

  it('un periodo sin nada que contar devuelve null, no un capítulo vacío', () => {
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 2 },
      [session(1, '2026-06-05T18:00', 2)],
      [],
      TITLES,
      [],
      NOW,
    );
    assert.equal(chapter, null);
  });

  it('un completado sin sesiones sí es historia (mes de rematar, no de jugar)', () => {
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 2 },
      [],
      [completed(2, '2026-03-08T10:00')],
      TITLES,
      [],
      NOW,
    );
    assert.ok(chapter);
    assert.equal(chapter.sessionCount, 0);
    assert.equal(chapter.completions[0].title, 'Outer Wilds');
  });

  it('el mes en curso existe pero queda marcado soFar', () => {
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 6 },
      [session(1, '2026-07-02T18:00', 2)],
      [],
      TITLES,
      [],
      NOW,
    );
    assert.ok(chapter);
    assert.equal(chapter.soFar, true);
  });

  it('las sesiones manuales no cuentan en el capítulo', () => {
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 5 },
      [session(1, '2026-06-05T00:00', 40, { isManual: true })],
      [],
      TITLES,
      [],
      NOW,
    );
    assert.equal(chapter, null);
  });

  it('un mes de solo DECISIONES es historia (empezar y soltar, sin cronómetro)', () => {
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 2 },
      [],
      [
        stateChange(1, 'started', '2026-03-04T20:00'),
        stateChange(2, 'dropped', '2026-03-19T22:00'),
      ],
      TITLES,
      [],
      NOW,
    );
    assert.ok(chapter);
    assert.equal(chapter.sessionCount, 0);
    assert.equal(chapter.completions.length, 0);
    assert.deepEqual(
      chapter.stateChanges.map((change) => `${change.type}:${change.title}`),
      ['started:Hollow Knight', 'dropped:Outer Wilds'],
    );
  });

  it('los completados no se duplican como cambio de estado', () => {
    const chapter = buildChapter(
      { type: 'month', year: 2026, month: 2 },
      [],
      [completed(2, '2026-03-08T10:00'), stateChange(1, 'on_hold', '2026-03-09T10:00')],
      TITLES,
      [],
      NOW,
    );
    assert.ok(chapter);
    assert.equal(chapter.completions.length, 1);
    assert.deepEqual(
      chapter.stateChanges.map((change) => change.type),
      ['on_hold'],
    );
  });
});

describe('listClosedPeriodsWithActivity', () => {
  it('enumera meses cerrados con actividad y deja fuera el mes en curso', () => {
    const sessions = [
      session(1, '2025-11-05T18:00', 2),
      session(1, '2026-06-10T18:00', 3),
      session(2, '2026-07-02T18:00', 1), // mes en curso — fuera
    ];
    const { months, years } = listClosedPeriodsWithActivity(sessions, [], NOW);
    assert.deepEqual(
      months.map((scope) => scopeKeyOf(scope)),
      ['2025-11', '2026-06'],
    );
    // 2026 sigue abierto: solo 2025 es un año cerrado con actividad.
    assert.deepEqual(
      years.map((scope) => scopeKeyOf(scope)),
      ['2025'],
    );
  });

  it('un completado sin sesiones también marca actividad en su mes', () => {
    const { months } = listClosedPeriodsWithActivity([], [completed(1, '2026-03-08T10:00')], NOW);
    assert.deepEqual(
      months.map((scope) => scopeKeyOf(scope)),
      ['2026-03'],
    );
  });

  // La regresión que motivó el cambio: 48 meses cerrados solo tenían
  // decisiones (empezar/aparcar/soltar) y eran invisibles para el Loop —
  // el Journey les abría página y Ajustes no los ofrecía jamás.
  it('un cambio de estado cualquiera también abre mes', () => {
    const { months } = listClosedPeriodsWithActivity(
      [],
      [
        stateChange(1, 'started', '2026-02-11T20:00'),
        stateChange(2, 'dropped', '2026-04-02T20:00'),
      ],
      NOW,
    );
    assert.deepEqual(
      months.map((scope) => scopeKeyOf(scope)),
      ['2026-02', '2026-04'],
    );
  });
});

describe('canonicalChapterFacts', () => {
  const build = (sessions: MemorySession[]): Chapter | null =>
    buildChapter(
      { type: 'month', year: 2026, month: 5 },
      sessions,
      [],
      TITLES,
      deriveMoments(sessions),
      NOW,
    );

  it('mismos hechos → misma cadena, aunque el orden de entrada cambie', () => {
    const a = session(1, '2026-06-05T18:00', 2);
    const b = session(2, '2026-06-12T18:00', 1);
    const one = build([a, b]);
    const two = build([b, a]);
    assert.ok(one && two);
    assert.equal(canonicalChapterFacts(one), canonicalChapterFacts(two));
  });

  it('corregir el pasado cambia la cadena — que es lo que dispara el stale', () => {
    const a = session(1, '2026-06-05T18:00', 2);
    const before = build([a]);
    const after = build([{ ...a, durationSec: a.durationSec! + 1800 }]);
    assert.ok(before && after);
    assert.notEqual(canonicalChapterFacts(before), canonicalChapterFacts(after));
  });

  // La firma ANTIGUA (withStateChanges=false) existe para que los recaps
  // escritos antes de que las decisiones fueran hechos no aparezcan
  // obsoletos de golpe — status.ts acepta las dos. Queda congelada: si
  // alguien la "mejora", cientos de recaps vigentes se marcan obsoletos.
  it('la firma antigua ignora las decisiones; la nueva no', () => {
    const withDecisions = buildChapter(
      { type: 'month', year: 2026, month: 5 },
      [session(1, '2026-06-05T18:00', 2)],
      [stateChange(2, 'dropped', '2026-06-09T20:00')],
      TITLES,
      [],
      NOW,
    );
    const withoutDecisions = buildChapter(
      { type: 'month', year: 2026, month: 5 },
      [session(1, '2026-06-05T18:00', 2)],
      [],
      TITLES,
      [],
      NOW,
    );
    assert.ok(withDecisions && withoutDecisions);
    // Con la firma vieja, los mismos hechos de siempre dan lo mismo…
    assert.equal(
      canonicalChapterFacts(withDecisions, false),
      canonicalChapterFacts(withoutDecisions, false),
    );
    // …y con la nueva, la decisión sí cuenta.
    assert.notEqual(canonicalChapterFacts(withDecisions), canonicalChapterFacts(withoutDecisions));
  });

  it('el ruido flotante de sumar en otro orden no ensucia el hash', () => {
    // Tres duraciones que en coma flotante suman distinto según el orden.
    const durations = [0.1, 0.2, 0.3].map((h) => Math.round(h * 3600));
    const forward = durations.map((sec, i) =>
      session(1, `2026-06-0${i + 1}T18:00`, 0, { durationSec: sec }),
    );
    const backward = [...forward].reverse();
    const one = build(forward);
    const two = build(backward);
    assert.ok(one && two);
    assert.equal(canonicalChapterFacts(one), canonicalChapterFacts(two));
  });
});

// Horas manuales ("I played this before") ancladas a un periodo — la misma
// atribución que Stats y el Journey (manualHoursAnchor), aplicada al capítulo.
describe('buildChapter con bloques manuales', () => {
  const JUNE: Parameters<typeof buildChapter>[0] = { type: 'month', year: 2026, month: 5 };

  it('un mes cuyo único contenido son horas manuales también tiene historia', () => {
    const chapter = buildChapter(JUNE, [], [], TITLES, [], NOW, [
      { gameId: 1, hours: 30, anchor: new Date('2026-06-20T00:00') },
    ]);
    assert.ok(chapter);
    assert.equal(chapter.hours, 30);
    assert.equal(chapter.manualHours, 30);
    assert.equal(chapter.sessionCount, 0);
    assert.equal(chapter.dominant?.gameId, 1);
    assert.equal(chapter.games[0].manualHours, 30);
  });

  it('sin ancla, o anclado fuera del mes, no cuenta', () => {
    const chapter = buildChapter(JUNE, [], [], TITLES, [], NOW, [
      { gameId: 1, hours: 30, anchor: null },
      { gameId: 2, hours: 10, anchor: new Date('2026-07-02T00:00') },
    ]);
    assert.equal(chapter, null);
  });

  it('se suma a las sesiones medidas del mismo juego, desglosado aparte', () => {
    const tracked = session(1, '2026-06-05T18:00', 2);
    const chapter = buildChapter(JUNE, [tracked], [], TITLES, [], NOW, [
      { gameId: 1, hours: 30, anchor: new Date('2026-06-20T00:00') },
    ]);
    assert.ok(chapter);
    assert.equal(Math.round(chapter.hours), 32);
    assert.equal(chapter.games[0].sessionCount, 1);
    assert.equal(chapter.games[0].manualHours, 30);
  });

  it('marca actividad para la detección y el backfill', () => {
    const { months } = listClosedPeriodsWithActivity([], [], NOW, [
      { gameId: 1, hours: 30, anchor: new Date('2026-04-10T00:00') },
    ]);
    assert.deepEqual(
      months.map((scope) => scopeKeyOf(scope)),
      ['2026-04'],
    );
  });

  it('cambiar las horas manuales cambia el hash — el recap pasa a stale', () => {
    const withHours = (hours: number): Chapter | null =>
      buildChapter(JUNE, [], [], TITLES, [], NOW, [
        { gameId: 1, hours, anchor: new Date('2026-06-20T00:00') },
      ]);
    const before = withHours(30);
    const after = withHours(45);
    assert.ok(before && after);
    assert.notEqual(canonicalChapterFacts(before), canonicalChapterFacts(after));
  });
});
