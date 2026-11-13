import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlanMailboxEntry } from '../../planMailbox';
import { sortUpNext } from '../../planShelves';
import type { PlanShelfReaders } from '../../planShelves';
import {
  applyPendingPlanEntries,
  isCrediblePinStamp,
  mailboxPinStamp,
  planWaitingSince,
  redistributePinStamps,
} from '../planOrder';
import type { PendingPlanEntry, PinnedPlanRow } from '../planOrder';

// Las reglas del orden del Plan, ya en UN solo sitio. Los casos de la vista
// previa del buzón vienen de web/src/lib/__tests__/planPending.test.ts, que
// probaba la copia de la PWA: ahora que no hay copia, se prueban aquí contra la
// función que usan el escritorio, el drenado y la PWA.

type Juego = PinnedPlanRow & { title: string };

const juego = (id: number, title: string, pinnedAt: number | null = null): Juego => ({
  id,
  title,
  pinnedAt,
});

const orden = (id: number, entry: PlanMailboxEntry): PendingPlanEntry => ({ id, entry });

// Los mismos accesos que PlanScreen: el orden de Up next se comprueba con la
// función compartida que de verdad pinta la estantería.
const LEE: PlanShelfReaders<Juego> = {
  pinnedAt: (game) => game.pinnedAt,
  title: (game) => game.title,
  // Nada de esto ha salido en el futuro: aquí no se prueba el horizonte.
  unreleased: () => false,
  releaseSortKey: () => 0,
};

const pinDe = (games: Juego[], id: number): number | null =>
  games.find((game) => game.id === id)?.pinnedAt ?? null;

const T10 = new Date('2026-01-10T10:00:00Z').getTime();
const T12 = new Date('2026-01-10T12:00:00Z').getTime();
// Un "ahora" fijo y muy posterior: si alguna previsión sellara con él sin
// deber, la igualdad con T10/T12 se caería.
const AHORA = new Date('2026-06-01T00:00:00Z').getTime();

describe('redistributePinStamps: reordenar reparte las marcas que ya existen', () => {
  it('reparte el mismo multiset en el orden pedido sin mutar las filas', () => {
    const rows = Object.freeze([
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: 200 },
      { id: 3, pinnedAt: 300 },
    ]);
    const before = structuredClone(rows);
    assert.deepEqual(
      [...redistributePinStamps(rows, [3, 1, 2])],
      [
        [3, 100],
        [1, 200],
        [2, 300],
      ],
    );
    assert.deepEqual(rows, before);
  });

  it('menos de dos fijados (tras deduplicar e ignorar desconocidos) no es un reorden', () => {
    const rows = [
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: null },
    ];
    for (const ids of [[], [1], [1, 1], [2, 99], [1, 2, 99, 1]]) {
      assert.equal(redistributePinStamps(rows, ids).size, 0, `ids ${JSON.stringify(ids)}`);
    }
  });

  it('ignora soltados y borrados, y un repetido conserva su PRIMERA posición', () => {
    const rows = [
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: 200 },
      { id: 3, pinnedAt: null },
      { id: 4, pinnedAt: 400 },
    ];
    assert.deepEqual(
      [...redistributePinStamps(rows, [2, 99, 3, 2, 1])],
      [
        [2, 100],
        [1, 200],
      ],
    );
  });

  it('dos marcas en el mismo milisegundo salen estrictamente crecientes', () => {
    const rows = [
      { id: 1, pinnedAt: 100 },
      { id: 2, pinnedAt: 100 },
      { id: 3, pinnedAt: 101 },
      { id: 4, pinnedAt: 104 },
    ];
    assert.deepEqual(
      [...redistributePinStamps(rows, [4, 3, 2, 1])],
      [
        [4, 100],
        [3, 101],
        [2, 102],
        [1, 104],
      ],
    );
  });
});

describe('la marca de un pin del buzón: el mismo criterio en los tres lados', () => {
  it('solo un número finito y positivo es un instante creíble', () => {
    for (const valor of [1, T10, Number.MAX_SAFE_INTEGER])
      assert.equal(isCrediblePinStamp(valor), true);
    for (const valor of [0, -1, NaN, Infinity, '1700000000000', null, undefined]) {
      assert.equal(isCrediblePinStamp(valor), false, `aceptó ${String(valor)}`);
    }
  });

  it('con marca creíble sella con la del gesto; si no, con "ahora" (como setPlanPinned)', () => {
    assert.equal(mailboxPinStamp(T10, AHORA), T10);
    assert.equal(mailboxPinStamp(0, AHORA), AHORA);
    assert.equal(mailboxPinStamp(NaN, AHORA), AHORA);
  });
});

describe('vista previa del buzón: el plan tal y como lo dejará el drenado', () => {
  it('un pin pendiente se previsualiza con su propio pinnedAt, no con "ahora"', () => {
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda')],
      [orden(1, { type: 'pin', gameId: 1, pinnedAt: T10 })],
      AHORA,
    );
    assert.equal(pinDe(overlay.games, 1), T10);
    assert.ok(overlay.touched.has(1), 'el juego tocado tiene que marcarse como pendiente');
  });

  it('el orden previsto es el que aplicará el PC, no el del render', () => {
    // Zelda se fijó en el teléfono a las 10:00 y quedó sin drenar; Alan Wake se
    // fijó desde el PC a las 12:00. Sellar el pendiente con "ahora" lo pondría
    // el último y la fila saltaría al drenar.
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda'), juego(2, 'Alan Wake', T12)],
      [orden(1, { type: 'pin', gameId: 1, pinnedAt: T10 })],
      AHORA,
    );
    assert.deepEqual(
      sortUpNext(overlay.games, LEE).map((game) => game.id),
      [1, 2],
    );
  });

  it('dos pines pendientes conservan SU separación, sin empatar al milisegundo', () => {
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda'), juego(2, 'Alan Wake')],
      [
        orden(1, { type: 'pin', gameId: 1, pinnedAt: T10 }),
        orden(2, { type: 'pin', gameId: 2, pinnedAt: T10 + 600_000 }),
      ],
      AHORA,
    );
    assert.notEqual(pinDe(overlay.games, 1), pinDe(overlay.games, 2));
    assert.deepEqual(
      sortUpNext(overlay.games, LEE).map((game) => game.id),
      [1, 2],
    );
  });

  it('la última orden sobre el mismo juego manda, y soltar deja el pin en null', () => {
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda', T10)],
      [orden(1, { type: 'unpin', gameId: 1 }), orden(2, { type: 'pin', gameId: 1, pinnedAt: T12 })],
      AHORA,
    );
    assert.equal(pinDe(overlay.games, 1), T12);

    const soltado = applyPendingPlanEntries(
      [juego(1, 'Zelda', T10)],
      [orden(1, { type: 'unpin', gameId: 1 })],
      AHORA,
    );
    assert.equal(pinDe(soltado.games, 1), null);
  });

  it('un reorden pendiente reparte las marcas que YA existen, sin inventar ninguna', () => {
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda', T10), juego(2, 'Alan Wake', T12)],
      [orden(1, { type: 'reorder', orderedIds: [2, 1] })],
      AHORA,
    );
    assert.equal(pinDe(overlay.games, 2), T10);
    assert.equal(pinDe(overlay.games, 1), T12);
    assert.deepEqual(
      sortUpNext(overlay.games, LEE).map((game) => game.id),
      [2, 1],
    );
  });

  it('el reorden ve lo que dejaron las órdenes anteriores, como en el drenado', () => {
    // Soltar B antes del reorden deja un solo fijado: el escritorio devolvería
    // false (fallo) y no tocaría nada, y la vista previa no puede prever otra
    // cosa.
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda', T10), juego(2, 'Alan Wake', T12)],
      [orden(1, { type: 'unpin', gameId: 2 }), orden(2, { type: 'reorder', orderedIds: [2, 1] })],
      AHORA,
    );
    assert.equal(pinDe(overlay.games, 1), T10);
    assert.equal(pinDe(overlay.games, 2), null);
  });

  it('un pin con marca no creíble se prevé con "ahora", que es lo que hará el drenado', () => {
    // El Worker ya rechaza estas órdenes; aquí se fija que, si alguna llegara,
    // la vista previa y el drenado (pinStamp → setPlanPinned sin marca) coinciden.
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda')],
      [orden(1, { type: 'pin', gameId: 1, pinnedAt: 0 })],
      AHORA,
    );
    assert.equal(pinDe(overlay.games, 1), AHORA);
  });

  it('las altas salen como fantasmas y un tipo desconocido se ignora sin reventar', () => {
    const desconocida = { type: 'archive', gameId: 1 } as unknown as PlanMailboxEntry;
    const overlay = applyPendingPlanEntries(
      [juego(1, 'Zelda', T10)],
      [
        orden(7, {
          type: 'add',
          source: { igdbId: 3 },
          title: 'Celeste',
          coverUrl: null,
          note: null,
        }),
        orden(8, desconocida),
      ],
      AHORA,
    );
    assert.deepEqual(overlay.ghosts, [{ mailboxId: 7, title: 'Celeste', coverUrl: null }]);
    assert.equal(pinDe(overlay.games, 1), T10);
    assert.equal(overlay.touched.size, 0);
  });
});

describe('planWaitingSince: desde cuándo espera un planeado', () => {
  it('la primera entrada en el Plan manda; sin ella, el alta', () => {
    assert.equal(planWaitingSince(T12, null), T12);
    assert.equal(planWaitingSince(T12, T10), T10);
    // La subconsulta cruda puede volver como texto según el driver.
    assert.equal(planWaitingSince(T12, String(T10)), T10);
  });
});
