// QUE BLINDA: playedDayKeys descarta las sesiones manuales (no representan
// un dia concreto jugado). longestStreak cuenta dias consecutivos, se corta
// con un hueco, respeta el filtro por `year` (una racha que cruza fin de ano
// se corta en el borde) y sobrevive al cambio de hora. currentStreak sigue
// viva sin haber jugado hoy (con tal de haber jugado ayer) y se rompe en
// cuanto pasa un dia entero sin jugar.
//
// QUE ES REAL Y QUE ES DOBLE: las tres funciones son puras sobre claves de
// medianoche local — nada que doblar. currentStreak lee la hora real del
// sistema (usa `new Date()` internamente, sin reloj inyectable), asi que los
// tests calculan sus fechas relativas a esa misma hora real.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, startOfDay } from '../dateMath';
import { currentStreak, longestStreak, playedDayKeys } from '../streaks';

describe('playedDayKeys', () => {
  it('descarta las sesiones manuales: solo cuentan las medidas de verdad', () => {
    const medida = new Date(2026, 5, 1, 20, 0);
    const manual = new Date(2026, 5, 2, 10, 0);
    const keys = playedDayKeys([
      { startedAt: medida, isManual: false },
      { startedAt: manual, isManual: true },
    ]);
    assert.equal(keys.size, 1);
    assert.ok(keys.has(startOfDay(medida).getTime()));
  });
});

describe('longestStreak', () => {
  it('cuenta dias consecutivos y se corta con un hueco', () => {
    const d = (day: number): number => new Date(2026, 5, day).getTime();
    const keys = new Set([d(1), d(2), d(3), d(5), d(6)]); // 1-2-3 (racha de 3), hueco, 5-6 (2)
    assert.equal(longestStreak(keys), 3);
  });

  it('con `year`, una racha que cruza fin de ano se corta en el borde', () => {
    const dec31 = new Date(2025, 11, 31).getTime();
    const jan1 = new Date(2026, 0, 1).getTime();
    const jan2 = new Date(2026, 0, 2).getTime();
    const keys = new Set([dec31, jan1, jan2]);
    assert.equal(longestStreak(keys), 3); // sin filtrar, la racha entera cuenta
    assert.equal(longestStreak(keys, 2026), 2); // solo enero: jan1-jan2
    assert.equal(longestStreak(keys, 2025), 1); // solo diciembre: dec31 sola
  });

  it('sobrevive al cambio de hora: un dia sigue siendo un dia', () => {
    // Ultimo domingo de marzo de 2026 (2026-03-29): la madrugada dura 23h en
    // Europa. Las claves ya son medianoches locales (startOfDay), asi que el
    // salto de horas no puede colar un "0,96" en vez de un "1".
    const antes = startOfDay(new Date(2026, 2, 28)).getTime();
    const despues = startOfDay(new Date(2026, 2, 29)).getTime();
    assert.equal(longestStreak(new Set([antes, despues])), 2);
  });
});

describe('currentStreak', () => {
  it('con hoy jugado, cuenta desde hoy hacia atras', () => {
    const today = startOfDay(new Date());
    const keys = new Set([
      today.getTime(),
      addDays(today, -1).getTime(),
      addDays(today, -2).getTime(),
    ]);
    assert.equal(currentStreak(keys), 3);
  });

  it('sin jugar HOY pero si ayer, la racha sigue VIVA (aun no se ha roto)', () => {
    const today = startOfDay(new Date());
    const keys = new Set([addDays(today, -1).getTime(), addDays(today, -2).getTime()]);
    assert.equal(currentStreak(keys), 2);
  });

  it('sin jugar ni hoy ni ayer, la racha esta a cero', () => {
    const today = startOfDay(new Date());
    const keys = new Set([addDays(today, -3).getTime()]);
    assert.equal(currentStreak(keys), 0);
  });

  it('un hueco en medio corta la racha aunque haya dias mas antiguos', () => {
    const today = startOfDay(new Date());
    const keys = new Set([today.getTime(), addDays(today, -2).getTime()]); // falta ayer
    assert.equal(currentStreak(keys), 1);
  });
});
