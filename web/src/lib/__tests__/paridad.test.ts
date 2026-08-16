import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AchievementEntry, SessionWithGame } from '../../api';
import * as movilLogros from '../achievements';
import * as movilFormato from '../format';
import * as movilNotas from '../ratings';
import * as movilRelease from '../releaseDate';
import * as movilCubos from '../sessionGroups';
import * as movilPaleta from '../status';
import type { AchievementEntry as LogroEscritorio } from '../../../../src/shared/types';
import * as pcLogros from '../../../../src/renderer/src/lib/achievements';
import * as pcPaleta from '../../../../src/renderer/src/lib/colors';
import * as pcFechas from '../../../../src/renderer/src/lib/dateMath';
import * as pcFormato from '../../../../src/renderer/src/lib/format';
import * as pcNotas from '../../../../src/renderer/src/lib/ratings';
import * as pcRelease from '../../../../src/renderer/src/lib/releaseDate';
import * as pcCubos from '../../../../src/renderer/src/lib/sessionGroups';

// EL TEST DE DIVERGENCIA entre el escritorio y la PWA.
//
// REMOTO.md §3 parte el código en dos mitades con reglas distintas: lo que
// CALCULA una cifra (horas, estados, gasto repartido) se comparte de verdad
// —el Worker importa los ficheros reales del escritorio—, y lo que solo DA
// FORMA a una cifra ya calculada se COPIA, porque importarlo arrastraría a una
// PWA el grafo de tipos entero del proceso principal de Electron (la cabecera
// de web/src/lib/format.ts lo cuenta con nombres y apellidos).
//
// Copiar tiene un precio, y este fichero es quien lo cobra: aquí se llama a las
// DOS mitades con las MISMAS entradas y se exige la MISMA salida. Cuando
// además importa QUÉ contestan (y no solo que contesten lo mismo) se fija el
// texto exacto, porque dos copias que se tocan a la vez —que pasa: es un solo
// cambio de criterio aplicado en dos ficheros— se pondrían de acuerdo en el
// error sin que un test de pura igualdad se enterase.
//
// Las dos divergencias que ya pasaron DE VERDAD, y que este fichero deja
// clavadas para que no vuelvan:
//
//   · sortForDisplay (escritorio) frente a sortAchievements (móvil): la misma
//     lista de logros salía en distinto orden. Hoy coinciden, pero son dos
//     algoritmos distintos con el mismo resultado —el PC parte la lista en
//     conseguidos+pendientes y ordena solo la primera mitad; el móvil hace un
//     único sort de la lista entera—, y dos algoritmos distintos empatan solo
//     mientras nadie los toca. Por eso aquí se comparan las 120 PERMUTACIONES
//     de una lista, no un caso feliz: la diferencia entre ellos vive en la
//     estabilidad del orden, y la estabilidad no se ve con una lista ya
//     ordenada.
//   · humanizeSpanByPrecision medía días de CALENDARIO en el móvil y días
//     REALES en el escritorio. El mismo playthrough del 1 de marzo a las 23:00
//     al 2 a la 01:00 —dos horas— decía "less than a day" en el PC y "1 day" en
//     el móvil. Hoy los dos restan los timestamps tal cual.
//
// Las cuatro parejas se importan de verdad. La de la agrupación por día no
// podía: su mitad del escritorio vivía dentro de Sessions.tsx y este fichero la
// leía del fuente con readFileSync para evaluarla con new Function. Ya no —
// vive en src/renderer/src/lib/sessionGroups.ts (ver más abajo).
//
// Sin mock.module: aquí no se dobla nada, son funciones puras de los dos lados.
// Por eso los imports van arriba y no dentro de un before().

// ── Utilidades ─────────────────────────────────────────────────────────────

// Las dos mitades tienen que decir lo MISMO. `esperado`, cuando se pone, fija
// además QUÉ dicen.
const mismo = (movil: unknown, escritorio: unknown, esperado?: unknown): void => {
  assert.deepEqual(movil, escritorio, 'el móvil y el escritorio no dicen lo mismo');
  if (esperado !== undefined) assert.deepEqual(movil, esperado);
};

// El mismo instante en las dos monedas: el escritorio maneja Date y la PWA
// milisegundos, que es lo que sobrevive a un JSON. Cada caso se escribe UNA vez
// y se gasta en los dos lados.
//
// Sin 'Z' a propósito: todo lo que se compara aquí (los cubos por día, el mes
// de calendario, la medianoche) razona en hora LOCAL. Como las dos mitades
// corren en el mismo reloj, la comparación entre ellas es cierta en cualquier
// zona horaria; lo que sí supone hora española son los textos esperados, y por
// eso todos caen a mediodía, lejos de cualquier frontera de día.
const instante = (iso: string): { date: Date; ms: number } => {
  const date = new Date(iso);
  return { date, ms: date.getTime() };
};

// ── El gemelo que antes no se podía importar ───────────────────────────────
//
// ARREGLADO. La tabla de cubos de la pantalla de Sesiones vivía en el
// escritorio DENTRO de src/renderer/src/screens/Sessions.tsx: un `const`
// privado de un módulo que importa React, el router, lucide y seis hooks. No
// había forma de importarla desde un test de node, y copiar su tabla aquí
// habría fabricado una TERCERA copia — un tercer sitio del que divergir,
// dentro del test que existe para vigilar las divergencias. Así que este
// fichero LEÍA el .tsx con readFileSync, recortaba el cuerpo de la función a
// base de indexOf y lo evaluaba con new Function prestándole startOfDayMs y
// DAY_MS. Mordía, pero cualquier retoque a la firma o al cierre de la función
// rompía la extracción en vez de comparar nada, y el `monthScopeKey` que la
// función devuelve —el gancho del recap del diario— no lo miraba nadie.
//
// Ahora la mitad del escritorio vive en src/renderer/src/lib/sessionGroups.ts,
// aritmética de calendario sin React ni tipos del proceso principal, y se
// importa como las otras tres parejas. Sessions.tsx la usa desde ahí.
const cuboPC = (date: Date, now: Date): string => pcCubos.getSessionGroup(date, now).label;

// ── Fábricas ───────────────────────────────────────────────────────────────

// Un logro en las dos monedas a la vez. Solo lleva de verdad lo que el orden
// mira —id, fecha, fiabilidad—; el resto son los campos obligatorios del tipo,
// puestos para que el test hable de LOGROS y no de rellenar objetos.
type LogroGemelo = { movil: AchievementEntry; pc: LogroEscritorio };

const logro = (id: number, desbloqueado: string | null, fechaFiable = true): LogroGemelo => {
  const ms = desbloqueado === null ? null : new Date(desbloqueado).getTime();
  const comun = {
    id,
    apiName: `ACH_${id}`,
    displayName: `Logro ${id}`,
    description: null,
    iconUrl: null,
    iconGrayUrl: null,
    hidden: false,
    globalPercent: null,
    dateReliable: fechaFiable,
    sources: ['steam' as const],
  };
  return {
    movil: { ...comun, unlockedAt: ms },
    pc: {
      ...comun,
      unlockedAt: ms === null ? null : new Date(ms),
      sessionId: null,
      iterationId: null,
    },
  };
};

// Los ids en el orden en que cada mitad los pinta.
const ordenMovil = (logros: LogroGemelo[]): number[] =>
  movilLogros.sortAchievements(logros.map((l) => l.movil)).map((entrada) => entrada.id);

const ordenPC = (logros: LogroGemelo[]): number[] =>
  pcLogros.sortForDisplay(logros.map((l) => l.pc)).map((entrada) => entrada.id);

// Un juego con solo los campos de nota que las dos mitades miran.
type NotasDeJuego = movilNotas.GameRatingFields;

const juego = (overrides: Partial<NotasDeJuego> = {}): NotasDeJuego => ({
  ratingCritics: null,
  ratingCriticsCount: null,
  ratingUsers: null,
  ratingUsersCount: null,
  steamPositive: null,
  steamNegative: null,
  ...overrides,
});

// Una fila de sesión con lo único que la agrupación mira: cuándo empezó.
let siguienteSesion = 1;
const sesion = (empezo: string): SessionWithGame =>
  ({ id: siguienteSesion++, startedAt: new Date(empezo).getTime() }) as unknown as SessionWithGame;

// ══ FORMATO DE CIFRAS ══════════════════════════════════════════════════════

describe('formato: la misma cifra se lee igual en el PC y en el móvil', () => {
  it('las horas se parten en "Xh Ym" con el mismo redondeo a minutos', () => {
    // El redondeo a minutos es donde una copia se desvía sin que se note:
    // 2.0083 h son 2 h y 30 s, y basta redondear hacia arriba en un lado para
    // que la ficha del PC diga "2h 1m" y el móvil "2h" del mismo playthrough.
    for (const horas of [0.004, 0.009, 0.5, 2.0083, 12.5, 99.999]) {
      mismo(movilFormato.formatHours(horas), pcFormato.formatHours(horas));
    }
    mismo(movilFormato.formatHours(0.004), pcFormato.formatHours(0.004), '0h');
    mismo(movilFormato.formatHours(0.009), pcFormato.formatHours(0.009), '0h 1m');
    mismo(movilFormato.formatHours(12.5), pcFormato.formatHours(12.5), '12h 30m');
    mismo(movilFormato.formatHours(2.0083), pcFormato.formatHours(2.0083), '2h');
  });

  it('una duración negativa se pinta como "0h" en los dos, nunca con signo', () => {
    // Una duración negativa es un dato imposible, pero llega: una sesión con el
    // fin antes del inicio (reloj corregido a mano, edición manual) sale de la
    // derivación con horas en negativo. Las dos mitades tienen que taparlo
    // igual — un "-1h 0m" en una pantalla y un "0h" en la otra del mismo juego
    // sería peor que el propio dato malo.
    mismo(movilFormato.formatHours(-1), pcFormato.formatHours(-1), '0h');
    mismo(movilFormato.formatElapsed(-5), pcFormato.formatElapsed(-5), '00:00:00');
  });

  it('el contador de una sesión en marcha sigue contando horas más allá de las 24', () => {
    // No es un reloj de pared: una sesión de fin de semana pasa de 24 h y la
    // cuenta tiene que seguir subiendo, no volver a 00. Y los segundos se
    // truncan (no se redondean) para que el contador nunca vaya por delante.
    mismo(movilFormato.formatElapsed(86400), pcFormato.formatElapsed(86400), '24:00:00');
    mismo(movilFormato.formatElapsed(359999), pcFormato.formatElapsed(359999), '99:59:59');
    mismo(movilFormato.formatElapsed(12.7), pcFormato.formatElapsed(12.7), '00:00:12');
  });

  it('un conteo grande se abrevia por el mismo corte, y ningún tramo escupe la cifra del siguiente', () => {
    // La muestra de Hollow Knight (415.946 reseñas) es el caso que hizo nacer
    // esto: en un tile de 81px el número exacto no informaba de nada.
    mismo(movilFormato.formatCount(415946), pcFormato.formatCount(415946), '416K');
    mismo(movilFormato.formatCount(9999), pcFormato.formatCount(9999), '9,999');
    mismo(movilFormato.formatCount(1_000_000), pcFormato.formatCount(1_000_000), '1.0M');

    // ARREGLADO en las dos mitades a la vez. El tramo se elegía por el valor
    // CRUDO, así que 99.999 entraba en el del decimal y su propio redondeo lo
    // sacaba de él: "100.0K" justo antes de que 100.000 dijera "100K" — dos
    // formatos distintos para dos números que se diferencian en uno. Ahora el
    // corte se mira sobre lo que se va a escribir y los dos dicen "100K".
    mismo(movilFormato.formatCount(99_999), pcFormato.formatCount(99_999), '100K');
    mismo(movilFormato.formatCount(100_000), pcFormato.formatCount(100_000), '100K');
    // El borde de verdad del tramo: 99.949 todavía redondea a 99,9 millares y
    // se queda con su decimal. El decimal no se pierde, solo deja de mentir.
    mismo(movilFormato.formatCount(99_949), pcFormato.formatCount(99_949), '99.9K');
    mismo(movilFormato.formatCount(10_000), pcFormato.formatCount(10_000), '10.0K');

    // El mismo escalón un piso más arriba, que estaba igual de roto: 999.999
    // salía como "1000K", una abreviatura más larga que el tramo siguiente.
    mismo(movilFormato.formatCount(999_999), pcFormato.formatCount(999_999), '1.0M');
    mismo(movilFormato.formatCount(999_499), pcFormato.formatCount(999_499), '999K');
  });

  it('las tallas saltan a GB a los 1000 MB, no a los 1024', () => {
    // Los 24 MB de tierra de nadie salían como "1009 MB", que no se lee como
    // una talla. El valor sigue siendo base 1024 (1.0 GB, no 1.01): lo que se
    // movió es CUÁNDO se cambia de unidad, y se movió en los dos sitios.
    mismo(movilFormato.formatBytes(999 * 1048576), pcFormato.formatBytes(999 * 1048576), '999 MB');
    mismo(
      movilFormato.formatBytes(1000 * 1048576),
      pcFormato.formatBytes(1000 * 1048576),
      '1.0 GB',
    );
    // La mediana real de una partida guardada son 322 KB: por eso existe el
    // escalón de KB, porque "0 MB" no es una talla, es un redondeo.
    mismo(movilFormato.formatBytes(322 * 1024), pcFormato.formatBytes(322 * 1024), '322 KB');
  });

  it('cero bytes son cero bytes: el suelo de 1 KB ya no arrastra al vacío', () => {
    // ARREGLADO en las dos mitades a la vez. El suelo de 1 KB (Math.max(1, …))
    // existe para que un fichero de 400 bytes no diga "0", pero se llevaba
    // puesto también al cero: una carpeta vacía pesaba "1 KB", un inventario
    // en blanco decía tener algo, y una limpieza que no liberó nada anunciaba
    // "Freed 1 KB" con el mismo texto que una que sí liberó algo.
    mismo(movilFormato.formatBytes(0), pcFormato.formatBytes(0), '0 KB');
    // Los negativos son un dato imposible (una resta de tallas al revés) y se
    // tapan por el mismo lado, nunca con signo.
    mismo(movilFormato.formatBytes(-2048), pcFormato.formatBytes(-2048), '0 KB');
    // Y el suelo sigue en pie para lo que SÍ existe: un byte no es cero.
    mismo(movilFormato.formatBytes(1), pcFormato.formatBytes(1), '1 KB');
    mismo(movilFormato.formatBytes(400), pcFormato.formatBytes(400), '1 KB');
    mismo(movilFormato.formatBytes(1024), pcFormato.formatBytes(1024), '1 KB');
  });

  it('el euro lleva punto decimal aunque el teléfono esté en español', () => {
    // toFixed(2) y no toLocaleString: con el móvil en es-ES un "€12,50" se
    // colaría en una interfaz que por lo demás está entera en inglés.
    mismo(movilFormato.formatMoney(59.99), pcFormato.formatMoney(59.99), '€59.99');
    mismo(movilFormato.formatMoney(0), pcFormato.formatMoney(0), '€0.00');
    mismo(movilFormato.pluralize(1, 'game'), pcFormato.pluralize(1, 'game'), '1 game');
    mismo(movilFormato.pluralize(0, 'game'), pcFormato.pluralize(0, 'game'), '0 games');
  });
});

// ══ FORMATO DE FECHAS ══════════════════════════════════════════════════════

describe('formato: una fecha se pinta con la precisión que de verdad se sabe', () => {
  it('con precisión de año o de mes no se inventa el día ni la hora', () => {
    // Un evento con precisión de AÑO se guarda como el día 1 a medianoche. Sin
    // esta regla se enseñaría "January 1, 2021 · 00:00", que es un dato
    // inventado con pinta de dato exacto.
    const { date, ms } = instante('2021-01-01T00:00');
    mismo(movilFormato.formatDateOnly(ms, 'year'), pcFormato.formatDateOnly(date, 'year'), '2021');
    mismo(
      movilFormato.formatDateOnly(ms, 'month'),
      pcFormato.formatDateOnly(date, 'month'),
      'January 2021',
    );
    mismo(
      movilFormato.formatDateOnly(ms, 'day'),
      pcFormato.formatDateOnly(date, 'day'),
      'January 1, 2021',
    );
  });

  it('formatByPrecision escribe el mismo evento igual en las dos pantallas', () => {
    const { date, ms } = instante('2026-01-10T18:30');
    for (const precision of ['year', 'month', 'day', 'datetime'] as const) {
      mismo(
        movilFormato.formatByPrecision(ms, precision),
        pcFormato.formatByPrecision(date, precision, '24h'),
      );
    }
    mismo(
      movilFormato.formatByPrecision(ms, 'datetime'),
      pcFormato.formatByPrecision(date, 'datetime', '24h'),
      'Jan 10, 2026 · 18:30',
    );
  });

  it('la PWA pinta siempre en 24h, que es el DEFAULT del escritorio (y no es un descuido)', () => {
    // Se miró como sospecha de divergencia y NO lo es: la asimetría está bien
    // así, y lo que faltaba era escribirla (ya está, en la cabecera de
    // formatTime en web/src/lib/format.ts).
    //
    // El escritorio pasa un TimeFormat obligatorio a formatTime/
    // formatByPrecision porque tiene un slider 12h/24h en Settings. La PWA no
    // recibe ese parámetro y no puede: el ajuste no es un dato de la
    // biblioteca, es configuración de UNA máquina —vive en el electron-store
    // del PC, junto a las medidas de la ventana— y nunca entra en Turso, que
    // es lo único que la PWA lee (REMOTO.md §1.1). Traerlo sería montar una
    // sincronización de preferencias de escritorio para elegir dos puntos.
    //
    // Lo que sí importa es que la PWA clave el MISMO default que el escritorio
    // ('24h', src/main/config/store.ts): mientras nadie mueva el slider las dos
    // pantallas dicen exactamente lo mismo, y eso es lo que se fija aquí. Si
    // alguien cambia ese default en el escritorio, este test se cae — y hay que
    // mover los dos, o la divergencia pasa a ser la del que NO tocó nada.
    const { date, ms } = instante('2026-01-10T18:30');
    mismo(
      movilFormato.formatByPrecision(ms, 'datetime'),
      pcFormato.formatByPrecision(date, 'datetime', '24h'),
      'Jan 10, 2026 · 18:30',
    );
    // Y con el slider en 12h el escritorio sí cambia: la diferencia existe, es
    // conocida y solo la ve quien lo ha cambiado a mano en su PC.
    assert.equal(pcFormato.formatByPrecision(date, 'datetime', '12h'), 'Jan 10, 2026 · 06:30 PM');
  });
});

// ══ TRAMOS DE TIEMPO ═══════════════════════════════════════════════════════

describe('tramos: el mismo playthrough dura lo mismo en los dos sitios', () => {
  it('un tramo con precisión de día mide tiempo REAL, no días de calendario', () => {
    // LA CICATRIZ. Del 1 de marzo a las 23:00 al 2 a la 01:00 hay DOS HORAS.
    // La copia del móvil truncaba las dos puntas a medianoche antes de restar,
    // así que veía un día entero: el mismo playthrough decía "less than a day"
    // en el PC y "1 day" en el móvil. Los días de calendario los cuenta
    // relativeDay, que responde a otra pregunta.
    const desde = instante('2026-03-01T23:00');
    const hasta = instante('2026-03-02T01:00');
    mismo(
      movilFormato.humanizeSpanByPrecision(desde.ms, hasta.ms, 'day', 'day'),
      pcFechas.humanizeSpanByPrecision(desde.date, hasta.date, 'day', 'day'),
      'less than a day',
    );
    mismo(
      movilFormato.humanizeSpanByPrecision(desde.ms, hasta.ms, 'datetime', 'datetime'),
      pcFechas.humanizeSpanByPrecision(desde.date, hasta.date, 'datetime', 'datetime'),
      'less than a day',
    );
  });

  it('la precisión más GRUESA de las dos manda: hora y media pueden ser "1 month"', () => {
    // Del 31 de enero a las 23:00 al 1 de febrero a las 00:30 hay hora y media,
    // pero si una de las dos puntas solo se conoce a nivel de MES la respuesta
    // honesta es "1 month" — no se puede afinar más de lo que se sabe. Que las
    // dos mitades elijan la misma punta como la gruesa es lo que se comprueba.
    const desde = instante('2026-01-31T23:00');
    const hasta = instante('2026-02-01T00:30');
    mismo(
      movilFormato.humanizeSpanByPrecision(desde.ms, hasta.ms, 'datetime', 'month'),
      pcFechas.humanizeSpanByPrecision(desde.date, hasta.date, 'datetime', 'month'),
      '1 month',
    );
    mismo(
      movilFormato.humanizeSpanByPrecision(desde.ms, hasta.ms, 'month', 'datetime'),
      pcFechas.humanizeSpanByPrecision(desde.date, hasta.date, 'month', 'datetime'),
      '1 month',
    );
    mismo(
      movilFormato.humanizeSpanByPrecision(desde.ms, hasta.ms, 'year', 'day'),
      pcFechas.humanizeSpanByPrecision(desde.date, hasta.date, 'year', 'day'),
      'Same year',
    );
  });

  it('caer dentro del mismo mes o año se DICE, no se convierte en una duración', () => {
    // Un juego empezado y terminado en 2021 salía como "less than a day" por
    // restar dos "1 de enero a medianoche". Ahora se dice "Same year", que es
    // lo único cierto que se puede decir de él.
    const enero = instante('2021-01-01T00:00');
    const diciembre = instante('2021-12-01T00:00');
    mismo(
      movilFormato.humanizeSpanByPrecision(enero.ms, diciembre.ms, 'year', 'year'),
      pcFechas.humanizeSpanByPrecision(enero.date, diciembre.date, 'year', 'year'),
      'Same year',
    );
    mismo(
      movilFormato.humanizeSpanByPrecision(enero.ms, diciembre.ms, 'month', 'day'),
      pcFechas.humanizeSpanByPrecision(enero.date, diciembre.date, 'month', 'day'),
      '11 months',
    );
    const marzoPronto = instante('2026-03-05T10:00');
    const marzoTarde = instante('2026-03-25T10:00');
    mismo(
      movilFormato.humanizeSpanByPrecision(marzoPronto.ms, marzoTarde.ms, 'month', 'day'),
      pcFechas.humanizeSpanByPrecision(marzoPronto.date, marzoTarde.date, 'month', 'day'),
      'Same month',
    );
  });

  it('humanizeSpan cambia de unidad en los mismos cortes exactos', () => {
    // Los saltos de unidad son donde dos copias se separan sin ruido: basta un
    // `<` por un `<=`, o un 30 por un 30.44, para que la línea temporal del PC
    // y la del móvil cuenten el mismo viaje con números distintos.
    for (const dias of [0, 0.5, 1, 1.4, 59, 59.9, 60, 90, 729, 730, 3650]) {
      mismo(movilFormato.humanizeSpan(dias), pcFechas.humanizeSpan(dias));
    }
    mismo(movilFormato.humanizeSpan(0.5), pcFechas.humanizeSpan(0.5), 'less than a day');
    mismo(movilFormato.humanizeSpan(1.4), pcFechas.humanizeSpan(1.4), '1 day');
    mismo(movilFormato.humanizeSpan(59.9), pcFechas.humanizeSpan(59.9), '60 days');
    mismo(movilFormato.humanizeSpan(60), pcFechas.humanizeSpan(60), '2 months');
    mismo(movilFormato.humanizeSpan(729), pcFechas.humanizeSpan(729), '24 months');
    mismo(movilFormato.humanizeSpan(730), pcFechas.humanizeSpan(730), '2 years');
  });

  it('daysBetween da el mismo número aunque una mitad reciba Date y la otra ms', () => {
    const desde = instante('2026-01-10T18:00');
    const hasta = instante('2026-04-20T09:00');
    mismo(
      movilFormato.daysBetween(desde.ms, hasta.ms),
      pcFechas.daysBetween(desde.date, hasta.date),
    );
  });
});

// ══ NOTAS ══════════════════════════════════════════════════════════════════

describe('notas: las tres muestras y sus umbrales son los mismos en los dos', () => {
  it('los umbrales de muestra y los colores de las tres notas coinciden', () => {
    // Distintos entre sí porque las tres pesan distinto (PLAN-TO-PLAY.md §9), e
    // iguales entre mitades porque si no el mismo juego enseñaría nota en una
    // pantalla y un hueco en la otra.
    mismo(movilNotas.MIN_CRITIC_COUNT, pcNotas.MIN_CRITIC_COUNT, 3);
    mismo(movilNotas.MIN_USER_COUNT, pcNotas.MIN_USER_COUNT, 10);
    mismo(movilNotas.MIN_STEAM_REVIEWS, pcNotas.MIN_STEAM_REVIEWS, 30);
    mismo(movilNotas.STEAM_BLUE, pcNotas.STEAM_BLUE);
    mismo(movilNotas.CRITICS_COLOR, pcNotas.CRITICS_COLOR);
    mismo(movilNotas.PLAYERS_COLOR, pcNotas.PLAYERS_COLOR);
  });

  it('justo por debajo del umbral no hay nota: un hueco honesto, no un número', () => {
    // El borde exacto es lo que importa: con 2 reseñas de crítica no hay nota,
    // con 3 sí. Un `>` por un `>=` en una sola de las dos copias hace que la
    // ficha del móvil enseñe un 88 que el PC se calla.
    const casi = juego({
      ratingCritics: 88,
      ratingCriticsCount: 2,
      ratingUsers: 74,
      ratingUsersCount: 9,
    });
    mismo(movilNotas.resolveRatings(casi), pcNotas.resolveRatings(casi));
    assert.equal(movilNotas.resolveRatings(casi).critics, null);
    assert.equal(movilNotas.resolveRatings(casi).players, null);

    const justo = juego({
      ratingCritics: 88,
      ratingCriticsCount: 3,
      ratingUsers: 74,
      ratingUsersCount: 10,
    });
    mismo(movilNotas.resolveRatings(justo), pcNotas.resolveRatings(justo));
    assert.equal(movilNotas.resolveRatings(justo).critics, 88);
    assert.equal(movilNotas.resolveRatings(justo).players, 74);
  });

  it('la nota de Steam es la PROPORCIÓN de positivas y necesita 30 reseñas', () => {
    // No es una nota que venga dada: se calcula. Y el umbral se mira sobre la
    // SUMA de las dos, no sobre las positivas.
    const pocas = juego({ steamPositive: 29, steamNegative: 0 });
    mismo(movilNotas.resolveRatings(pocas), pcNotas.resolveRatings(pocas));
    assert.equal(movilNotas.resolveRatings(pocas).steam, null);

    const justas = juego({ steamPositive: 0, steamNegative: 30 });
    mismo(movilNotas.resolveRatings(justas), pcNotas.resolveRatings(justas));
    // Un 0% con muestra suficiente es una nota REAL, no un hueco.
    assert.equal(movilNotas.resolveRatings(justas).steam, 0);

    const hollow = juego({ steamPositive: 415_946, steamNegative: 20_000 });
    mismo(movilNotas.resolveRatings(hollow), pcNotas.resolveRatings(hollow));
    assert.equal(movilNotas.resolveRatings(hollow).steam, 95);
    assert.equal(movilNotas.resolveRatings(hollow).steamCount, 435_946);
  });

  it('bestRating respeta el orden de autoridad: crítica, comunidad, Steam', () => {
    // No es una media: mezclar las tres daría un número que no es de nadie y
    // castigaría a los juegos que solo tienen una fuente (PLAN-TO-PLAY.md §2.4).
    const lasTres = juego({
      ratingCritics: 91,
      ratingCriticsCount: 40,
      ratingUsers: 84,
      ratingUsersCount: 900,
      steamPositive: 9000,
      steamNegative: 1000,
    });
    mismo(movilNotas.bestRating(lasTres), pcNotas.bestRating(lasTres), 91);

    // Sin crítica con muestra, manda la comunidad; sin ninguna de las dos, Steam.
    const sinCritica = juego({ ...lasTres, ratingCriticsCount: 2 });
    mismo(movilNotas.bestRating(sinCritica), pcNotas.bestRating(sinCritica), 84);
    const soloSteam = juego({ steamPositive: 9000, steamNegative: 1000 });
    mismo(movilNotas.bestRating(soloSteam), pcNotas.bestRating(soloSteam), 90);
    // Sin ninguna muestra suficiente: null, y la lente lo manda al final en vez
    // de fingirle un cero.
    const sinNada = juego({ ratingCritics: 88, ratingCriticsCount: 1 });
    mismo(movilNotas.bestRating(sinNada), pcNotas.bestRating(sinNada), null);
  });

  it('un 0 de crítica REAL gana a un 88 de comunidad: es `??`, no `||`', () => {
    // El caso que un refactor descuidado rompe sin enterarse. Un juego
    // machacado por la crítica (0 con muestra suficiente) tiene que ordenarse
    // como un 0, no heredar el 88 de sus fans. Con `||` en vez de `??` el 0 se
    // cae y sale el 88 — y el Plan ordenado por "mejor valorado" pondría el
    // desastre arriba. Las dos mitades tienen que caer del mismo lado.
    const machacado = juego({
      ratingCritics: 0,
      ratingCriticsCount: 12,
      ratingUsers: 88,
      ratingUsersCount: 500,
    });
    mismo(movilNotas.bestRating(machacado), pcNotas.bestRating(machacado), 0);
  });

  it('la paleta copiada en status.ts sigue siendo la de colors.ts', () => {
    // web/src/lib/status.ts lleva los hex a mano ("Acentos de identidad
    // (src/renderer/src/lib/colors.ts)"). Es la copia más fácil de olvidar de
    // todas: cambiar el verde de la casa en colors.ts no rompe nada, solo deja
    // el móvil con el verde viejo para siempre.
    mismo(movilPaleta.GREEN, pcPaleta.GREEN);
    mismo(movilPaleta.AMBER, pcPaleta.AMBER);
    mismo(movilPaleta.BLUE, pcPaleta.BLUE);
    mismo(movilPaleta.TEAL, pcPaleta.TEAL);
    mismo(movilPaleta.VIOLET, pcPaleta.VIOLET);
  });
});

// ══ LOGROS ═════════════════════════════════════════════════════════════════

describe('logros: la misma lista se pinta y se ordena igual en los dos', () => {
  it('los cortes de rareza y el color de cada tramo son los mismos', () => {
    // Los cortes son los de la propia Steam: 10% poco común, 5% de presumir. Y
    // el color va pegado al corte — un logro del 4.9% tiene que salir violeta
    // en las dos pantallas, no violeta en una y ámbar en la otra.
    mismo(movilLogros.RARE, pcLogros.RARE, 10);
    mismo(movilLogros.ULTRA_RARE, pcLogros.ULTRA_RARE, 5);
    mismo(movilLogros.ULTRA_VIOLET, pcLogros.ULTRA_VIOLET);
    for (const porcentaje of [null, 0, 0.4, 4.9, 5, 5.1, 9.9, 10, 10.1, 100]) {
      mismo(movilLogros.rarityAccent(porcentaje), pcLogros.rarityAccent(porcentaje));
      mismo(movilLogros.isRare(porcentaje), pcLogros.isRare(porcentaje));
    }
    // Los tres bordes con nombre, fijados: sin muestra es verde (no se presume
    // de lo que no consta), el 5 clavado ya NO es ultra raro, el 10 clavado ya
    // no es raro.
    mismo(movilLogros.rarityAccent(null), pcLogros.rarityAccent(null), pcPaleta.GREEN);
    mismo(movilLogros.rarityAccent(4.9), pcLogros.rarityAccent(4.9), pcLogros.ULTRA_VIOLET);
    mismo(movilLogros.rarityAccent(5), pcLogros.rarityAccent(5), pcPaleta.AMBER);
    mismo(movilLogros.rarityAccent(10), pcLogros.rarityAccent(10), pcPaleta.GREEN);
  });

  it('el decimal solo aparece por debajo del 10%, donde ES la noticia', () => {
    mismo(movilLogros.percentLabel(0.4), pcLogros.percentLabel(0.4), '0.4%');
    mismo(movilLogros.percentLabel(9.99), pcLogros.percentLabel(9.99), '10.0%');
    mismo(movilLogros.percentLabel(10), pcLogros.percentLabel(10), '10%');
    mismo(movilLogros.percentLabel(47.6), pcLogros.percentLabel(47.6), '48%');
  });

  it('el orden canónico: conseguidos primero, recientes arriba, fecha no fiable detrás', () => {
    // La regla completa en un solo caso. La fecha no fiable es la del RESCATE
    // (el emulador que sella de golpe un historial viejo), no la de la hazaña:
    // por eso el logro del 10 de febrero cae por detrás del 10 de enero, aunque
    // sea posterior. Una fuente fiable gana a una que no, aunque sea anterior.
    const logros = [
      logro(1, null),
      logro(2, '2026-01-10T18:00'),
      logro(3, '2026-02-10T18:00', false),
      logro(4, '2026-03-10T18:00'),
      logro(5, null),
    ];
    mismo(ordenMovil(logros), ordenPC(logros), [4, 2, 3, 1, 5]);
  });

  it('el orden no depende de cómo venga la lista: las 120 permutaciones coinciden', () => {
    // Aquí es donde de verdad se compara: el PC parte y ordena media lista, el
    // móvil hace un solo sort de la lista entera. Los dos empatan SOLO si los
    // dos sorts son estables y los dos criterios están completos. Con una lista
    // ya ordenada eso no se ve; con las 120 permutaciones, sí.
    const base = [
      logro(1, null),
      logro(2, '2026-01-10T18:00'),
      logro(3, '2026-02-10T18:00', false),
      logro(4, '2026-03-10T18:00'),
      logro(5, null),
    ];
    const permutaciones = (xs: LogroGemelo[]): LogroGemelo[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((resto) => [x, ...resto]),
          );

    const todas = permutaciones(base);
    assert.equal(todas.length, 120);
    for (const orden of todas) {
      mismo(ordenMovil(orden), ordenPC(orden));
    }
  });

  it('los pendientes conservan el orden en que llegan (el de Steam) en los dos', () => {
    // Los pendientes no se ordenan por nada: se dejan como vienen, que es el
    // orden del catálogo de Steam. Por eso el mismo par al revés sale al revés
    // en las DOS mitades — es la única parte del orden que depende de la
    // entrada, y las dos tienen que depender igual.
    const aDerechas = [logro(7, null), logro(8, null)];
    const alReves = [logro(8, null), logro(7, null)];
    mismo(ordenMovil(aDerechas), ordenPC(aDerechas), [7, 8]);
    mismo(ordenMovil(alReves), ordenPC(alReves), [8, 7]);
  });

  it('un empate exacto de fecha no reordena nada: los dos sorts son estables', () => {
    // Dos logros sacados en el mismo instante (una tanda que Steam sella de
    // golpe) no tienen desempate. Un sort inestable en una de las mitades los
    // sacaría en distinto orden en cada pantalla, y peor: en distinto orden
    // entre dos renders de la misma pantalla.
    const mismoInstante = [
      logro(11, '2026-01-10T18:00'),
      logro(12, '2026-01-10T18:00'),
      logro(13, '2026-01-10T18:00'),
    ];
    mismo(ordenMovil(mismoInstante), ordenPC(mismoInstante), [11, 12, 13]);
  });
});

// ══ AGRUPACIÓN DE SESIONES POR DÍA ═════════════════════════════════════════

describe('sesiones: los mismos cubos de fecha en la lista del PC y en la del móvil', () => {
  it('los cortes de cubo caen en el mismo día, uno a uno', () => {
    // Recorrido día a día por los bordes de la tabla (0, 1, 7/8, 14/15) y por
    // los cubos gruesos. Cada uno se compara con el gemelo REAL del escritorio
    // (importado, ya no recortado del .tsx), no con una tabla escrita aquí.
    const ahora = new Date('2026-08-13T12:00');
    for (const dias of [0, 1, 2, 7, 8, 14, 15, 20, 25, 30, 40, 60, 120, 220, 400, 800]) {
      const fecha = new Date(ahora.getTime() - dias * 86_400_000);
      mismo(movilCubos.getSessionGroup(fecha, ahora), cuboPC(fecha, ahora));
    }
    // Y los bordes con nombre propio, fijados.
    const hoy = new Date('2026-08-13T09:00');
    const ayer = new Date('2026-08-12T23:30');
    const haceSiete = new Date('2026-08-06T12:00');
    const haceOcho = new Date('2026-08-05T12:00');
    mismo(movilCubos.getSessionGroup(hoy, ahora), cuboPC(hoy, ahora), 'Today');
    mismo(movilCubos.getSessionGroup(ayer, ahora), cuboPC(ayer, ahora), 'Yesterday');
    mismo(movilCubos.getSessionGroup(haceSiete, ahora), cuboPC(haceSiete, ahora), 'This Week');
    mismo(movilCubos.getSessionGroup(haceOcho, ahora), cuboPC(haceOcho, ahora), 'Last Week');
  });

  it('el ORDEN de los cubos manda: 10 días atrás es "Last Week" aunque sea el mismo mes', () => {
    // La tabla se lee de arriba abajo y el primer cubo que encaja gana. Una
    // sesión del 3 de agosto vista el 13 de agosto es del mes en curso, pero
    // sale como "Last Week" porque la semana se mira antes. Reordenar los ifs
    // en una sola de las dos mitades cambiaría la lista entera de una pantalla.
    const ahora = new Date('2026-08-13T12:00');
    const haceDiez = new Date('2026-08-03T12:00');
    mismo(movilCubos.getSessionGroup(haceDiez, ahora), cuboPC(haceDiez, ahora), 'Last Week');

    // Pasados los 14 días, ahí sí manda el mes.
    const finDeAgosto = new Date('2026-08-31T12:00');
    const principio = new Date('2026-08-05T12:00');
    mismo(
      movilCubos.getSessionGroup(principio, finDeAgosto),
      cuboPC(principio, finDeAgosto),
      'This Month',
    );
  });

  it('un mes anterior del mismo año va solo; uno de otro año lleva el año detrás', () => {
    // Los años pasados NO se apelotonan en un cubo por año: siempre desglosados
    // por mes. Y el año solo aparece cuando hace falta para no confundirlos.
    const ahora = new Date('2026-08-13T12:00');
    const junio = new Date('2026-06-14T12:00');
    const julioPasado = new Date('2025-07-09T12:00');
    mismo(movilCubos.getSessionGroup(junio, ahora), cuboPC(junio, ahora), 'June');
    mismo(movilCubos.getSessionGroup(julioPasado, ahora), cuboPC(julioPasado, ahora), 'July 2025');
  });

  it('en enero, diciembre sigue siendo "Last Month" aunque cambie el año', () => {
    // El mes anterior se calcula con new Date(año, mes - 1, 1), que en enero da
    // diciembre del año pasado. Es el caso que una resta de meses a pelo
    // (mes - 1 sin tocar el año) rompe una vez al año, en la semana en la que
    // nadie está mirando.
    const enero = new Date('2026-01-15T12:00');
    const diciembre = new Date('2025-12-16T12:00');
    const noviembre = new Date('2025-11-16T12:00');
    mismo(movilCubos.getSessionGroup(diciembre, enero), cuboPC(diciembre, enero), 'Last Month');
    mismo(movilCubos.getSessionGroup(noviembre, enero), cuboPC(noviembre, enero), 'November 2025');
  });

  it('una sesión con fecha futura cae en "Today", no en un cubo inventado', () => {
    // Pasa de verdad: un reloj adelantado, o una sesión manual mal escrita. Los
    // días salen negativos y la primera rama (diffDays <= 0) los recoge. Si una
    // mitad usara === 0 en vez de <= 0, esa fila se quedaría sin cabecera.
    const ahora = new Date('2026-08-13T12:00');
    const manana = new Date('2026-08-16T12:00');
    mismo(movilCubos.getSessionGroup(manana, ahora), cuboPC(manana, ahora), 'Today');
  });

  it('la página abre cubo nuevo en su primera fila, aunque repita etiqueta', () => {
    // groupPageByDate agrupa UNA PÁGINA, no la lista entera: la cabecera de la
    // primera fila siempre se pinta. Sin esto, pasar de página podía dejar una
    // tanda de filas "This Week" arrancando a mitad sin ningún titulito encima.
    // Y filas del mismo cubo NO contiguas abren dos grupos, que es justo lo que
    // permite que un mes partido en dos páginas enseñe su tarjeta en las dos.
    const ahora = new Date('2026-08-13T12:00');
    const pagina = [
      sesion('2026-08-13T10:00'),
      sesion('2026-08-13T08:00'),
      sesion('2026-08-11T20:00'),
      sesion('2026-08-13T02:00'),
    ];
    const grupos = movilCubos.groupPageByDate(pagina, ahora);
    assert.deepEqual(
      grupos.map((grupo) => [grupo.label, grupo.sessions.length]),
      [
        ['Today', 2],
        ['This Week', 1],
        ['Today', 1],
      ],
    );
    // Ninguna sesión se pierde ni se cuenta dos veces al agrupar.
    assert.equal(
      grupos.reduce((total, grupo) => total + grupo.sessions.length, 0),
      pagina.length,
    );

    // Y ahora que el gemelo del escritorio se puede importar, se compara el
    // reparto ENTERO —no solo la tabla de etiquetas—: la misma página tiene que
    // partirse en los mismos grupos y con las mismas filas en cada uno. Antes
    // esto no podía comprobarse (la extracción del .tsx solo alcanzaba a
    // getSessionGroup) y groupPageByDate era una copia sin vigilar.
    const paginaPC = pagina.map((s) => ({ startedAt: new Date(s.startedAt) }));
    assert.deepEqual(
      pcCubos.groupPageByDate(paginaPC, ahora).map((grupo) => [grupo.label, grupo.sessions.length]),
      grupos.map((grupo) => [grupo.label, grupo.sessions.length]),
    );
  });

  it('el monthScopeKey del escritorio solo existe donde el cubo ES un mes cerrado', () => {
    // La otra mitad de la respuesta del escritorio, que la PWA no tiene (no
    // pinta el recap del diario) y que por eso ningún test miraba: la clave del
    // mes con la que generated_memories conoce el periodo (AFTERPLAY-LOOP.md
    // §5). Los cubos del presente van a null a propósito —el mes en curso no se
    // narra, y "This Week" no es un mes aunque alguna fila caiga en el
    // anterior—, así que un null de más apaga la tarjeta y uno de menos la
    // enseña en un cubo que no es un mes.
    const ahora = new Date('2026-08-13T12:00');
    const clave = (iso: string): string | null =>
      pcCubos.getSessionGroup(new Date(iso), ahora).monthScopeKey;
    assert.equal(clave('2026-08-13T09:00'), null); // Today
    assert.equal(clave('2026-08-06T12:00'), null); // This Week
    assert.equal(clave('2026-08-03T12:00'), null); // Last Week, y es de este mes
    assert.equal(clave('2026-08-01T12:00'), null); // This Month
    assert.equal(clave('2026-07-04T12:00'), '2026-07'); // Last Month
    assert.equal(clave('2026-06-14T12:00'), '2026-06'); // June
    assert.equal(clave('2025-07-09T12:00'), '2025-07'); // July 2025
  });
});

// ══ FECHA DE SALIDA ════════════════════════════════════════════════════════

describe('salida: la honestidad de la precisión es la misma en los dos', () => {
  it('formatRelease no inventa el día que no se sabe', () => {
    // IGDB devuelve un timestamp concreto incluso cuando solo conoce el año: sin
    // la precisión al lado, un juego "1994" se convierte en un "December 31,
    // 1994" que miente.
    const casos = [
      { iso: '1994-01-01T00:00', precision: 'year' as const, esperado: '1994' },
      { iso: '2026-03-01T00:00', precision: 'month' as const, esperado: 'March 2026' },
      { iso: '2026-09-10T00:00', precision: 'day' as const, esperado: 'September 10, 2026' },
    ];
    for (const { iso, precision, esperado } of casos) {
      const { date, ms } = instante(iso);
      mismo(
        movilFormato.formatRelease({
          releaseDate: ms,
          releaseDatePrecision: precision,
          releaseYear: date.getFullYear(),
        }),
        pcRelease.formatRelease({
          releaseDate: date,
          releaseDatePrecision: precision,
          releaseYear: date.getFullYear(),
        }),
        esperado,
      );
    }
    // Sin fecha usable queda el año pelado; sin nada de nada, null (y no un
    // "Unknown" inventado por una de las dos mitades).
    const soloAnio = { releaseDate: null, releaseDatePrecision: null, releaseYear: 2027 };
    mismo(movilFormato.formatRelease(soloAnio), pcRelease.formatRelease(soloAnio), '2027');
    const nada = { releaseDate: null, releaseDatePrecision: null, releaseYear: null };
    mismo(movilFormato.formatRelease(nada), pcRelease.formatRelease(nada), null);
  });

  it('un juego de "March 2026" no ha salido en febrero y sí ha salido en abril', () => {
    // La comparación se hace con el GRANO de la precisión, no con el timestamp
    // pelado: su fecha guardada es el 1 de marzo, así que comparar días diría
    // que ya salió el 2 de marzo y que no había salido el 28 de febrero… pero
    // también daría respuestas raras dentro del propio marzo.
    const marzo = instante('2026-03-01T00:00');
    const movilJuego = {
      releaseDate: marzo.ms,
      releaseDatePrecision: 'month' as const,
      releaseYear: 2026,
    };
    const pcJuego = {
      releaseDate: marzo.date,
      releaseDatePrecision: 'month' as const,
      releaseYear: 2026,
    };
    for (const [iso, esperado] of [
      ['2026-02-14T12:00', true],
      ['2026-03-20T12:00', false],
      ['2026-04-02T12:00', false],
    ] as Array<[string, boolean]>) {
      const ahora = new Date(iso);
      mismo(
        movilRelease.isUnreleased(movilJuego, ahora),
        pcRelease.isUnreleased(pcJuego, ahora),
        esperado,
      );
    }
  });

  it('el DÍA del lanzamiento sigue siendo espera hasta medianoche', () => {
    // El bug cazado con un juego que salía "hoy en 7 horas": con `>` ya no era
    // "sin salir" (su día es hoy) pero tampoco "recién salido" (el countdown
    // pide días NEGATIVOS para el OUT NOW), así que caía en la cola normal sin
    // ningún badge. El `>=` lo deja en el horizonte con su "Out today!".
    const salida = instante('2026-09-10T00:00');
    const movilJuego = {
      releaseDate: salida.ms,
      releaseDatePrecision: 'day' as const,
      releaseYear: 2026,
    };
    const pcJuego = {
      releaseDate: salida.date,
      releaseDatePrecision: 'day' as const,
      releaseYear: 2026,
    };
    const elDia = new Date('2026-09-10T17:00');
    const alDiaSiguiente = new Date('2026-09-11T05:00');
    mismo(
      movilRelease.isUnreleased(movilJuego, elDia),
      pcRelease.isUnreleased(pcJuego, elDia),
      true,
    );
    mismo(
      movilRelease.releaseCountdown(movilJuego, elDia),
      pcRelease.releaseCountdown(pcJuego, elDia),
      { kind: 'today' },
    );
    mismo(
      movilRelease.isUnreleased(movilJuego, alDiaSiguiente),
      pcRelease.isUnreleased(pcJuego, alDiaSiguiente),
      false,
    );
    mismo(
      movilRelease.releaseCountdown(movilJuego, alDiaSiguiente),
      pcRelease.releaseCountdown(pcJuego, alDiaSiguiente),
      { kind: 'out-now' },
    );
  });

  it('la cuenta atrás solo existe con precisión de día, y el OUT NOW caduca', () => {
    // No se cuentan días que no se saben: un juego de "March 2026" enseña su
    // mes y ya. Y sin el tope de 3 semanas, Chrono Trigger llevaría un OUT NOW
    // perpetuo desde 1995.
    const marzo = instante('2026-03-01T00:00');
    mismo(
      movilRelease.releaseCountdown(
        { releaseDate: marzo.ms, releaseDatePrecision: 'month', releaseYear: 2026 },
        new Date('2026-02-14T12:00'),
      ),
      pcRelease.releaseCountdown(
        { releaseDate: marzo.date, releaseDatePrecision: 'month', releaseYear: 2026 },
        new Date('2026-02-14T12:00'),
      ),
      null,
    );

    const salida = instante('2026-09-10T00:00');
    const movilJuego = {
      releaseDate: salida.ms,
      releaseDatePrecision: 'day' as const,
      releaseYear: 2026,
    };
    const pcJuego = {
      releaseDate: salida.date,
      releaseDatePrecision: 'day' as const,
      releaseYear: 2026,
    };
    for (const [iso, esperado] of [
      ['2026-09-09T12:00', { kind: 'tomorrow' }],
      ['2026-09-04T12:00', { kind: 'soon', days: 6, imminent: true }],
      ['2026-08-25T12:00', { kind: 'soon', days: 16, imminent: false }],
      // El borde de la ventana: 30 días todavía cuentan, 31 ya no ("en 31
      // días" es ruido con pinta de dato).
      ['2026-08-11T12:00', { kind: 'soon', days: 30, imminent: false }],
      ['2026-08-10T12:00', null],
      ['2026-10-01T12:00', { kind: 'out-now' }],
      ['2026-10-02T12:00', null],
    ] as Array<[string, unknown]>) {
      const ahora = new Date(iso);
      mismo(
        movilRelease.releaseCountdown(movilJuego, ahora),
        pcRelease.releaseCountdown(pcJuego, ahora),
        esperado,
      );
    }
  });
});
