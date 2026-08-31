import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { RaGameListEntry } from '../api';

// backfill.ts importa '../db' (src/main/db/index.ts), que arrastra
// '@tursodatabase/sync' y 'electron' — ninguno de los dos carga bajo tsx. El
// módulo bajo prueba nunca llega a llamar a getDb/withDbAccess (matchAgainstLists
// y breakTieByPlayedPlatform son puras), pero el mock tiene que existir para que
// el IMPORT del fichero no reviente. Va antes del import, patrón de la casa.
mock.module('../../db', {
  namedExports: {
    getDb: (): unknown => {
      throw new Error('matchAgainstLists/breakTieByPlayedPlatform no deberían tocar la base');
    },
    withDbAccess: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
  },
});

let matchAgainstLists: typeof import('../backfill').matchAgainstLists;
let breakTieByPlayedPlatform: typeof import('../backfill').breakTieByPlayedPlatform;
type MatchCandidate = import('../backfill').MatchCandidate;
type ConsoleMatch = import('../backfill').ConsoleMatch;

before(async () => {
  ({ matchAgainstLists, breakTieByPlayedPlatform } = await import('../backfill'));
});

// EL EMPAREJADO DE UN JUEGO CONTRA LAS LISTAS DE RA (ra/backfill.ts) —
// matchAgainstLists y su válvula de escape breakTieByPlayedPlatform.
//
// QUÉ BLINDA:
//   · MIN_RA_SIMILARITY (0.8): el umbral PROPIO de RA, por encima del
//     genérico de findBestTitleMatch (0.5). Un título que pasaría el genérico
//     pero no llega a 0.8 tiene que quedar SIN emparejar, no colgado del set
//     que más se le parezca.
//   · AMBIGUOUS_MARGIN (0.05): cuando dos consolas puntúan casi igual (el
//     caso de un multiplataforma con el título idéntico en dos sets), el
//     resultado tiene que ser 'ambiguous' y no una elección arbitraria del
//     primero que llegue — y cuando la ventaja es clara (por encima del
//     margen), tiene que ganar sin necesidad de desempate.
//   · breakTieByPlayedPlatform: la plataforma que el usuario apuntó SOLO
//     desempata cuando señala a EXACTAMENTE una de las consolas empatadas —
//     cero apunta a ellas, o dos, y el empate sigue en pie.
//
// QUÉ ES REAL: las dos funciones tal cual están en producción, sin ningún
// doble de su propia lógica.
// QUÉ ES DOBLE: SOLO '../db' (ver arriba), y únicamente porque el import del
// fichero completo lo exige — no porque el código bajo prueba lo llame.

const game = (overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: 1,
  title: 'Mega Man X',
  releaseYear: null,
  officialPlatforms: null,
  heroUrl: null,
  ...overrides,
});

const entry = (raGameId: number, title: string): RaGameListEntry => ({
  raGameId,
  title,
  numAchievements: 10,
});

describe('matchAgainstLists: el umbral propio de RA (0.8)', () => {
  it('una similitud por debajo de 0.8 (pero por encima del genérico 0.5) NO empareja', () => {
    // "Mega Man X" vs "Mega Man Xtreme": Dice ~0.78 — pasaría el 0.5 genérico
    // de findBestTitleMatch, pero no el 0.8 propio de RA.
    const lists = new Map([[10, [entry(100, 'Mega Man Xtreme')]]]);
    assert.deepEqual(matchAgainstLists(game(), lists, [10]), { kind: 'none' });
  });

  it('una similitud de 0.8 o más SÍ empareja, con el raGameId del candidato', () => {
    // "Mega Man X" vs "Mega Man X2": Dice ~0.95.
    const lists = new Map([[10, [entry(200, 'Mega Man X2')]]]);
    assert.deepEqual(matchAgainstLists(game(), lists, [10]), { kind: 'matched', raGameId: 200 });
  });

  it('sin ninguna lista descargada para las consolas pedidas, el resultado es "none", no un fallo', () => {
    assert.deepEqual(matchAgainstLists(game(), new Map(), [10, 20]), { kind: 'none' });
  });

  it('una consola con la lista vacía se salta sin romper el resto', () => {
    const lists = new Map([
      [10, [] as RaGameListEntry[]],
      [20, [entry(300, 'Mega Man X2')]],
    ]);
    assert.deepEqual(matchAgainstLists(game(), lists, [10, 20]), {
      kind: 'matched',
      raGameId: 300,
    });
  });
});

describe('matchAgainstLists: el margen de ambigüedad (0.05) entre consolas', () => {
  it('el mismo título EXACTO en dos consolas distintas es ambiguo (margen 0), y trae las DOS', () => {
    // El caso real que motiva la función entera: un multiplataforma con el
    // título idéntico en dos sets de RA no tiene forma de desempatarse por
    // similitud de nombre — las dos puntúan 1.00 clavado.
    const lists = new Map([
      [15, [entry(200, 'Sonic the Hedgehog')]], // Game Gear
      [11, [entry(300, 'Sonic the Hedgehog')]], // Master System
    ]);
    const result = matchAgainstLists(game({ title: 'Sonic the Hedgehog' }), lists, [15, 11]);
    assert.equal(result.kind, 'ambiguous');
    if (result.kind !== 'ambiguous') return;
    assert.deepEqual(
      [...result.tied].sort((a, b) => a.consoleId - b.consoleId),
      [
        { consoleId: 11, raGameId: 300 },
        { consoleId: 15, raGameId: 200 },
      ],
    );
  });

  it('una ventaja clara por encima del margen (>0.05) gana sin ambigüedad, aunque el segundo también pase 0.8', () => {
    // "Mortal Kombat" vs "Mortal Kombat" (1.00) y vs "Mortal Kombat 3"
    // (~0.92): ambos superan 0.8, pero la distancia (~0.08) supera el margen
    // de 0.05 — no hay empate que resolver, gana el más parecido sin más.
    const lists = new Map([
      [10, [entry(400, 'Mortal Kombat')]],
      [20, [entry(500, 'Mortal Kombat 3')]],
    ]);
    const result = matchAgainstLists(game({ title: 'Mortal Kombat' }), lists, [10, 20]);
    assert.deepEqual(result, { kind: 'matched', raGameId: 400 });
  });
});

describe('breakTieByPlayedPlatform: la válvula de escape del empate', () => {
  const tied: ConsoleMatch[] = [
    { consoleId: 15, raGameId: 200 }, // Game Gear
    { consoleId: 11, raGameId: 300 }, // Master System
  ];

  it('la plataforma jugada señala a UNA sola de las empatadas: desempata', () => {
    assert.equal(breakTieByPlayedPlatform(tied, ['Sega Game Gear']), 200);
  });

  it('la plataforma jugada no traduce a NINGUNA consola de RA: el empate sigue en pie', () => {
    assert.equal(breakTieByPlayedPlatform(tied, ['PC (Microsoft Windows)']), null);
  });

  it('la plataforma jugada traduce a una consola que NO está entre las empatadas: el empate sigue en pie', () => {
    // Apunta a Mega Drive (1), que no es ninguna de las dos consolas en juego.
    assert.equal(breakTieByPlayedPlatform(tied, ['Sega Mega Drive']), null);
  });

  it('el jugador apuntó las DOS plataformas empatadas (varias partidas/ediciones): sigue sin desempatar', () => {
    // Media pista sigue siendo media pista — desempatar aquí sería volver a
    // la moneda al aire que la función existe para evitar.
    assert.equal(breakTieByPlayedPlatform(tied, ['Sega Game Gear', 'Sega Master System']), null);
  });

  it('sin ninguna plataforma jugada registrada, el empate sigue en pie', () => {
    assert.equal(breakTieByPlayedPlatform(tied, []), null);
  });
});
