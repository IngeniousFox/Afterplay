import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExternalRefreshEvent } from '../../../../shared/types';
import { externalRefreshBar } from '../external';

// La regla de "qué fase del refresco tiene porcentaje medible" la pintan DOS
// barras distintas (Ajustes → External data y la cabecera del Plan) desde el
// mismo evento del main. Estaba copiada a mano en las dos, así que estos
// casos son el candado: si mañana entra una fase nueva que avanza juego a
// juego y nadie toca el helper, aquí se ve — y no en pantalla, con una de las
// dos barras latiendo para siempre.

const evento = (parcial: Partial<ExternalRefreshEvent>): ExternalRefreshEvent => ({
  running: true,
  scope: 'all',
  phase: 'igdb',
  done: 0,
  total: 0,
  currentTitle: null,
  summary: null,
  error: null,
  ...parcial,
});

describe('externalRefreshBar', () => {
  it('mide las fases que avanzan juego a juego', () => {
    const steam = externalRefreshBar(evento({ phase: 'steam', done: 42, total: 210 }), true);
    assert.equal(steam.measurable, true);
    assert.equal(steam.percent, 20);

    const hltb = externalRefreshBar(evento({ phase: 'hltb', done: 3, total: 4 }), true);
    assert.equal(hltb.measurable, true);
    assert.equal(hltb.percent, 75);
  });

  it('no le inventa porcentaje a las fases que vuelan', () => {
    for (const phase of ['igdb', 'saving', 'done'] as const) {
      const bar = externalRefreshBar(evento({ phase, done: 7, total: 10 }), true);
      assert.equal(bar.measurable, false, phase);
      assert.equal(bar.percent, 0, phase);
    }
  });

  // El total llega a 0 cuando ningún juego de la pasada tiene appid: sin esta
  // puerta la división daba NaN y el ancho de la barra se quedaba en blanco.
  it('con total 0 no divide', () => {
    const bar = externalRefreshBar(evento({ phase: 'steam', done: 0, total: 0 }), true);
    assert.equal(bar.measurable, false);
    assert.equal(bar.percent, 0);
  });

  // Manda el "ocupado" del main: el último evento de la pasada se queda en la
  // caché de TanStack, así que sin esto la barra seguiría midiendo una pasada
  // que terminó hace rato.
  it('sin pasada en marcha no hay barra, aunque quede el evento viejo', () => {
    const bar = externalRefreshBar(evento({ phase: 'steam', done: 210, total: 210 }), false);
    assert.equal(bar.measurable, false);
    assert.equal(bar.percent, 0);
  });

  it('sin evento todavía, tampoco', () => {
    const bar = externalRefreshBar(null, true);
    assert.equal(bar.measurable, false);
    assert.equal(bar.percent, 0);
  });
});
