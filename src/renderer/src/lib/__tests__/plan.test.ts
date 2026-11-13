import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computePlanDebt, filterQueue } from '../../../../shared/planShelves';
import type { PlannedGameItem } from '../../../../shared/types';
import { PLAN_SHELF_READERS, sortByLens, splitPlanSections } from '../plan';
import type { GameId } from '../../../../shared/entityIds';

// El reparto del Plan tal y como lo pide la pantalla del escritorio: las
// estanterías salen de src/shared/planShelves (probadas con valores escritos en
// src/shared/__tests__/planShelves.test.ts) y aquí solo se fija lo que pone
// esta interfaz encima —leer PlannedGameItem con Date y pasar la cola por la
// lente—, con los mismos seis juegos que antes comparaba paridad.test.ts contra
// la copia que había en lib/plan.ts. Los valores esperados son los que daba esa
// copia: el comportamiento del escritorio no debe moverse.

const planeado = (spec: {
  id: number;
  title: string;
  fijado?: string | null;
  // Fechas MUY lejanas a propósito: isUnreleased mira el reloj de verdad.
  sale?: { iso: string; precision: 'year' | 'month' | 'day' } | null;
  hltbMain?: number | null;
  endless?: boolean;
}): PlannedGameItem => {
  const sale = spec.sale ? new Date(spec.sale.iso) : null;
  // Solo lleva lo que el reparto y las lentes miran; el resto de
  // PlannedGameItem no lo toca nadie aquí. Cada uno con SU día de alta, que es
  // por lo que ordenan "longest waiting" y "just added".
  return {
    id: spec.id,
    title: spec.title,
    planPinnedAt: spec.fijado ? new Date(spec.fijado) : null,
    releaseDate: sale,
    releaseDatePrecision: spec.sale ? spec.sale.precision : null,
    releaseYear: sale ? sale.getFullYear() : null,
    hltbMain: spec.hltbMain ?? null,
    endless: spec.endless ?? false,
    addedAt: new Date(2026, 0, spec.id),
  } as unknown as PlannedGameItem;
};

const juegos = [
  planeado({
    id: 2,
    title: 'Hollow Knight II',
    fijado: '2026-01-10T12:00',
    sale: { iso: '2099-06-15T00:00', precision: 'day' },
  }),
  planeado({
    id: 3,
    title: 'Celeste',
    sale: { iso: '2018-01-25T00:00', precision: 'day' },
    hltbMain: 8,
  }),
  planeado({
    id: 1,
    title: 'Zelda',
    fijado: '2026-01-10T10:00',
    sale: { iso: '2017-03-03T00:00', precision: 'day' },
    hltbMain: 20,
  }),
  planeado({
    id: 4,
    title: 'Silksong',
    sale: { iso: '2099-01-01T00:00', precision: 'month' },
    hltbMain: 12,
  }),
  planeado({
    id: 6,
    title: 'Tetris',
    sale: { iso: '1984-01-01T00:00', precision: 'year' },
    hltbMain: 100,
    endless: true,
  }),
  planeado({
    id: 5,
    title: 'Alan Wake',
    fijado: '2026-01-10T10:00',
    sale: { iso: '2010-05-18T00:00', precision: 'day' },
    hltbMain: 5,
  }),
];

const ids = (games: PlannedGameItem[]): GameId[] => games.map((game) => game.id);

describe('splitPlanSections: el reparto compartido más la lente del escritorio', () => {
  const secciones = splitPlanSections(juegos, 'oldest');

  it('Up next y el horizonte salen del reparto compartido, sin lente', () => {
    assert.deepEqual(ids(secciones.upNext), [5, 1, 2]);
    // El fijado sin salir (2) está en las DOS estanterías.
    assert.deepEqual(ids(secciones.horizon), [4, 2]);
  });

  it('la cola es filterQueue pasada por la lente elegida', () => {
    assert.deepEqual(ids(secciones.queue), [3, 6]);
    assert.deepEqual(
      ids(secciones.queue),
      ids(sortByLens(filterQueue(juegos, PLAN_SHELF_READERS), 'oldest')),
    );
    // La lente manda de verdad: "just added" le da la vuelta a la cola, y las
    // otras estanterías no se mueven.
    const recientes = splitPlanSections(juegos, 'newest');
    assert.deepEqual(ids(recientes.queue), [6, 3]);
    assert.deepEqual(ids(recientes.upNext), [5, 1, 2]);
    assert.deepEqual(ids(recientes.horizon), [4, 2]);
  });

  it('la deuda de la cabecera sobre PlannedGameItem es la de siempre', () => {
    assert.deepEqual(computePlanDebt(juegos), {
      totalGames: 6,
      totalHours: 45,
      withoutEstimate: 1,
    });
  });
});
