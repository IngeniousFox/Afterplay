import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { raConsoleIdsForPlatforms } from '../consoles';

// EL PUENTE IGDB -> ID DE CONSOLA DE RETROACHIEVEMENTS (ra/consoles.ts).
//
// El matching es por "contiene" sobre una lista corta de firmas, y el propio
// fichero avisa de la trampa: "las firmas más específicas antes que sus
// prefijos". Eso es una propiedad del ORDEN del array SIGNATURES, no del tipo
// — un test que solo comprobara "PlayStation 2 -> algún id" no detectaría que
// alguien reordenó el array y ahora "playstation 2" cae en el "playstation"
// genérico (PS1).
//
// QUÉ BLINDA:
//   · Que una firma específica ("game boy advance") gana a su prefijo más
//     corto ("game boy") cuando las dos matchean el mismo string.
//   · Que las firmas UNSUPPORTED (-1: "reconocida y descartada") de verdad
//     bloquean el fallback al genérico. Esta es la que más duele si se
//     rompe: sin la entrada explícita de 'playstation 3', ese string SÍ
//     matchea el 'playstation' genérico (PS1, id 12) por ser sustring, y el
//     juego terminaría con el ID de consola EQUIVOCADO en vez de sin
//     emparejar — el peor de los dos fallos posibles, porque no se nota.
//   · null/vacío/plataformas sin firma no revientan y no añaden nada.
//   · La deduplicación cuando dos plataformas de un mismo juego mapean al
//     mismo id de consola (un clásico multiplataforma).
//
// QUÉ ES REAL: la función pura, sin ningún doble — no toca red ni base.

describe('raConsoleIdsForPlatforms: la firma más específica gana a su prefijo', () => {
  it('"Game Boy Advance" empareja con Advance (5), no con el genérico Game Boy (4)', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['Nintendo Game Boy Advance']), [5]);
  });

  it('"Game Boy Color" empareja con Color (6), no con el genérico Game Boy (4)', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['Nintendo Game Boy Color']), [6]);
  });

  it('el "Game Boy" original (sin Advance ni Color) sí cae en el genérico (4)', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['Nintendo Game Boy']), [4]);
  });

  it('"PlayStation 2" empareja con su firma propia (21), no con "PlayStation" (12, PS1)', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['Sony PlayStation 2']), [21]);
  });

  it('el "PlayStation" original (PS1) sí cae en el genérico (12)', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['Sony PlayStation']), [12]);
  });
});

describe('raConsoleIdsForPlatforms: las firmas UNSUPPORTED bloquean el fallback al genérico', () => {
  it('"PlayStation 3" se reconoce y se descarta: NO cae en el "PlayStation" genérico (evitaría un ID de PS1 falso)', () => {
    // Sin la entrada explícita ['playstation 3', -1] delante del genérico,
    // "playstation 3".includes("playstation") es cierto y el juego quedaría
    // MAL emparejado con la consola de PS1 en vez de sin emparejar.
    assert.deepEqual(raConsoleIdsForPlatforms(['Sony PlayStation 3']), []);
  });

  it('"Wii U" se reconoce y se descarta: NO cae en el "Wii" genérico (19)', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['Nintendo Wii U']), []);
  });

  it('"Nintendo 3DS" se reconoce y se descarta: no aparece ningún id', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['Nintendo 3DS']), []);
  });
});

describe('raConsoleIdsForPlatforms: casos sin firma y de entrada vacía', () => {
  it('platforms null devuelve la lista vacía', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(null), []);
  });

  it('un array vacío devuelve la lista vacía', () => {
    assert.deepEqual(raConsoleIdsForPlatforms([]), []);
  });

  it('una plataforma sin ninguna firma (PC) se ignora sin romper nada', () => {
    assert.deepEqual(raConsoleIdsForPlatforms(['PC (Microsoft Windows)']), []);
  });

  it('mezcla de plataformas con y sin firma: solo entran las que emparejan', () => {
    assert.deepEqual(
      raConsoleIdsForPlatforms(['PC (Microsoft Windows)', 'Nintendo 64', 'Xbox Series X|S']).sort(
        (a, b) => a - b,
      ),
      [2],
    );
  });
});

describe('raConsoleIdsForPlatforms: deduplicación y multi-consola', () => {
  it('un multiplataforma clásico (Sonic: Game Gear, Master System, Mega Drive) da las TRES consolas', () => {
    const ids = raConsoleIdsForPlatforms([
      'Sega Game Gear',
      'Sega Master System',
      'Sega Mega Drive',
    ]);
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      [1, 11, 15],
    );
  });

  it('dos plataformas que mapean al MISMO id de consola no se duplican', () => {
    // "Mega Drive" y "Genesis" son la misma consola en dos nombres — IGDB no
    // es consistente y a veces trae los dos en officialPlatforms.
    assert.deepEqual(raConsoleIdsForPlatforms(['Sega Mega Drive', 'Sega Genesis']), [1]);
  });
});
