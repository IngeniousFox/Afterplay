import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PendingEntry, PlannedGame } from '../../api';
import { sortUpNext } from '../../../../src/shared/planShelves';
import type { PlanShelfReaders } from '../../../../src/shared/planShelves';
import { applyPending } from '../planPending';

// LA VISTA PREVIA DEL BUZÓN tiene un único deber: enseñar el plan tal y como va
// a quedar cuando el escritorio drene las órdenes. Si previera otra cosa, la
// fila SALTARÍA justo al drenarse, que es peor que no previsualizar nada — el
// §6.3 quiere que el gesto se vea al instante donde lo hiciste, no que se vea
// mal.
//
// El caso que estos tests dejan clavado es el del PIN, que sellaba con
// `Date.now()` del RENDER en vez de con el `pinnedAt` de la propia orden: fijas
// A en el móvil a las 10:00, B desde el PC a las 12:00, y a las 18:00 abres la
// PWA con la orden de A sin drenar — la vista previa ponía A DETRÁS de B, y al
// drenar A recuperaba su 10:00 y se subía sola. Con varios pines pendientes era
// peor: el bucle es síncrono, así que todos recibían el MISMO milisegundo y se
// desempataban por título.

// Un juego del plan con lo único que el buzón y el orden de Up next miran.
const juego = (id: number, title: string, pinnedAt: number | null = null): PlannedGame =>
  ({ id, title, pinnedAt }) as unknown as PlannedGame;

const orden = (id: number, entry: PendingEntry['entry']): PendingEntry => ({
  id,
  createdAt: 0,
  entry,
});

// Los mismos accesos que PlanScreen: el orden de Up next se comprueba con la
// función compartida, que es la que de verdad pinta la pantalla.
const LEE: PlanShelfReaders<PlannedGame> = {
  pinnedAt: (game) => game.pinnedAt,
  title: (game) => game.title,
  // Nada de esto ha salido en el futuro: aquí no se prueba el horizonte.
  unreleased: () => false,
  releaseSortKey: () => 0,
};

const pinDe = (games: PlannedGame[], id: number): number | null =>
  games.find((game) => game.id === id)?.pinnedAt ?? null;

const T10 = new Date('2026-01-10T10:00:00Z').getTime();
const T12 = new Date('2026-01-10T12:00:00Z').getTime();

describe('buzón: la vista previa del pin usa la marca del GESTO', () => {
  it('un pin pendiente se previsualiza con su propio pinnedAt, no con "ahora"', () => {
    // La marca es de 2026 y fija: si esto volviera a sellar con Date.now(), el
    // valor sería el instante de correr el test y esta igualdad se caería.
    const overlay = applyPending(
      [juego(1, 'Zelda')],
      [orden(1, { type: 'pin', gameId: 1, pinnedAt: T10 })],
    );
    assert.equal(pinDe(overlay.games, 1), T10);
    assert.ok(overlay.touched.has(1), 'el juego tocado tiene que marcarse como pendiente');
  });

  it('el orden previsto es el que aplicará el PC, no el del render', () => {
    // Zelda se fijó en el teléfono a las 10:00 y quedó sin drenar; Alan Wake se
    // fijó desde el PC a las 12:00 y ya está aplicado. El orden verdadero —el
    // que escribirá drainMailbox con pinStamp— es Zelda, Alan Wake. Sellar el
    // pendiente con "ahora" lo pondría el último y la fila saltaría al drenar.
    const overlay = applyPending(
      [juego(1, 'Zelda'), juego(2, 'Alan Wake', T12)],
      [orden(1, { type: 'pin', gameId: 1, pinnedAt: T10 })],
    );
    assert.deepEqual(
      sortUpNext(overlay.games, LEE).map((game) => game.id),
      [1, 2],
    );
  });

  it('dos pines pendientes conservan SU separación, sin empatar al milisegundo', () => {
    // El bucle de applyPending es síncrono: con Date.now() los dos recibían el
    // mismo milisegundo y el desempate por título los ordenaba alfabéticamente
    // ('Alan Wake' encima de 'Zelda'), justo al revés de como se fijaron.
    const overlay = applyPending(
      [juego(1, 'Zelda'), juego(2, 'Alan Wake')],
      [
        orden(1, { type: 'pin', gameId: 1, pinnedAt: T10 }),
        orden(2, { type: 'pin', gameId: 2, pinnedAt: T10 + 600_000 }),
      ],
    );
    assert.notEqual(pinDe(overlay.games, 1), pinDe(overlay.games, 2));
    assert.deepEqual(
      sortUpNext(overlay.games, LEE).map((game) => game.id),
      [1, 2],
    );
  });

  it('la última orden sobre el mismo juego manda, y soltar deja el pin en null', () => {
    // Se aplican por id ascendente, o sea en el orden en que se encolaron.
    const overlay = applyPending(
      [juego(1, 'Zelda', T10)],
      [orden(1, { type: 'unpin', gameId: 1 }), orden(2, { type: 'pin', gameId: 1, pinnedAt: T12 })],
    );
    assert.equal(pinDe(overlay.games, 1), T12);

    const soltado = applyPending(
      [juego(1, 'Zelda', T10)],
      [orden(1, { type: 'unpin', gameId: 1 })],
    );
    assert.equal(pinDe(soltado.games, 1), null);
  });

  it('un reorden pendiente reparte las marcas que YA existen, sin inventar ninguna', () => {
    // Nada se deriva hacia el futuro: el conjunto de fechas es el mismo, solo
    // cambia a quién le toca cada una. Y salen estrictamente crecientes, porque
    // dos fijados en el mismo milisegundo empatarían.
    const overlay = applyPending(
      [juego(1, 'Zelda', T10), juego(2, 'Alan Wake', T12)],
      [orden(1, { type: 'reorder', orderedIds: [2, 1] })],
    );
    assert.equal(pinDe(overlay.games, 2), T10);
    assert.equal(pinDe(overlay.games, 1), T12);
    assert.deepEqual(
      sortUpNext(overlay.games, LEE).map((game) => game.id),
      [2, 1],
    );
  });
});
