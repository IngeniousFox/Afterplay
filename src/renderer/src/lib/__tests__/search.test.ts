// QUE BLINDA: el pliegue de acentos y puntuacion de normalizeForSearch, tal y
// como lo describe su propio comentario — "pokemon" encuentra "Pokemon" con
// tilde, los apostrofos se ignoran del todo, los separadores de titulo caen a
// espacio y los NUMEROS se quedan (a diferencia del resto de puntuacion,
// porque en un titulo si distinguen: "Fallout 4" no es "Fallout").
//
// QUE ES REAL Y QUE ES DOBLE: filterByTitle es pura, la lista de items es un
// array literal — no hace falta ningun doble.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterByTitle } from '../search';

const items = (titles: string[]): { title: string }[] => titles.map((title) => ({ title }));

describe('filterByTitle', () => {
  it('pliega acentos: "pokemon" encuentra "Pokemon" con tilde', () => {
    const result = filterByTitle(items(['Pokémon Rojo', 'Otro juego']), 'pokemon');
    assert.deepEqual(
      result.map((i) => i.title),
      ['Pokémon Rojo'],
    );
  });

  it('ignora apostrofos del todo: "baldurs gate" encuentra "Baldur\'s Gate"', () => {
    const result = filterByTitle(items(["Baldur's Gate", 'Otro juego']), 'baldurs gate');
    assert.deepEqual(
      result.map((i) => i.title),
      ["Baldur's Gate"],
    );
  });

  it('los separadores de titulo (guion, dos puntos) pliegan a espacio', () => {
    const list = items(['Half-Life', 'Portal: 2']);
    assert.deepEqual(
      filterByTitle(list, 'half life').map((i) => i.title),
      ['Half-Life'],
    );
    assert.deepEqual(
      filterByTitle(list, 'portal 2').map((i) => i.title),
      ['Portal: 2'],
    );
  });

  it('los NUMEROS si distinguen: "fallout 4" no trae "Fallout" a secas', () => {
    const list = items(['Fallout', 'Fallout 4']);
    assert.deepEqual(
      filterByTitle(list, 'fallout 4').map((i) => i.title),
      ['Fallout 4'],
    );
    // pero "fallout" a secas SI trae los dos: es un prefijo valido de ambos.
    assert.deepEqual(
      filterByTitle(list, 'fallout')
        .map((i) => i.title)
        .sort(),
      ['Fallout', 'Fallout 4'],
    );
  });

  it('una busqueda vacia (o solo espacios) devuelve la lista intacta', () => {
    const list = items(['A', 'B']);
    assert.equal(filterByTitle(list, ''), list);
    assert.equal(filterByTitle(list, '   '), list);
  });
});
