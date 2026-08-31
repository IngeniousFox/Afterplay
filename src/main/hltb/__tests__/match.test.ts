import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findBestMatch } from '../match';
import type { HltbGame } from '../schemas';

// EL EMPAREJADO DE HowLongToBeat, EL LADO "DE DÓNDE SALE CADA CAMPO".
//
// Toda la heurística de negocio (parecido de título, desempate por año,
// umbral mínimo) ya está probada de forma exhaustiva en lib/__tests__/
// titleMatch.test.ts, porque vive ahí y es compartida con SteamGridDB. Lo
// que este fichero blinda es la parte propia de HLTB: que findBestMatch saca
// el nombre de `.name` y el año de `.releaseYear` (que en HltbGame es
// OPCIONAL, no nullable) — si alguien cambia esos nombres de campo al tocar
// hltb/schemas.ts, el emparejado se rompe en silencio (todo year undefined,
// nunca desempata) y este es el test que lo canta.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: todo real — findBestMatch y findBestTitleMatch
// son funciones puras, sin red ni DB de por medio.

const hltbGame = (overrides: Partial<HltbGame> & { name: string }): HltbGame => ({
  id: '1',
  completionTimes: {},
  ...overrides,
});

describe('findBestMatch (HowLongToBeat)', () => {
  it('usa candidate.name para el texto y candidate.releaseYear para el año', () => {
    // Dos candidatos con el MISMO nombre pero años distintos: si el wiring
    // leyera el campo equivocado (o ninguno), el año nunca desempataría y
    // ganaría siempre el primero por orden de iteración. Aquí se pide
    // explícitamente el año del segundo para demostrar que sí se lee.
    const original = hltbGame({ id: '1', name: 'Doom', releaseYear: 1993 });
    const reboot = hltbGame({ id: '2', name: 'Doom', releaseYear: 2016 });
    assert.equal(findBestMatch([original, reboot], 'Doom', 2016), reboot);
    assert.equal(findBestMatch([original, reboot], 'Doom', 1993), original);
  });

  it('releaseYear ausente (undefined) no revienta el desempate: cuenta como "sin año"', () => {
    // HltbGame.releaseYear es `z.number().optional()`, o sea undefined y NO
    // null cuando HLTB no lo trae — findBestTitleMatch espera justo
    // `number | undefined` en su getYear, así que esto prueba que el tipo
    // encaja sin conversiones raras (undefined ?? algo, etc.) que pudieran
    // colar un 0 o un NaN.
    const sinAño = hltbGame({ id: '1', name: 'Juego De Nicho' });
    assert.equal(findBestMatch([sinAño], 'Juego De Nicho', 2020), sinAño);
  });

  it('sin candidatos que superen el umbral de nombre, null (no revienta ni inventa)', () => {
    const noRelacionado = hltbGame({ id: '1', name: 'Un Juego Totalmente Distinto' });
    assert.equal(findBestMatch([noRelacionado], 'Hollow Knight', 2017), null);
  });
});
