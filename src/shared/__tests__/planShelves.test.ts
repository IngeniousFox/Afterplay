import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isUnreleased, releaseSortKey } from '../releaseDate';
import type { DatePrecision, DateValue } from '../dateTypes';
import { computePlanDebt, filterQueue, sortHorizon, sortUpNext } from '../planShelves';
import type { PlanShelfReaders } from '../planShelves';

// El reparto del Plan en estanterías y la deuda de su cabecera, en su único
// sitio. Estos casos vivían en web/src/lib/__tests__/paridad.test.ts, donde
// comparaban la PWA con la copia que el escritorio tenía en
// src/renderer/src/lib/plan.ts. Esa copia ya no existe (el escritorio llama a
// estas mismas funciones), así que comparar los dos lados sería comparar f(x)
// con f(x): aquí cada caso lleva su valor esperado ESCRITO y se gasta en las dos
// monedas —Date, la del escritorio, y milisegundos, la que sobrevive al JSON de
// la PWA—, que es lo único que de verdad cambia entre un lado y otro.

type Spec = {
  id: number;
  title: string;
  // ISO del fijado, o null si está en la cola.
  fijado?: string | null;
  // Las fechas de salida van MUY lejos a propósito (1984 / 2099): isUnreleased
  // pregunta por el reloj de verdad, y un caso "sale la semana que viene"
  // caducaría solo.
  sale?: { iso: string; precision: DatePrecision } | null;
  hltbMain?: number | null;
  endless?: boolean;
};

type Juego<TDate extends DateValue> = {
  id: number;
  title: string;
  pinnedAt: TDate | null;
  releaseDate: TDate | null;
  releaseDatePrecision: DatePrecision | null;
  releaseYear: number | null;
  hltbMain: number | null;
  endless: boolean;
};

const juego = <TDate extends DateValue>(
  spec: Spec,
  moneda: (date: Date) => TDate,
): Juego<TDate> => {
  const fijado = spec.fijado ? new Date(spec.fijado) : null;
  const sale = spec.sale ? new Date(spec.sale.iso) : null;
  return {
    id: spec.id,
    title: spec.title,
    pinnedAt: fijado ? moneda(fijado) : null,
    releaseDate: sale ? moneda(sale) : null,
    releaseDatePrecision: spec.sale ? spec.sale.precision : null,
    releaseYear: sale ? sale.getFullYear() : null,
    hltbMain: spec.hltbMain ?? null,
    endless: spec.endless ?? false,
  };
};

const lector = <TDate extends DateValue>(
  pinnedAt: (date: TDate) => number,
): PlanShelfReaders<Juego<TDate>> => ({
  pinnedAt: (game) => (game.pinnedAt === null ? null : pinnedAt(game.pinnedAt)),
  title: (game) => game.title,
  unreleased: (game) => isUnreleased(game),
  releaseSortKey: (game) => releaseSortKey(game),
});

// Un plan con los seis casos que separan un reparto bueno de uno a medias.
const PLAN: Spec[] = [
  {
    id: 2,
    title: 'Hollow Knight II',
    fijado: '2026-01-10T12:00',
    sale: { iso: '2099-06-15T00:00', precision: 'day' },
  },
  { id: 3, title: 'Celeste', sale: { iso: '2018-01-25T00:00', precision: 'day' }, hltbMain: 8 },
  {
    id: 1,
    title: 'Zelda',
    fijado: '2026-01-10T10:00',
    sale: { iso: '2017-03-03T00:00', precision: 'day' },
    hltbMain: 20,
  },
  {
    id: 4,
    title: 'Silksong',
    sale: { iso: '2099-01-01T00:00', precision: 'month' },
    hltbMain: 12,
  },
  {
    id: 6,
    title: 'Tetris',
    sale: { iso: '1984-01-01T00:00', precision: 'year' },
    hltbMain: 100,
    endless: true,
  },
  {
    id: 5,
    title: 'Alan Wake',
    fijado: '2026-01-10T10:00',
    sale: { iso: '2010-05-18T00:00', precision: 'day' },
    hltbMain: 5,
  },
];

const ids = (games: readonly { id: number }[]): number[] => games.map((game) => game.id);

// Cada caso se escribe UNA vez y se gasta en las dos monedas: el escritorio lee
// Date y la PWA milisegundos.
const enMoneda = <TDate extends DateValue>(
  nombre: string,
  moneda: (date: Date) => TDate,
  pinnedAt: (date: TDate) => number,
): void => {
  describe(`planShelves en ${nombre}`, () => {
    const juegos = PLAN.map((spec) => juego(spec, moneda));
    const read = lector(pinnedAt);

    it('Up next es el orden de fijado, y un empate al milisegundo lo parte el título', () => {
      // Zelda y Alan Wake se fijaron en el MISMO milisegundo — que es lo que
      // pasa cuando el escritorio drena de golpe dos pines del móvil. Sin
      // desempate por título la fila bailaría entre repintados.
      assert.deepEqual(ids(sortUpNext(juegos, read)), [5, 1, 2]);
    });

    it('el horizonte NO es excluyente: un fijado sin salir sale en las DOS estanterías', () => {
      // LA PARTE SUTIL, y la que ya costó un fallo real: fijar un juego que
      // estaba en el horizonte lo hacía desaparecer de allí, y desde el sofá
      // parecía que la app se había comido la cuenta atrás. Hollow Knight II
      // está fijado Y sin salir, así que está en Up next y en el horizonte.
      assert.deepEqual(ids(sortHorizon(juegos, read)), [4, 2]);
      assert.ok(ids(sortUpNext(juegos, read)).includes(2), 'el fijado sin salir se perdió');
    });

    it('la cola es lo jugable sin fijar, en el orden en que entra', () => {
      // QUIÉNES están en la cola lo decide el reparto; el orden es de cada
      // pantalla (el escritorio le pasa una lente, la PWA se queda con el
      // alfabético que ya trae /api/plan). Por eso aquí sale en el orden de
      // entrada: Celeste (3) va antes que Tetris (6) en PLAN.
      assert.deepEqual(ids(filterQueue(juegos, read)), [3, 6]);
    });

    it('la deuda no cuenta las horas de un endless, pero sí cuenta el juego', () => {
      // El reparto asimétrico que una copia se deja por el camino: Tetris no
      // tiene final que alcanzar, así que sus 100 h no son deuda — pero está en
      // tu plan, así que cuenta en "across N games". Y Hollow Knight II, sin
      // estimación, no inventa horas: se dice aparte, en pequeño.
      assert.deepEqual(computePlanDebt(juegos), {
        totalGames: 6,
        totalHours: 45,
        withoutEstimate: 1,
      });
    });
  });
};

enMoneda<Date>(
  'Date (escritorio)',
  (date) => date,
  (date) => date.getTime(),
);
enMoneda<number>(
  'milisegundos (PWA)',
  (date) => date.getTime(),
  (ms) => ms,
);
