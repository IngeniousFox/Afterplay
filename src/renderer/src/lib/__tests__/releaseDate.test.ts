// QUE BLINDA: isUnreleased comparando al GRANO de la precision (no al
// timestamp pelado) — un "March 2026" no sale en febrero pero si en marzo, y
// el DIA exacto del lanzamiento sigue contando como "sin salir" hasta
// medianoche. Y releaseCountdown: solo cuenta con precision de dia, la
// ventana OUT NOW de 21 dias hacia atras, today/tomorrow como casos aparte
// de "soon", el umbral de imminent a los 7 dias y el corte de 30 dias de la
// ventana hacia delante.
//
// QUE ES REAL Y QUE ES DOBLE: las dos funciones son puras sobre un `now`
// inyectado — nada que doblar.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isUnreleased, releaseCountdown, type GameRelease } from '../releaseDate';

const release = (overrides: Partial<GameRelease> = {}): GameRelease => ({
  releaseDate: null,
  releaseDatePrecision: null,
  releaseYear: null,
  ...overrides,
});

describe('isUnreleased', () => {
  it('precision year: solo un ano ESTRICTAMENTE futuro cuenta como sin salir', () => {
    const now = new Date(2026, 5, 1);
    assert.equal(
      isUnreleased(
        release({
          releaseDate: new Date(2026, 0, 1),
          releaseDatePrecision: 'year',
          releaseYear: 2026,
        }),
        now,
      ),
      false,
    );
    assert.equal(
      isUnreleased(
        release({
          releaseDate: new Date(2027, 0, 1),
          releaseDatePrecision: 'year',
          releaseYear: 2027,
        }),
        now,
      ),
      true,
    );
  });

  it('precision month: el MES exacto del lanzamiento ya cuenta como salido', () => {
    const march = release({
      releaseDate: new Date(2026, 2, 1),
      releaseDatePrecision: 'month',
      releaseYear: 2026,
    });
    assert.equal(isUnreleased(march, new Date(2026, 1, 28)), true); // febrero, antes
    assert.equal(isUnreleased(march, new Date(2026, 2, 1)), false); // el propio marzo
    assert.equal(isUnreleased(march, new Date(2026, 3, 1)), false); // abril, despues
  });

  it('precision day: el DIA del lanzamiento sigue siendo "sin salir" hasta medianoche', () => {
    const releaseDay = release({
      releaseDate: new Date(2026, 5, 10),
      releaseDatePrecision: 'day',
      releaseYear: 2026,
    });
    assert.equal(isUnreleased(releaseDay, new Date(2026, 5, 10, 23, 0)), true); // el mismo dia, tarde
    assert.equal(isUnreleased(releaseDay, new Date(2026, 5, 9, 23, 0)), true); // la vispera
    assert.equal(isUnreleased(releaseDay, new Date(2026, 5, 11, 0, 1)), false); // ya paso su dia
  });

  it('sin fecha usable cae al ano de respaldo; sin ano ninguno, nunca es "sin salir"', () => {
    assert.equal(isUnreleased(release({ releaseYear: 2099 }), new Date(2026, 0, 1)), true);
    assert.equal(isUnreleased(release({ releaseYear: null }), new Date(2026, 0, 1)), false);
  });
});

describe('releaseCountdown', () => {
  const now = new Date(2026, 5, 15);

  it('sin precision de DIA no hay cuenta atras, aunque haya fecha concreta', () => {
    assert.equal(
      releaseCountdown(
        release({
          releaseDate: new Date(2026, 6, 1),
          releaseDatePrecision: 'month',
          releaseYear: 2026,
        }),
        now,
      ),
      null,
    );
  });

  it('OUT NOW dura 21 dias hacia atras y luego desaparece', () => {
    const veintiunoAtras = release({
      releaseDate: new Date(2026, 4, 25),
      releaseDatePrecision: 'day',
      releaseYear: 2026,
    });
    assert.deepEqual(releaseCountdown(veintiunoAtras, now), { kind: 'out-now' });
    const veintidosAtras = release({
      releaseDate: new Date(2026, 4, 24),
      releaseDatePrecision: 'day',
      releaseYear: 2026,
    });
    assert.equal(releaseCountdown(veintidosAtras, now), null);
  });

  it('today y tomorrow son casos APARTE, no "soon" con 0 o 1 dias', () => {
    assert.deepEqual(
      releaseCountdown(
        release({
          releaseDate: new Date(2026, 5, 15),
          releaseDatePrecision: 'day',
          releaseYear: 2026,
        }),
        now,
      ),
      { kind: 'today' },
    );
    assert.deepEqual(
      releaseCountdown(
        release({
          releaseDate: new Date(2026, 5, 16),
          releaseDatePrecision: 'day',
          releaseYear: 2026,
        }),
        now,
      ),
      { kind: 'tomorrow' },
    );
  });

  it('imminent se enciende a partir de 7 dias exactos, no antes', () => {
    const en7 = releaseCountdown(
      release({
        releaseDate: new Date(2026, 5, 22),
        releaseDatePrecision: 'day',
        releaseYear: 2026,
      }),
      now,
    );
    const en8 = releaseCountdown(
      release({
        releaseDate: new Date(2026, 5, 23),
        releaseDatePrecision: 'day',
        releaseYear: 2026,
      }),
      now,
    );
    assert.deepEqual(en7, { kind: 'soon', days: 7, imminent: true });
    assert.deepEqual(en8, { kind: 'soon', days: 8, imminent: false });
  });

  it('mas alla de 30 dias no es cuenta atras: es ruido con pinta de dato', () => {
    assert.deepEqual(
      releaseCountdown(
        release({
          releaseDate: new Date(2026, 6, 15),
          releaseDatePrecision: 'day',
          releaseYear: 2026,
        }),
        now,
      ),
      { kind: 'soon', days: 30, imminent: false },
    );
    assert.equal(
      releaseCountdown(
        release({
          releaseDate: new Date(2026, 6, 16),
          releaseDatePrecision: 'day',
          releaseYear: 2026,
        }),
        now,
      ),
      null,
    );
  });
});
