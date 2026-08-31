import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findBestMatch } from '../match';
import type { SgdbGame } from '../schemas';

// EL EMPAREJADO DE SteamGridDB, EL LADO "DE DÓNDE SALE CADA CAMPO".
//
// Gemelo de hltb/__tests__/match.test.ts: la heurística compartida
// (parecido de título, desempate por año, umbral) ya está probada en
// lib/__tests__/titleMatch.test.ts. Lo propio de SteamGridDB es la
// CONVERSIÓN de fecha: SGDB da `release_date` en segundos unix (o ausente),
// no un año suelto como HLTB o IGDB — toYear() tiene que convertirlo bien Y
// tratar null/undefined como "sin año" sin reventar.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: todo real — funciones puras.

const sgdbGame = (overrides: Partial<SgdbGame> & { name: string }): SgdbGame => ({
  id: 1,
  ...overrides,
});

describe('findBestMatch (SteamGridDB)', () => {
  it('convierte release_date (unix segundos) a año UTC para el desempate', () => {
    // 1508889600 = 2017-10-25T00:00:00Z -> año 2017.
    const original = sgdbGame({ id: 1, name: 'Cuphead', release_date: 1508889600 });
    // Una reedición/DLC del mismo nombre, dos años después.
    const reedicion = sgdbGame({
      id: 2,
      name: 'Cuphead',
      release_date: 1508889600 + 2 * 365 * 86400,
    });
    assert.equal(findBestMatch([original, reedicion], 'Cuphead', 2017), original);
  });

  it('release_date null (SGDB no lo trae) se trata como "sin año", no como año 1970', () => {
    // Si toYear no comprobara null/undefined y pasara 0 a
    // unixSecondsToUtcYear, saldría 1970 — un año concreto que competiría
    // (y perdería) en el desempate en vez de quedarse neutral.
    const sinFecha = sgdbGame({ id: 1, name: 'Juego De Nicho', release_date: null });
    assert.equal(findBestMatch([sinFecha], 'Juego De Nicho', 2020), sinFecha);
  });

  it('release_date ausente (undefined, el campo es opcional) también es "sin año"', () => {
    const sinCampo = sgdbGame({ id: 1, name: 'Otro Juego' });
    assert.equal(findBestMatch([sinCampo], 'Otro Juego', 2020), sinCampo);
  });

  it('un mod de fans con nombre bastante distinto no pasa el umbral', () => {
    // Medido: dice("skyrim special edition unofficial patch", "skyrim") =
    // 0.23, muy por debajo del umbral de 0.5 — el ruido del mod pesa más
    // que el "skyrim" que sí comparten.
    const modDeFans = sgdbGame({
      id: 1,
      name: 'Skyrim Special Edition Unofficial Patch',
      release_date: null,
    });
    assert.equal(findBestMatch([modDeFans], 'Skyrim', 2011), null);
  });
});
