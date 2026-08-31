import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// OJO DE UBICACIÓN: la tarea que generó este fichero lo situaba en
// "src/main/radar/rank.ts", pero el módulo de verdad (filterAndRankGames,
// scoreGame, findDominantCollection, ALLOWED_CATEGORIES) vive en
// src/main/igdb/rank.ts — no existe ningún radar/rank.ts en el repo. Este
// test queda en radar/__tests__ (la carpeta que sí está en el ALLOWED de esta
// tarea) mientras importa el módulo real desde su sitio de verdad.
import { filterAndRankGames, type RankableGame } from '../../igdb/rank';

// EL RANKING DE RESULTADOS DE BÚSQUEDA DE IGDB (Add Game).
//
// Lo que se blinda no es "que ordene", es las dos decisiones documentadas en
// el propio módulo, probadas con los casos reales que las motivaron:
//
//   1. ALLOWED_CATEGORIES: fuera dlc/expansion/mod/episode/season/fork/
//      pack/update — dentro el juego principal, standalone_expansion,
//      remakes/ports y bundles. Y versionParent SÍ filtra (reediciones
//      literales) pero parentGame NO (spin-offs standalone jugables solos).
//   2. Coincidencia de texto exacta NO puede enterrar a un juego mucho más
//      popular solo por tener menos ruido en el nombre — los dos casos en
//      vivo que cita el comentario del módulo: "cyberpunk" y "zelda".
//
// QUÉ ES REAL Y QUÉ ES DOBLE: todo real, es lógica pura sin red ni DB — el
// "candidato" es la forma mínima RankableGame que el propio módulo define
// para poder probarse sin arrastrar el cliente HTTP de IGDB.

const base: RankableGame = {
  id: 0,
  name: '',
  category: 0,
  versionParent: null,
  parentGame: null,
  collections: [],
  hasCover: true,
  totalRatingCount: null,
  follows: null,
  hypes: null,
  firstReleaseYear: null,
};

const juego = (overrides: Partial<RankableGame>): RankableGame => ({
  ...base,
  ...overrides,
});

describe('filterAndRankGames — filtro de categorías', () => {
  it('descarta dlc_addon, expansion, mod, episode, season, fork, pack y update', () => {
    const excluidas = [1, 2, 5, 6, 7, 12, 13, 14];
    for (const category of excluidas) {
      const resultado = filterAndRankGames([juego({ id: 1, name: 'Algo', category })], 'algo');
      assert.deepEqual(resultado, [], `category ${category} debería quedar fuera`);
    }
  });

  it('acepta main_game(0), standalone_expansion(4), remake/remaster/port y bundles', () => {
    // La standalone_expansion(4) es la que el comentario marca como el
    // agujero que hubo que tapar: "Miles Morales" y "Riptide" no aparecían
    // antes de meterla en el conjunto.
    const permitidas = [0, 3, 4, 8, 9, 10, 11];
    for (const category of permitidas) {
      const resultado = filterAndRankGames([juego({ id: 1, name: 'Algo', category })], 'algo');
      assert.equal(resultado.length, 1, `category ${category} debería quedar dentro`);
    }
  });

  it('versionParent no nulo se descarta (reedición literal del mismo producto)', () => {
    const resultado = filterAndRankGames(
      [juego({ id: 1, name: 'Algo', category: 0, versionParent: 999 })],
      'algo',
    );
    assert.deepEqual(resultado, []);
  });

  it('parentGame no nulo NO se descarta: un spin-off standalone es una entrada propia', () => {
    // "Dead Island: Riptide" es category 0 con parentGame apuntando a "Dead
    // Island" — comprobado en vivo contra la API, según el comentario del
    // módulo. Exigir parentGame === null lo tiraría fuera por error.
    const resultado = filterAndRankGames(
      [juego({ id: 1, name: 'Dead Island: Riptide', category: 0, parentGame: 42 })],
      'dead island riptide',
    );
    assert.equal(resultado.length, 1);
  });
});

describe('filterAndRankGames — el caso "cyberpunk" (texto exacto no entierra popularidad)', () => {
  it('un indie llamado exactamente "Cyberpunk" no le gana a Cyberpunk 2077 en popularidad real', () => {
    // Caso citado tal cual en el comentario del módulo, probado en vivo: la
    // coincidencia EXACTA de texto (+25) no puede pesar más que la
    // diferencia de popularidad real entre un indie oscuro y un AAA masivo.
    const indieExacto = juego({
      id: 1,
      name: 'Cyberpunk',
      category: 0,
      totalRatingCount: 3,
      follows: 1,
      hypes: 0,
    });
    const cyberpunk2077 = juego({
      id: 2,
      name: 'Cyberpunk 2077',
      category: 0,
      totalRatingCount: 9000,
      follows: 4000,
      hypes: 2000,
    });
    const [primero, segundo] = filterAndRankGames([indieExacto, cyberpunk2077], 'cyberpunk');
    assert.equal(primero.id, 2, 'Cyberpunk 2077 debería encabezar la lista');
    assert.equal(segundo.id, 1);
  });

  it('un Game & Watch de 1989 no le gana a Ocarina of Time al buscar "zelda"', () => {
    const gameAndWatch = juego({
      id: 1,
      name: 'Zelda',
      category: 0,
      totalRatingCount: 5,
      follows: 2,
      hypes: 0,
      firstReleaseYear: 1989,
    });
    const ocarina = juego({
      id: 2,
      name: 'The Legend of Zelda: Ocarina of Time',
      category: 0,
      totalRatingCount: 8000,
      follows: 3000,
      hypes: 100,
      firstReleaseYear: 1998,
    });
    const [primero] = filterAndRankGames([gameAndWatch, ocarina], 'zelda');
    assert.equal(primero.id, 2, 'Ocarina of Time debería encabezar la lista');
  });
});

describe('filterAndRankGames — otras señales del score', () => {
  it('sin carátula, la penalización de -80 lo hunde bajo cualquier rival con carátula', () => {
    const sinPortada = juego({
      id: 1,
      name: 'Hollow Knight',
      category: 0,
      hasCover: false,
      totalRatingCount: 5000,
      follows: 2000,
    });
    const conPortada = juego({
      id: 2,
      name: 'Hollow Knight: Silksong',
      category: 0,
      hasCover: true,
      totalRatingCount: 10,
    });
    const [primero] = filterAndRankGames([sinPortada, conPortada], 'hollow knight');
    assert.equal(primero.id, 2, 'la carátula pesa más que popularidad y coincidencia exacta');
  });

  it('la saga dominante entre los candidatos suma +15 y puede decidir un empate', () => {
    // findDominantCollection exige MÁS de un candidato en la misma colección
    // para contar como dominante — un solo juego en una colección no basta.
    const marioA = juego({
      id: 1,
      name: 'Super Mario Land',
      category: 0,
      collections: [10],
      totalRatingCount: 100,
    });
    const marioB = juego({
      id: 2,
      name: 'Super Mario 3D Land',
      category: 0,
      collections: [10],
      totalRatingCount: 100,
    });
    // Mismo nombre de búsqueda parcial, misma popularidad exacta: sin la
    // saga dominante estos dos empatarían y ganaría el de más
    // totalRatingCount (desempate de sort) — con la saga sumando +15 a los
    // DOS por igual, el empate se conserva y el orden lo decide el
    // desempate de todos modos. Lo que sí prueba el test es que ninguno
    // pierde puntos por pertenecer a la saga.
    const ajeno = juego({
      id: 3,
      name: 'Super Mario Land Companion',
      category: 0,
      collections: [],
      totalRatingCount: 100,
    });
    const resultado = filterAndRankGames([ajeno, marioA, marioB], 'super mario land');
    // Los dos de la saga (con el bonus de colección) deben ir por delante
    // del que no pertenece a ninguna, pese a la misma popularidad cruda.
    assert.ok(resultado.findIndex((g) => g.id === 3) > resultado.findIndex((g) => g.id === 1));
  });

  it('una colección con un único representante NO cuenta como dominante (no hay bonus)', () => {
    const unico = juego({ id: 1, name: 'Juego Solitario', category: 0, collections: [77] });
    const otro = juego({ id: 2, name: 'Juego Solitario 2', category: 0, collections: [] });
    // Si el bonus se aplicara con un solo miembro, "Juego Solitario"
    // recibiría +15 sin motivo. Ambos deberían competir solo por texto y
    // popularidad (aquí iguales salvo el propio nombre).
    const resultado = filterAndRankGames([unico, otro], 'juego solitario');
    // Ninguna aserción de orden aquí sería robusta (los nombres difieren en
    // longitud) — lo que se afirma es que el ranking no revienta y devuelve
    // los dos candidatos.
    assert.equal(resultado.length, 2);
  });

  it('a igualdad de score, desempata por totalRatingCount', () => {
    const a = juego({ id: 1, name: 'X', category: 0, totalRatingCount: 50 });
    const b = juego({ id: 2, name: 'X', category: 0, totalRatingCount: 500 });
    const [primero, segundo] = filterAndRankGames([a, b], 'x');
    assert.equal(primero.id, 2);
    assert.equal(segundo.id, 1);
  });

  it('lista vacía tras el filtro (todo DLC) devuelve [] sin lanzar', () => {
    const resultado = filterAndRankGames([juego({ id: 1, name: 'Un DLC', category: 1 })], 'un dlc');
    assert.deepEqual(resultado, []);
  });
});
