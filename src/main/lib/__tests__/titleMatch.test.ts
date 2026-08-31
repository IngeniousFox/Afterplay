import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  diceCoefficient,
  findBestTitleMatch,
  normalizeTitle,
  unixSecondsToUtcYear,
} from '../titleMatch';

// LA REGLA COMPARTIDA DE EMPAREJADO DE TÍTULOS (HLTB + SteamGridDB).
//
// Lo que se blinda aquí no es "que normalice", es las DECISIONES que separan
// un match bueno de uno que cuela el juego equivocado:
//
//   1. Separadores (: - – /) se vuelven espacio, pero los NÚMEROS (romanos o
//      no) se dejan tal cual — a propósito, según el propio comentario del
//      fichero, porque tocarlos daría más falsos positivos.
//   2. El umbral mínimo de nombre (0.5) descarta ediciones/GOTY que comparten
//      casi todo el título con el juego base pero no bastante.
//   3. El año es el desempate fuerte entre candidatos con nombre casi idéntico
//      (el juego base contra su Directors's Cut / secuela numerada).
//   4. Sin año en ninguno de los dos lados, no hay bonus ni penalización.
//
// QUÉ ES REAL Y QUÉ ES DOBLE: todo real, son funciones puras sin red ni DB.

describe('normalizeTitle', () => {
  it('minúsculas, y los tres separadores (: - –) se vuelven espacio', () => {
    assert.equal(normalizeTitle('Mass Effect: Andromeda'), 'mass effect andromeda');
    assert.equal(normalizeTitle('Mass Effect - Andromeda'), 'mass effect andromeda');
    assert.equal(normalizeTitle('Mass Effect – Andromeda'), 'mass effect andromeda');
    // Las tres formas de separador colapsan al MISMO texto normalizado —
    // así HLTB (que suele usar guion) y SteamGridDB (que puede usar dos
    // puntos) comparan como si fueran el mismo título.
  });

  it('quita los apóstrofos en vez de convertirlos en espacio', () => {
    // Si un apóstrofo se volviera espacio, "Baldur's Gate" partiría en
    // "baldur s gate" y perdería un bigrama entero contra "baldurs gate".
    assert.equal(normalizeTitle("Baldur's Gate 3"), 'baldurs gate 3');
    assert.equal(normalizeTitle('Baldur’s Gate 3'), 'baldurs gate 3'); // comilla tipográfica
  });

  it('los números NO se tocan: ni romanos a arábigos ni viceversa', () => {
    // Documentado en el propio fichero como decisión deliberada: tocar los
    // números daría más falsos positivos que dejarlos. Este test caracteriza
    // esa decisión para que nadie la "arregle" sin darse cuenta de que ya se
    // consideró y se descartó.
    assert.equal(normalizeTitle('Final Fantasy VII'), 'final fantasy vii');
    assert.equal(normalizeTitle('Final Fantasy 7'), 'final fantasy 7');
    assert.notEqual(normalizeTitle('Final Fantasy VII'), normalizeTitle('Final Fantasy 7'));
  });

  it('espacios repetidos y extremos se colapsan', () => {
    assert.equal(normalizeTitle('  Hollow   Knight  '), 'hollow knight');
  });

  it('un acento fuera del rango a-z se convierte en espacio, no se elimina sin más', () => {
    // Consecuencia real de `[^a-z0-9 ]` -> ' ': "Pokémon" no queda "pokmon"
    // (acento borrado) sino "pok mon" (acento sustituido por espacio, la
    // palabra se PARTE). Se caracteriza aquí porque es el tipo de sorpresa
    // que un refactor "más limpio" (ej. pasar a eliminar en vez de
    // sustituir) cambiaría en silencio sin que ningún test lo cantara.
    assert.equal(normalizeTitle('Pokémon Sword'), 'pok mon sword');
  });
});

describe('diceCoefficient', () => {
  it('cadenas idénticas dan 1 exacto, sin pasar por los bigramas', () => {
    assert.equal(diceCoefficient('hollow knight', 'hollow knight'), 1);
  });

  it('con una cadena de menos de 2 caracteres, 0 en vez de lanzar', () => {
    // Guarda explícita del código: sin ella, a.length - 1 + b.length - 1
    // podría salir 0 y dividir por cero.
    assert.equal(diceCoefficient('a', 'ab'), 0);
    assert.equal(diceCoefficient('', 'ab'), 0);
  });

  it('un acento que parte la palabra en dos sigue dando una similitud alta', () => {
    // "pok mon sword" vs "pokemon sword": el hueco por el acento pierde solo
    // un puñado de bigramas de los dos lados, y con títulos largos eso no
    // basta para tirar la coincidencia por debajo del umbral de match — el
    // valor exacto (medido, no adivinado) documenta cuánto cuesta el acento.
    const score = diceCoefficient(normalizeTitle('Pokémon Sword'), normalizeTitle('Pokemon Sword'));
    assert.ok(score > 0.8, `esperaba > 0.8, salió ${score}`);
  });
});

describe('unixSecondsToUtcYear', () => {
  it('usa el año en UTC, no el de la zona horaria local', () => {
    // 2023-01-01T00:00:00Z: en cualquier zona horaria con offset negativo
    // (América) un cálculo que usara getFullYear() local devolvería 2022.
    assert.equal(unixSecondsToUtcYear(1672531200), 2023);
    // Un segundo antes, 2022-12-31T23:59:59Z, sigue siendo el año viejo.
    assert.equal(unixSecondsToUtcYear(1672531199), 2022);
  });
});

// ── findBestTitleMatch: las decisiones de negocio ───────────────────────────

type Candidato = { name: string; year: number | undefined };

const buscar = (
  candidatos: Candidato[],
  targetName: string,
  targetYear: number | null,
): Candidato | null =>
  findBestTitleMatch(
    candidatos,
    (c) => c.name,
    (c) => c.year,
    targetName,
    targetYear,
  );

describe('findBestTitleMatch', () => {
  it('por debajo del umbral de nombre (0.5), "sin match" en vez de colar cualquier cosa', () => {
    // Es la regla de negocio explícita del comentario: preferir "sin datos" a
    // un juego equivocado. "Stardew Valley" no debería aparecer como mejor
    // candidato de una búsqueda de "Hollow Knight" solo por ser lo único
    // en la lista.
    const resultado = buscar([{ name: 'Stardew Valley', year: 2016 }], 'Hollow Knight', 2017);
    assert.equal(resultado, null);
  });

  it('una "Game of the Year Edition" no pasa el umbral cuando se busca el juego base', () => {
    // Medido: dice("god of war", "god of war game of the year edition") =
    // 0.419, por debajo de 0.5. Es justo el caso que motiva el umbral: sin
    // él, la GOTY se colaría con nombre "parecido" aunque el juego real no
    // esté en la lista de candidatos.
    const resultado = buscar(
      [{ name: 'God of War: Game of the Year Edition', year: 2018 }],
      'God of War',
      2018,
    );
    assert.equal(resultado, null);
  });

  it('entre el juego base y su edición, gana el que tiene AMBOS coincidencia y año', () => {
    const base = { name: 'God of War', year: 2018 };
    const secuela = { name: 'God of War Ragnarök', year: 2022 };
    const resultado = buscar([base, secuela], 'God of War', 2018);
    assert.equal(resultado, base);
  });

  it('con nombres casi idénticos por los números sin normalizar, el AÑO desempata', () => {
    // "Final Fantasy VII" (1997) contra su remake "Final Fantasy VII
    // Remake" (2020): el nombre por sí solo casi no distingue textualmente
    // (dice alto en los dos, dominado por "final fantasy vii" compartido),
    // así que sin el año el match sería ambiguo — el año es lo que de
    // verdad decide.
    const original = { name: 'Final Fantasy VII', year: 1997 };
    const remake = { name: 'Final Fantasy VII Remake', year: 2020 };
    assert.equal(buscar([original, remake], 'Final Fantasy VII', 1997), original);
    assert.equal(buscar([original, remake], 'Final Fantasy VII', 2020), remake);
  });

  it('año exacto (+0.15) le gana a un año vecino (+0.05) con el mismo nombre', () => {
    const candidatoLejano = { name: 'Reedición', year: 2010 };
    const candidatoCercano = { name: 'Reedición', year: 2011 };
    const candidatoExacto = { name: 'Reedición', year: 2012 };
    const resultado = buscar(
      [candidatoLejano, candidatoCercano, candidatoExacto],
      'Reedición',
      2012,
    );
    assert.equal(resultado, candidatoExacto);
  });

  it('un candidato sin año (undefined) no recibe ni bonus ni penalización', () => {
    // yearBonus solo se calcula si candidateYear !== undefined. Un candidato
    // sin año no debe ganarle a uno con año equivocado (penalizado) cuando
    // el nombre es igual de bueno en los dos — aquí el candidato sin año
    // debería imponerse porque el otro tiene un año lejano (penalización
    // fuerte: diff=8 => -0.2*5 = -1.0).
    const sinAño = { name: 'Juego Repetido', year: undefined };
    const añoLejano = { name: 'Juego Repetido', year: 2000 };
    const resultado = buscar([sinAño, añoLejano], 'Juego Repetido', 2008);
    assert.equal(resultado, sinAño);
  });

  it('targetYear null: nunca se aplica bonus de año aunque el candidato sí lo tenga', () => {
    const a = { name: 'Juego X', year: 1999 };
    const b = { name: 'Juego X', year: 2020 };
    // Con targetYear null, los dos empatan por completo (mismo nombre, sin
    // año que desempate) — gana el primero por el estricto ">" en el bucle.
    assert.equal(buscar([a, b], 'Juego X', null), a);
  });

  it('una diferencia de año grande penaliza pero no descarta si es el único candidato razonable', () => {
    // diff=5 => -0.2*5 = -1.0 de penalización, pero el nombre exacto (score
    // 1.0 de dice) más esa penalización sigue siendo mejor que "sin match":
    // sigue devolviendo el candidato en vez de null, porque el filtro de
    // umbral mira solo el NOMBRE, no el score final con año.
    const lejano = { name: 'Juego Único', year: 1990 };
    assert.equal(buscar([lejano], 'Juego Único', 1995), lejano);
  });

  it('lista vacía de candidatos: null, no lanza', () => {
    assert.equal(buscar([], 'Cualquier Cosa', 2020), null);
  });
});
