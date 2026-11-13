import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMeaningfulStateEvent } from '../../memory/chapters';
import { isInitialPaperwork, manualHoursAnchor } from '../../playthroughState';
import type { Session, StateEvent } from '../../dto';
import { deriveLibrary, type LibraryStateEventRow } from '../library';

// El papeleo del alta en los dos esquemas (AFTERPLAY-2.0.md §7.5, decisión
// R-07 de src/main/db/v2/CONSULTAS.md). El 1.x lo reconoce por la heurística
// de los 5 s (isAddedAtArtifact); el 2.0, SOLO por `datePrecision =
// 'unknown'`. Lo que fija este fichero es que las dos reglas conviven sin
// pisarse: la del 1.x no cambia para quien no pide otra (el Worker), y una
// lectura 2.0 nunca tira como papeleo un evento real pegado al alta.

const ALTA = new Date('2026-03-10T18:00:00Z');
const PROMOCION = new Date('2026-07-01T12:00:00Z');
const cerca = (base: Date, ms: number): Date => new Date(base.getTime() + ms);
const LEJOS = new Date('2026-05-20T00:00:00Z');

describe('isInitialPaperwork', () => {
  it("con la regla 1.x (por defecto) manda la heurística, y 'unknown' también cuenta", () => {
    const anchors = { addedAt: ALTA, promotedAt: PROMOCION };
    assert.equal(isInitialPaperwork({ occurredAt: cerca(ALTA, 1_000) }, anchors), true);
    assert.equal(isInitialPaperwork({ occurredAt: cerca(PROMOCION, -900) }, anchors), true);
    assert.equal(isInitialPaperwork({ occurredAt: LEJOS }, anchors), false);
    assert.equal(
      isInitialPaperwork({ occurredAt: LEJOS, datePrecision: 'unknown' }, anchors, 'addedAt'),
      true,
    );
  });

  it("con la regla 2.0 SOLO 'unknown' es papeleo: la fecha de alta no se mira", () => {
    const anchors = { addedAt: ALTA, promotedAt: PROMOCION };
    // Un 'started' real tecleado con hora en el mismo segundo del alta.
    const real = { occurredAt: cerca(ALTA, 1_000), datePrecision: 'datetime' };
    assert.equal(isInitialPaperwork(real, anchors, 'datePrecision'), false);
    assert.equal(isInitialPaperwork(real, anchors, 'addedAt'), true);

    const papeleo = { occurredAt: ALTA, datePrecision: 'unknown' };
    assert.equal(isInitialPaperwork(papeleo, anchors, 'datePrecision'), true);
    // Sin fechas de referencia, igual: 'unknown' basta.
    assert.equal(isInitialPaperwork(papeleo, {}, 'datePrecision'), true);
  });
});

describe('manualHoursAnchor', () => {
  const sinFin = (
    occurredAt: Date,
    datePrecision: string,
  ): {
    type: 'started';
    occurredAt: Date;
    datePrecision: string;
  } => ({ type: 'started', occurredAt, datePrecision });

  it('1.x: sigue descartando lo pegado al alta, como antes de existir la regla', () => {
    const log = [sinFin(cerca(ALTA, 200), 'day')];
    assert.equal(manualHoursAnchor(log, ALTA), null);
    assert.equal(manualHoursAnchor(log, ALTA, [], null, 'addedAt'), null);
  });

  it("2.0: ancla en el evento real pegado al alta y descarta el 'unknown'", () => {
    const real = sinFin(cerca(ALTA, 200), 'datetime');
    assert.equal(
      manualHoursAnchor([real], ALTA, [], null, 'datePrecision')?.getTime(),
      real.occurredAt.getTime(),
    );

    const papeleo = sinFin(ALTA, 'unknown');
    const sesion = new Date('2026-04-02T20:00:00Z');
    assert.equal(
      manualHoursAnchor([papeleo], ALTA, [sesion], null, 'datePrecision')?.getTime(),
      sesion.getTime(),
    );
  });
});

describe('deriveLibrary: "Last played" desde el log', () => {
  // Las mismas filas con ids de texto, como las traerán las lecturas 2.0.
  const libraryWith = (
    stateEvents: LibraryStateEventRow<string>[],
    paperwork?: 'addedAt' | 'datePrecision',
  ): Date | null =>
    deriveLibrary({
      games: [{ id: 'g', addedAt: ALTA, promotedAt: null }],
      iterations: [],
      stateEvents,
      liveSessions: [],
      paperwork,
    }).get('g')!.lastPlayedAt;

  const evento = (
    id: string,
    occurredAt: Date,
    datePrecision?: LibraryStateEventRow['datePrecision'],
  ): LibraryStateEventRow<string> => ({
    id,
    gameId: 'g',
    iterationId: 'p',
    type: 'started',
    occurredAt,
    datePrecision,
  });

  it('sin regla explícita, la heurística de siempre (el Worker no cambia)', () => {
    assert.equal(libraryWith([evento('e1', cerca(ALTA, 1_000))]), null);
  });

  it('2.0: un evento real al segundo del alta SÍ cuenta como jugado', () => {
    const at = cerca(ALTA, 1_000);
    assert.equal(
      libraryWith([evento('e1', at, 'datetime')], 'datePrecision')?.getTime(),
      at.getTime(),
    );
  });

  it("2.0: el 'unknown' no cuenta, aunque su fecha caiga lejos del alta", () => {
    // El 2.0 escribe occurredAt = addedAt, pero la regla no depende de eso.
    assert.equal(libraryWith([evento('e1', LEJOS, 'unknown')], 'datePrecision'), null);
    assert.equal(
      libraryWith(
        [evento('e1', LEJOS, 'unknown'), evento('e2', cerca(LEJOS, -86_400_000), 'day')],
        'datePrecision',
      )?.getTime(),
      cerca(LEJOS, -86_400_000).getTime(),
    );
  });
});

describe('isMeaningfulStateEvent (Loop)', () => {
  it('evento 1.x: la heurística por addedAt/promotedAt', () => {
    assert.equal(
      isMeaningfulStateEvent({
        gameId: 1,
        type: 'completed',
        occurredAt: cerca(ALTA, 10),
        addedAt: ALTA,
      }),
      false,
    );
  });

  it("evento 2.0: solo 'unknown' lo descarta; pegado al alta sigue siendo historia", () => {
    assert.equal(
      isMeaningfulStateEvent({
        gameId: 'g',
        type: 'completed',
        occurredAt: cerca(ALTA, 10),
        datePrecision: 'datetime',
      }),
      true,
    );
    assert.equal(
      isMeaningfulStateEvent({
        gameId: 'g',
        type: 'completed',
        occurredAt: LEJOS,
        datePrecision: 'unknown',
      }),
      false,
    );
  });

  it('el tipo no deja mezclar las dos formas', () => {
    // @ts-expect-error — una fila 2.0 no puede activar la heurística del alta.
    isMeaningfulStateEvent({
      gameId: 'g',
      type: 'completed',
      occurredAt: LEJOS,
      datePrecision: 'day',
      addedAt: ALTA,
    });
  });
});

describe('DTOs: los valores 2.0 cuelgan de la representación del id', () => {
  it("'unknown' y 'play' existen con ids de texto y no con ids numéricos", () => {
    const v2: StateEvent<string>['datePrecision'] = 'unknown';
    const play: Session<string>['startedBy'] = 'play';
    // @ts-expect-error — el esquema 1.x no puede guardar 'unknown' (dtoSync.ts).
    const v1: StateEvent['datePrecision'] = 'unknown';
    // @ts-expect-error — ni 'play'.
    const v1Play: Session<number>['startedBy'] = 'play';
    assert.deepEqual([v2, play, v1, v1Play], ['unknown', 'play', 'unknown', 'play']);
  });
});
