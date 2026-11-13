import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ULTRA_RARE,
  ULTRA_VIOLET,
  RARE,
  isRare,
  percentLabel,
  rarityAccent,
  sortAchievements,
} from '../../achievements';
import { AMBER, BLUE, GREEN, TEAL, VIOLET } from '../../colors';
import { daysBetween, DAY_MS, humanizeSpan, humanizeSpanByPrecision } from '../../dateMath';
import type { DateValue } from '../../dateTypes';
import {
  formatBytes,
  formatCount,
  formatElapsed,
  formatHours,
  formatMoney,
  pluralize,
} from '../../format';
import {
  bestRating,
  CRITICS_COLOR,
  MIN_CRITIC_COUNT,
  MIN_STEAM_REVIEWS,
  MIN_USER_COUNT,
  PLAYERS_COLOR,
  resolveRatings,
  STEAM_BLUE,
} from '../../ratings';
import type { GameRatingFields } from '../../ratings';
import { formatRelease, isUnreleased, releaseCountdown } from '../../releaseDate';

// LOS CASOS "A CONTRA A" que vivían en web/src/lib/__tests__/paridad.test.ts.
//
// Allí comparaban la PWA con el escritorio, pero las dos mitades ya re-exportan
// la MISMA función de src/shared: comparar f(x) con f(x) no puede fallar nunca,
// y un fallo compartido "estaría de acuerdo consigo mismo". Aquí cada escenario
// se conserva con su valor ESPERADO escrito, contra la función única.
//
// Donde el escritorio manda Date y la PWA milisegundos (lo único que sobrevive
// a un JSON), el caso se ejecuta en LAS DOS MONEDAS: esa diferencia sí es real
// y la función compartida tiene que dar lo mismo con cualquiera.
//
// Sin 'Z' a propósito: los textos esperados suponen hora local española y por
// eso las fechas caen a mediodía, lejos de cualquier frontera de día.

// El mismo instante en las dos monedas.
const monedas = (iso: string): [Date, number] => {
  const date = new Date(iso);
  return [date, date.getTime()];
};

// f(Date) y f(ms) tienen que decir lo mismo, y eso mismo es `esperado`.
const enLasDos = <R>(
  isos: string[],
  run: (...values: DateValue[]) => R,
  esperado: R,
  mensaje?: string,
): void => {
  const pares = isos.map(monedas);
  assert.deepEqual(run(...pares.map(([date]) => date)), esperado, mensaje);
  assert.deepEqual(run(...pares.map(([, ms]) => ms)), esperado, mensaje);
};

// ══ FORMATO DE CIFRAS ══════════════════════════════════════════════════════

describe('formato de cifras', () => {
  it('las horas se parten en "Xh Ym" con un único redondeo a minutos', () => {
    // 2.0083 h son 2 h y 30 s: redondear hacia arriba diría "2h 1m".
    const casos: Array<[number, string]> = [
      [0.004, '0h'],
      [0.009, '0h 1m'],
      [0.5, '0h 30m'],
      [2.0083, '2h'],
      [12.5, '12h 30m'],
      [99.999, '100h'],
    ];
    for (const [horas, esperado] of casos) assert.equal(formatHours(horas), esperado);
  });

  it('una duración negativa se pinta como "0h", nunca con signo', () => {
    // Sesiones con el fin antes del inicio (reloj corregido, edición manual).
    assert.equal(formatHours(-1), '0h');
    assert.equal(formatElapsed(-5), '00:00:00');
  });

  it('el contador de una sesión en marcha sigue contando más allá de las 24 h', () => {
    // Y los segundos se truncan para que el contador nunca vaya por delante.
    assert.equal(formatElapsed(86400), '24:00:00');
    assert.equal(formatElapsed(359999), '99:59:59');
    assert.equal(formatElapsed(12.7), '00:00:12');
  });

  it('un conteo grande se abrevia y ningún tramo escupe la cifra del siguiente', () => {
    assert.equal(formatCount(415946), '416K');
    assert.equal(formatCount(9999), '9,999');
    assert.equal(formatCount(1_000_000), '1.0M');
    // El corte se mira sobre lo que se va a escribir: 99.999 no es "100.0K".
    assert.equal(formatCount(99_999), '100K');
    assert.equal(formatCount(100_000), '100K');
    assert.equal(formatCount(99_949), '99.9K');
    assert.equal(formatCount(10_000), '10.0K');
    // El mismo escalón un piso más arriba: 999.999 no es "1000K".
    assert.equal(formatCount(999_999), '1.0M');
    assert.equal(formatCount(999_499), '999K');
  });

  it('las tallas saltan a GB a los 1000 MB, no a los 1024', () => {
    assert.equal(formatBytes(999 * 1048576), '999 MB');
    assert.equal(formatBytes(1000 * 1048576), '1.0 GB');
    assert.equal(formatBytes(322 * 1024), '322 KB');
  });

  it('cero bytes son cero bytes: el suelo de 1 KB no arrastra al vacío', () => {
    assert.equal(formatBytes(0), '0 KB');
    assert.equal(formatBytes(-2048), '0 KB');
    assert.equal(formatBytes(1), '1 KB');
    assert.equal(formatBytes(400), '1 KB');
    assert.equal(formatBytes(1024), '1 KB');
  });

  it('el euro lleva punto decimal aunque el teléfono esté en español', () => {
    assert.equal(formatMoney(59.99), '€59.99');
    assert.equal(formatMoney(0), '€0.00');
    assert.equal(pluralize(1, 'game'), '1 game');
    assert.equal(pluralize(0, 'game'), '0 games');
  });
});

// ══ TRAMOS DE TIEMPO ═══════════════════════════════════════════════════════

describe('tramos de tiempo, con Date y con milisegundos', () => {
  it('un tramo con precisión de día mide tiempo REAL, no días de calendario', () => {
    // LA CICATRIZ: del 1 de marzo a las 23:00 al 2 a la 01:00 hay dos horas.
    const tramo = ['2026-03-01T23:00', '2026-03-02T01:00'];
    enLasDos(tramo, (a, b) => humanizeSpanByPrecision(a, b, 'day', 'day'), 'less than a day');
    enLasDos(
      tramo,
      (a, b) => humanizeSpanByPrecision(a, b, 'datetime', 'datetime'),
      'less than a day',
    );
  });

  it('la precisión más GRUESA de las dos manda', () => {
    const tramo = ['2026-01-31T23:00', '2026-02-01T00:30'];
    enLasDos(tramo, (a, b) => humanizeSpanByPrecision(a, b, 'datetime', 'month'), '1 month');
    enLasDos(tramo, (a, b) => humanizeSpanByPrecision(a, b, 'month', 'datetime'), '1 month');
    enLasDos(tramo, (a, b) => humanizeSpanByPrecision(a, b, 'year', 'day'), 'Same year');
  });

  it('caer dentro del mismo mes o año se DICE, no se convierte en una duración', () => {
    const anio = ['2021-01-01T00:00', '2021-12-01T00:00'];
    enLasDos(anio, (a, b) => humanizeSpanByPrecision(a, b, 'year', 'year'), 'Same year');
    enLasDos(anio, (a, b) => humanizeSpanByPrecision(a, b, 'month', 'day'), '11 months');
    enLasDos(
      ['2026-03-05T10:00', '2026-03-25T10:00'],
      (a, b) => humanizeSpanByPrecision(a, b, 'month', 'day'),
      'Same month',
    );
  });

  it('humanizeSpan cambia de unidad en los mismos cortes exactos', () => {
    const casos: Array<[number, string]> = [
      [0, 'less than a day'],
      [0.5, 'less than a day'],
      [1, '1 day'],
      [1.4, '1 day'],
      [59, '59 days'],
      [59.9, '60 days'],
      [60, '2 months'],
      [90, '3 months'],
      [729, '24 months'],
      [730, '2 years'],
      [3650, '10 years'],
    ];
    for (const [dias, esperado] of casos) assert.equal(humanizeSpan(dias), esperado);
  });

  it('daysBetween da el mismo número con Date y con ms: tiempo transcurrido', () => {
    const [desde, desdeMs] = monedas('2026-01-10T18:00');
    const [hasta, hastaMs] = monedas('2026-04-20T09:00');
    // Calculado y no escrito: depende de si la zona tiene cambio de hora.
    const esperado = (hastaMs - desdeMs) / DAY_MS;
    assert.equal(daysBetween(desde, hasta), esperado);
    assert.equal(daysBetween(desdeMs, hastaMs), esperado);
  });
});

// ══ NOTAS ══════════════════════════════════════════════════════════════════

const juego = (overrides: Partial<GameRatingFields> = {}): GameRatingFields => ({
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
  steamPositive: null,
  steamNegative: null,
  ...overrides,
});

describe('notas: las tres muestras y sus umbrales', () => {
  it('los umbrales de muestra y los colores de las tres notas', () => {
    assert.equal(MIN_CRITIC_COUNT, 3);
    assert.equal(MIN_USER_COUNT, 10);
    assert.equal(MIN_STEAM_REVIEWS, 30);
    assert.equal(STEAM_BLUE, '#66a3d2');
    assert.equal(CRITICS_COLOR, TEAL);
    assert.equal(PLAYERS_COLOR, BLUE);
  });

  it('justo por debajo del umbral no hay nota; justo en él, sí', () => {
    const casi = resolveRatings(
      juego({ ratingCritics: 88, ratingCriticsCount: 2, ratingUsers: 74, ratingUsersCount: 9 }),
    );
    assert.equal(casi.critics, null);
    assert.equal(casi.players, null);

    const justo = resolveRatings(
      juego({ ratingCritics: 88, ratingCriticsCount: 3, ratingUsers: 74, ratingUsersCount: 10 }),
    );
    assert.equal(justo.critics, 88);
    assert.equal(justo.players, 74);
  });

  it('la nota de Steam es la PROPORCIÓN de positivas y necesita 30 reseñas en total', () => {
    assert.equal(resolveRatings(juego({ steamPositive: 29, steamNegative: 0 })).steam, null);
    // Un 0% con muestra suficiente es una nota REAL, no un hueco.
    assert.equal(resolveRatings(juego({ steamPositive: 0, steamNegative: 30 })).steam, 0);
    const hollow = resolveRatings(juego({ steamPositive: 415_946, steamNegative: 20_000 }));
    assert.equal(hollow.steam, 95);
    assert.equal(hollow.steamCount, 435_946);
  });

  it('bestRating respeta el orden de autoridad: crítica, comunidad, Steam', () => {
    const lasTres = juego({
      ratingCritics: 91,
      ratingCriticsCount: 40,
      ratingUsers: 84,
      ratingUsersCount: 900,
      steamPositive: 9000,
      steamNegative: 1000,
    });
    assert.equal(bestRating(lasTres), 91);
    assert.equal(bestRating({ ...lasTres, ratingCriticsCount: 2 }), 84);
    assert.equal(bestRating(juego({ steamPositive: 9000, steamNegative: 1000 })), 90);
    assert.equal(bestRating(juego({ ratingCritics: 88, ratingCriticsCount: 1 })), null);
  });

  it('un 0 de crítica REAL gana a un 88 de comunidad: es `??`, no `||`', () => {
    const machacado = juego({
      ratingCritics: 0,
      ratingCriticsCount: 12,
      ratingUsers: 88,
      ratingUsersCount: 500,
    });
    assert.equal(bestRating(machacado), 0);
  });

  it('la paleta compartida de acentos de identidad', () => {
    // Antes vigilaba una copia a mano de los hex en web/src/lib/status.ts; hoy
    // las dos apps re-exportan shared/colors.ts, así que se fija el valor.
    assert.equal(GREEN, '#2fdc7e');
    assert.equal(AMBER, '#e3b24a');
    assert.equal(BLUE, '#85a3d6');
    assert.equal(TEAL, '#2bb6a6');
    assert.equal(VIOLET, '#7c86c8');
  });
});

// ══ LOGROS ═════════════════════════════════════════════════════════════════

type Logro = { id: number; unlockedAt: DateValue | null; dateReliable: boolean };

// Un logro en la moneda pedida: lo único que mira el orden es id, fecha y
// fiabilidad.
const logro = (
  id: number,
  desbloqueado: string | null,
  fechaFiable = true,
): { pc: Logro; movil: Logro } => {
  const date = desbloqueado === null ? null : new Date(desbloqueado);
  return {
    pc: { id, unlockedAt: date, dateReliable: fechaFiable },
    movil: { id, unlockedAt: date === null ? null : date.getTime(), dateReliable: fechaFiable },
  };
};

const ordenEnLasDos = (logros: Array<{ pc: Logro; movil: Logro }>): number[] => {
  const pc = sortAchievements(logros.map((l) => l.pc)).map((l) => l.id);
  const movil = sortAchievements(logros.map((l) => l.movil)).map((l) => l.id);
  assert.deepEqual(movil, pc, 'la misma lista ordena distinto con Date y con ms');
  return pc;
};

describe('logros: rareza y orden canónico', () => {
  it('los cortes de rareza y el color de cada tramo', () => {
    assert.equal(RARE, 10);
    assert.equal(ULTRA_RARE, 5);
    const casos: Array<[number | null, string, boolean]> = [
      [null, GREEN, false],
      [0, ULTRA_VIOLET, true],
      [0.4, ULTRA_VIOLET, true],
      [4.9, ULTRA_VIOLET, true],
      // El 5 clavado ya NO es ultra raro; el 10 clavado ya no es raro.
      [5, AMBER, true],
      [5.1, AMBER, true],
      [9.9, AMBER, true],
      [10, GREEN, false],
      [10.1, GREEN, false],
      [100, GREEN, false],
    ];
    for (const [porcentaje, color, raro] of casos) {
      assert.equal(rarityAccent(porcentaje), color, `color de ${porcentaje}`);
      assert.equal(isRare(porcentaje), raro, `rareza de ${porcentaje}`);
    }
  });

  it('el decimal solo aparece por debajo del 10%, donde ES la noticia', () => {
    assert.equal(percentLabel(0.4), '0.4%');
    assert.equal(percentLabel(9.99), '10.0%');
    assert.equal(percentLabel(10), '10%');
    assert.equal(percentLabel(47.6), '48%');
  });

  const base = [
    logro(1, null),
    logro(2, '2026-01-10T18:00'),
    logro(3, '2026-02-10T18:00', false),
    logro(4, '2026-03-10T18:00'),
    logro(5, null),
  ];

  it('conseguidos primero, recientes arriba, fecha no fiable detrás', () => {
    assert.deepEqual(ordenEnLasDos(base), [4, 2, 3, 1, 5]);
  });

  it('las 120 permutaciones: los conseguidos siempre igual, los pendientes como llegan', () => {
    const permutaciones = <T>(xs: T[]): T[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto]),
          );
    const todas = permutaciones(base);
    assert.equal(todas.length, 120);
    for (const orden of todas) {
      const pendientes = orden.filter((l) => l.pc.unlockedAt === null).map((l) => l.pc.id);
      assert.deepEqual(ordenEnLasDos(orden), [4, 2, 3, ...pendientes]);
    }
  });

  it('los pendientes conservan el orden en que llegan (el de Steam)', () => {
    assert.deepEqual(ordenEnLasDos([logro(7, null), logro(8, null)]), [7, 8]);
    assert.deepEqual(ordenEnLasDos([logro(8, null), logro(7, null)]), [8, 7]);
  });

  it('un empate exacto de fecha no reordena nada', () => {
    const mismoInstante = [
      logro(11, '2026-01-10T18:00'),
      logro(12, '2026-01-10T18:00'),
      logro(13, '2026-01-10T18:00'),
    ];
    assert.deepEqual(ordenEnLasDos(mismoInstante), [11, 12, 13]);
  });
});

// ══ FECHA DE SALIDA ════════════════════════════════════════════════════════

const salida = (
  iso: string,
  precision: 'year' | 'month' | 'day',
): {
  pc: { releaseDate: Date; releaseDatePrecision: typeof precision; releaseYear: number };
  movil: { releaseDate: number; releaseDatePrecision: typeof precision; releaseYear: number };
} => {
  const date = new Date(iso);
  const comun = { releaseDatePrecision: precision, releaseYear: date.getFullYear() };
  return {
    pc: { ...comun, releaseDate: date },
    movil: { ...comun, releaseDate: date.getTime() },
  };
};

describe('salida: la honestidad de la precisión, con Date y con ms', () => {
  it('formatRelease no inventa el día que no se sabe', () => {
    const casos = [
      { iso: '1994-01-01T00:00', precision: 'year' as const, esperado: '1994' },
      { iso: '2026-03-01T00:00', precision: 'month' as const, esperado: 'March 2026' },
      { iso: '2026-09-10T00:00', precision: 'day' as const, esperado: 'September 10, 2026' },
    ];
    for (const { iso, precision, esperado } of casos) {
      const juegoSalida = salida(iso, precision);
      assert.equal(formatRelease(juegoSalida.pc), esperado);
      assert.equal(formatRelease(juegoSalida.movil), esperado);
    }
    assert.equal(
      formatRelease({ releaseDate: null, releaseDatePrecision: null, releaseYear: 2027 }),
      '2027',
    );
    assert.equal(
      formatRelease({ releaseDate: null, releaseDatePrecision: null, releaseYear: null }),
      null,
    );
  });

  it('un juego de "March 2026" no ha salido en febrero y sí ha salido en marzo y abril', () => {
    const marzo = salida('2026-03-01T00:00', 'month');
    for (const [iso, esperado] of [
      ['2026-02-14T12:00', true],
      ['2026-03-20T12:00', false],
      ['2026-04-02T12:00', false],
    ] as Array<[string, boolean]>) {
      const ahora = new Date(iso);
      assert.equal(isUnreleased(marzo.pc, ahora), esperado, iso);
      assert.equal(isUnreleased(marzo.movil, ahora), esperado, iso);
    }
  });

  it('el DÍA del lanzamiento sigue siendo espera hasta medianoche', () => {
    const dia = salida('2026-09-10T00:00', 'day');
    const elDia = new Date('2026-09-10T17:00');
    const alDiaSiguiente = new Date('2026-09-11T05:00');
    for (const juegoSalida of [dia.pc, dia.movil]) {
      assert.equal(isUnreleased(juegoSalida, elDia), true);
      assert.deepEqual(releaseCountdown(juegoSalida, elDia), { kind: 'today' });
      assert.equal(isUnreleased(juegoSalida, alDiaSiguiente), false);
      assert.deepEqual(releaseCountdown(juegoSalida, alDiaSiguiente), { kind: 'out-now' });
    }
  });

  it('la cuenta atrás solo existe con precisión de día, y el OUT NOW caduca', () => {
    const marzo = salida('2026-03-01T00:00', 'month');
    const febrero = new Date('2026-02-14T12:00');
    assert.equal(releaseCountdown(marzo.pc, febrero), null);
    assert.equal(releaseCountdown(marzo.movil, febrero), null);

    const dia = salida('2026-09-10T00:00', 'day');
    for (const [iso, esperado] of [
      ['2026-09-09T12:00', { kind: 'tomorrow' }],
      ['2026-09-04T12:00', { kind: 'soon', days: 6, imminent: true }],
      ['2026-08-25T12:00', { kind: 'soon', days: 16, imminent: false }],
      // El borde de la ventana: 30 días todavía cuentan, 31 ya no.
      ['2026-08-11T12:00', { kind: 'soon', days: 30, imminent: false }],
      ['2026-08-10T12:00', null],
      ['2026-10-01T12:00', { kind: 'out-now' }],
      ['2026-10-02T12:00', null],
    ] as Array<[string, unknown]>) {
      const ahora = new Date(iso);
      assert.deepEqual(releaseCountdown(dia.pc, ahora), esperado, iso);
      assert.deepEqual(releaseCountdown(dia.movil, ahora), esperado, iso);
    }
  });
});
