import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calendarDaysBetween, daysBetween } from '../dateMath';

// La cicatriz: "Played today" para una sesion de ayer por la noche. Estos
// casos fijan la diferencia entre medir dias de calendario y medir tramos de
// 24 h, que es justo donde se equivocaba el chip del Journey de un juego.
describe('calendarDaysBetween', () => {
  it('cuenta medianoches, no horas transcurridas', () => {
    const ayerPorLaNoche = new Date(2026, 7, 25, 20, 0);
    const hoyPorLaManana = new Date(2026, 7, 26, 10, 0);
    // La resta cruda da menos de un dia y hacia decir "hoy" a lo de ayer.
    assert.ok(daysBetween(ayerPorLaNoche, hoyPorLaManana) < 1);
    assert.equal(calendarDaysBetween(ayerPorLaNoche, hoyPorLaManana), 1);
  });

  it('el mismo dia es 0 por lejos que esten las horas', () => {
    assert.equal(
      calendarDaysBetween(new Date(2026, 7, 26, 0, 5), new Date(2026, 7, 26, 23, 55)),
      0,
    );
  });

  it('un dia y pico sigue siendo un dia, no dos', () => {
    const anteayerPorLaTarde = new Date(2026, 7, 24, 18, 0);
    const ayerPorLaNoche = new Date(2026, 7, 25, 23, 0);
    assert.ok(daysBetween(anteayerPorLaTarde, ayerPorLaNoche) > 1);
    assert.equal(calendarDaysBetween(anteayerPorLaTarde, ayerPorLaNoche), 1);
  });

  it('sobrevive al cambio de hora: un dia sigue siendo un dia', () => {
    // Ultimo domingo de marzo de 2026 (2026-03-29): la madrugada dura 23 h en
    // Europa, y con el cociente crudo el dia salia 0,96.
    assert.equal(
      calendarDaysBetween(new Date(2026, 2, 28, 12, 0), new Date(2026, 2, 29, 12, 0)),
      1,
    );
    // Y en octubre, 25 h: 1,04.
    assert.equal(
      calendarDaysBetween(new Date(2026, 9, 24, 12, 0), new Date(2026, 9, 25, 12, 0)),
      1,
    );
  });

  it('hacia atras es negativo (una fecha por delante de hoy)', () => {
    assert.equal(calendarDaysBetween(new Date(2026, 7, 27, 9, 0), new Date(2026, 7, 26, 9, 0)), -1);
  });
});
