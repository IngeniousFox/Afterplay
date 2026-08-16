import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { manualHoursAnchor } from '../../../shared/playthroughState';
import { yearOf } from '../../../shared/yearOf';
import type { GameListItem, SessionWithGame, SpendEventSummary } from '../../../shared/types';
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeOpenSession,
  makeSession,
  makeStateEvent,
  type TestDb,
} from './harness';

// LAS CIFRAS DE UN AÑO, de punta a punta.
//
// "¿Cuántas horas jugué en 2026?" no sale de ninguna columna: se compone de
// DOS mitades que viven en sitios distintos y que hay que sumar sin olvidarse
// de ninguna ni contar ninguna dos veces (SPEC-2 §4.4):
//
//   horas de un año = sesiones fechadas ESE año
//                   + horas MANUALES de los playthroughs anclados a ese año
//
// La segunda mitad es la que se cae sola. Ha fallado de verdad dos veces: en
// Stats, que REEMPLAZABA las horas trackeadas por las manuales mientras el
// main las SUMABA (SPEC-2 §12.1), y en la portada del móvil, que directamente
// solo miraba sesiones (ver la cicatriz escrita en worker/src/queries/stats.ts).
// El síntoma es siempre el mismo y es de los feos: la misma pregunta contestada
// con dos números distintos en dos pantallas.
//
// Por eso este fichero prueba la CADENA ENTERA con datos reales, no la función
// aislada: base de datos → getGames() (que resuelve el año de cada bloque de
// horas manuales con manualHoursAnchor) + getAllSessions() → yearTotals(), que
// es exactamente lo que hace la pantalla vía useGames()/useSessions(). El
// reparto por año se rompe en las costuras entre esas piezas, no dentro de
// ninguna de ellas.
//
// La atribución del año en sí (a qué evento del log se cuelgan las horas
// manuales) se prueba a nivel de fila en getGames.test.ts; aquí lo que importa
// es la CIFRA que acaba en pantalla.
//
// Para lanzarlo solo:
//   npx tsx --test --experimental-test-module-mocks src/main/db/__tests__/yearTotals.test.ts

// LA ZONA HORARIA, CLAVADA. Todo el reparto por año se decide con
// `getFullYear()`, que es hora LOCAL, y media suite se juega precisamente en
// los bordes de fin de año. Sin fijarla, los tests de precisión de año dirían
// una cosa en el PC de casa (Madrid) y otra en un CI en UTC — un test que falla
// según dónde corra es peor que no tenerlo. Se fija a la zona en la que se vio
// el problema. Node reevalúa TZ en el siguiente uso de Date, y las fechas de
// esta suite se construyen todas dentro de los tests.
process.env.TZ = 'Europe/Madrid';

// La firma de yearTotals escrita a mano, y el import de más abajo dinámico y
// con la ruta en una constante, POR UN MOTIVO CONCRETO: yearTotals vive en el
// renderer y arrastra (solo como tipo) el `Year` de YearPicker.tsx, que a su
// vez arrastra popover.tsx y su alias '@/lib/utils'. Un import estático desde
// aquí mete esos ficheros en el programa de tsconfig.node.json, que no conoce
// ese alias, y rompe `npm run typecheck` (y con él el build) sin que este test
// tenga la culpa de nada. Los tipos de los DATOS sí son los de verdad
// (shared/types), así que lo único escrito a mano es la forma de la función.
type YearTotals = (
  games: GameListItem[],
  sessions: SessionWithGame[],
  spendEvents: SpendEventSummary[],
  year: number | 'all',
) => {
  hoursByGame: Map<number, number>;
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
};
type Cifras = ReturnType<YearTotals>;

const STATS_TOTALS = '../../../renderer/src/lib/statsTotals';

let db: TestDb;
let getGames: typeof import('../queries/games/getGames').getGames;
let getAllSessions: typeof import('../queries/sessions/getAllSessions').getAllSessions;
let yearTotals: YearTotals;

// Los módulos bajo prueba se importan DENTRO del before(): el mock.module de
// la DB (registrado al cargar el andamio) tiene que estar puesto antes de que
// las consultas resuelvan su `getDb`. Un import normal arriba las cargaría
// antes de tiempo.
before(async () => {
  ({ getGames } = await import('../queries/games/getGames'));
  ({ getAllSessions } = await import('../queries/sessions/getAllSessions'));
  ({ yearTotals } = (await import(STATS_TOTALS)) as { yearTotals: YearTotals });
});
beforeEach(async () => {
  db = await freshDb();
});
after(() => cleanupDbs());

// ── Fábricas locales ───────────────────────────────────────────────────────
//
// Para que cada test hable de partidas ("Elden Ring, 200 horas de antes de la
// app, terminado en enero") y no de inserts.

type Playthrough = { gameId: number; iterationId: number };

// Un juego con UN playthrough. `manualHours` son las horas jugadas FUERA del
// tracking (antes de usar Afterplay, en otro PC, en consola): el número suelto
// que hay que colgar de algún año.
const juego = async (
  title: string,
  options: { manualHours?: number; addedAt?: string } = {},
): Promise<Playthrough> => {
  const gameId = await makeGame(db, {
    title,
    addedAt: new Date(options.addedAt ?? '2020-01-01T00:00:00Z'),
  });
  const iterationId = await makeIteration(db, gameId, {
    manualTotalPlayed: options.manualHours ?? null,
  });
  return { gameId, iterationId };
};

// Otra vuelta al mismo juego (SPEC 4.5: el playthrough anterior ya se cerró,
// volver a jugar abre uno nuevo).
const otraVuelta = async (gameId: number, label: string, manualHours: number): Promise<number> =>
  makeIteration(db, gameId, { label, manualTotalPlayed: manualHours });

// spend_events no tiene fábrica en el andamio y yearTotals no lo lee de la
// base: lo recibe ya cocinado desde useSpendEvents(). Este es el mismo shape
// que devuelve getAllSpendEvents.
const gasto = (gameId: number, amount: number, occurredAt: string): SpendEventSummary => ({
  gameId,
  amount,
  occurredAt: new Date(occurredAt),
});

// ── Lectura ────────────────────────────────────────────────────────────────

// Las cifras del año TAL Y COMO LAS PINTA LA PANTALLA: los mismos dos queries
// que alimentan Stats, y la misma función encima.
const cifrasDe = async (year: number | 'all', gastos: SpendEventSummary[] = []): Promise<Cifras> =>
  yearTotals(await getGames(), await getAllSessions(), gastos, year);

const horasDe = async (year: number | 'all'): Promise<number> => (await cifrasDe(year)).totalHours;

describe('las horas de un año son las sesiones de ese año MÁS las manuales ancladas a él', () => {
  it('un playthrough terminado en enero deja sus horas manuales en ese enero, no donde se jugaron', async () => {
    // El caso con nombre propio de SPEC-2 §4.4: "me pasé Elden Ring en 2026"
    // pone las 200 horas en 2026 aunque el playthrough arrancara en 2025,
    // porque así es como se lo cuenta uno mismo. Y terminarlo en ENERO es el
    // borde que más duele: las horas cruzan el año enteras y se separan de las
    // sesiones que las acompañaron, así que los dos años tienen que cuadrar a
    // la vez o el reparto está mal en uno de los dos.
    const eldenRing = await juego('Elden Ring', { manualHours: 200 });
    await makeStateEvent(db, eldenRing.iterationId, 'started', '2025-03-04T20:00:00Z');
    await makeStateEvent(db, eldenRing.iterationId, 'completed', '2026-01-10T18:00:00Z');
    await makeSession(db, eldenRing.iterationId, '2025-11-02T21:00:00Z', 3);

    assert.equal(await horasDe(2025), 3);
    assert.equal(await horasDe(2026), 200);
    assert.equal(await horasDe('all'), 203);
  });

  it('en el año del final se suman las dos mitades: ni reemplaza ni cuenta de más', async () => {
    // SPEC-2 §12.1, la divergencia que se vio en pantalla: yearTotals
    // REEMPLAZABA las horas trackeadas por las manuales, con un comentario que
    // juraba aplicar "la misma regla que el main" cuando el main las sumaba.
    // Un juego jugado entero dentro del mismo año enseñaba 40 h en 2026 y
    // 42,5 h en All Time — menos horas en su año que en toda su vida, que es
    // imposible y es justo lo que cantó el fallo.
    const hollow = await juego('Hollow Knight', { manualHours: 40 });
    await makeStateEvent(db, hollow.iterationId, 'completed', '2026-05-02T12:00:00Z');
    await makeSession(db, hollow.iterationId, '2026-05-01T18:00:00Z', 2.5);

    assert.equal(await horasDe(2026), 42.5);
    assert.equal(await horasDe(2026), await horasDe('all'));
  });

  it('lo repartido por años cuadra exactamente con el All Time', async () => {
    // El invariante que un refactor rompe sin enterarse: ninguna hora se queda
    // por el camino y ninguna se cuenta en dos años. Dos juegos a caballo
    // entre años, cada uno con sus dos mitades, para que el reparto tenga que
    // acertar en las cuatro esquinas.
    const persona = await juego('Persona 5', { manualHours: 100 });
    await makeStateEvent(db, persona.iterationId, 'started', '2024-01-05T18:00:00Z');
    await makeStateEvent(db, persona.iterationId, 'completed', '2024-12-20T21:00:00Z');
    await makeSession(db, persona.iterationId, '2024-11-02T20:00:00Z', 4);

    const tunic = await juego('Tunic', { manualHours: 8 });
    await makeStateEvent(db, tunic.iterationId, 'started', '2025-12-28T18:00:00Z');
    await makeStateEvent(db, tunic.iterationId, 'completed', '2026-02-01T12:00:00Z');
    await makeSession(db, tunic.iterationId, '2025-12-29T10:00:00Z', 6);
    await makeSession(db, tunic.iterationId, '2026-01-03T10:00:00Z', 2);

    const porAnios = (await horasDe(2024)) + (await horasDe(2025)) + (await horasDe(2026));
    assert.equal(porAnios, 120);
    assert.equal(porAnios, await horasDe('all'));

    // Y el reparto por juego, que es la base del Most Played del año: en 2024
    // solo hay Persona 5, con sus 100 manuales y sus 4 trackeadas.
    const dosMilVeinticuatro = await cifrasDe(2024);
    assert.equal(dosMilVeinticuatro.hoursByGame.get(persona.gameId), 104);
    assert.equal(dosMilVeinticuatro.hoursByGame.get(tunic.gameId), 0);
  });
});

describe('un playthrough sin desenlace cuelga sus horas del año en que empezó', () => {
  it('sin evento de final, mandan las horas al año del started', async () => {
    // Una partida en curso no tiene fecha de salida, así que el principio es
    // la mejor pista que hay. Sin esto, todo lo que estás jugando ahora mismo
    // y venía con horas de antes desaparecería de la vista por años.
    const rimworld = await juego('RimWorld', { manualHours: 120 });
    await makeStateEvent(db, rimworld.iterationId, 'started', '2024-06-01T17:00:00Z');
    await makeSession(db, rimworld.iterationId, '2026-03-01T19:00:00Z', 5);

    assert.equal(await horasDe(2024), 120);
    assert.equal(await horasDe(2026), 5);
    assert.equal(await horasDe('all'), 125);
  });

  it('aparcar es una fecha de salida; descansar no, y las horas se quedan donde empezaron', async () => {
    // Los tres conjuntos de "estado terminal" de shared/playthroughState no
    // son el mismo, y esta es la diferencia que se ve en pantalla: 'on_hold'
    // entra en LEAVES_END_DATE (aparcar algo también es una fecha de salida),
    // 'resting' NO — solo cierra la sesión abierta. Que hoy parezcan
    // subconjuntos unos de otros es casualidad del enum; si alguien los
    // fusiona, estas horas cambian de año sin que nada más se queje.
    const aparcado = await juego('Disco Elysium', { manualHours: 30 });
    await makeStateEvent(db, aparcado.iterationId, 'started', '2024-02-10T18:00:00Z');
    await makeStateEvent(db, aparcado.iterationId, 'on_hold', '2025-09-01T18:00:00Z');

    const descansando = await juego('Slay the Spire', { manualHours: 70 });
    await makeStateEvent(db, descansando.iterationId, 'started', '2024-02-10T18:00:00Z');
    await makeStateEvent(db, descansando.iterationId, 'resting', '2025-09-01T18:00:00Z');

    assert.equal(await horasDe(2024), 70);
    assert.equal(await horasDe(2025), 30);
  });

  it('con varios finales manda el más reciente, no el primero', async () => {
    // Un playthrough aparcado en 2024 y rematado en 2025 cuenta en 2025: sus
    // horas van al último sitio del que se levantó uno, no a la primera pausa.
    const outerWilds = await juego('Outer Wilds', { manualHours: 22 });
    await makeStateEvent(db, outerWilds.iterationId, 'started', '2023-05-01T18:00:00Z');
    await makeStateEvent(db, outerWilds.iterationId, 'on_hold', '2024-01-20T18:00:00Z');
    await makeStateEvent(db, outerWilds.iterationId, 'completed', '2025-04-11T18:00:00Z');

    assert.equal(await horasDe(2023), 0);
    assert.equal(await horasDe(2024), 0);
    assert.equal(await horasDe(2025), 22);
  });
});

describe('horas manuales que no tienen año: solo pueden contar en All Time', () => {
  it('un playthrough sin una sola fecha —ni en el log ni en sesiones— no aporta a ningún año', async () => {
    // Inventarle un año sería peor: metería 40 horas falsas en el resumen del
    // año en curso. Que no aparezcan en ningún año pero sí en All Time es la
    // decisión consciente de SPEC-2 §4.4. Ojo a lo que este juego NO tiene:
    // ninguna sesión. Con una sola sesión fechada ya habría de dónde colgarlas
    // (ver el bloque de abajo) — "sin año" es para cuando de verdad no se sabe
    // nada, no para cuando nadie miró.
    await juego('Chrono Trigger', { manualHours: 40 });

    assert.equal(await horasDe(2026), 0);
    assert.equal(await horasDe(1999), 0);
    assert.equal(await horasDe('all'), 40);
    // Y tampoco cuenta como "juego jugado" en un año en el que no aporta nada.
    assert.equal((await cifrasDe(2026)).totalGames, 0);
    assert.equal((await cifrasDe('all')).totalGames, 1);
  });

  it('planear no es jugar: un plan_to_play no le da año a nada', async () => {
    // 'plan_to_play' es solo una entrada de historial, nunca un estado real
    // (schema.ts). Si anclara horas, cualquier juego movido del Plan a la
    // biblioteca le regalaría sus horas de antaño al año en que lo planeaste.
    const silksong = await juego('Silksong', { manualHours: 12 });
    await makeStateEvent(db, silksong.iterationId, 'plan_to_play', '2026-02-01T10:00:00Z');

    assert.equal(await horasDe(2026), 0);
    assert.equal(await horasDe('all'), 12);
  });
});

describe('cuando el log calla, fechan las sesiones', () => {
  it('con sesiones fechadas y sin log de estados, las horas manuales van al año de la primera sesión', async () => {
    // ARREGLADO. Era el agujero más corriente que había: un juego que el
    // watcher detectó solo (sesiones sí, log de estados no) y al que le
    // tecleaste "ya le había echado 50 horas en la otra máquina". El ancla
    // miraba SOLO el log, así que esas 50 h se quedaban sin año y el resumen
    // de 2026 enseñaba 5 h de 55 — con las sesiones delante diciendo en qué
    // año se estuvo jugando esto.
    //
    // Sigue mandando el log mientras diga algo (es lo que contaste tú); las
    // sesiones son el último recurso, y ahí "sin fecha" ya no es la respuesta
    // honesta: hay una, y está medida.
    const stardew = await juego('Stardew Valley', { manualHours: 50 });
    await makeSession(db, stardew.iterationId, '2026-04-10T18:00:00Z', 5);

    assert.equal(await horasDe(2026), 55);
    assert.equal(await horasDe('all'), 55);
    // Y ahora sí cuenta como juego jugado en 2026, que es lo que ya decían sus
    // 5 horas trackeadas.
    assert.equal((await cifrasDe(2026)).totalGames, 1);
  });

  it('manda la PRIMERA sesión, no la última: las horas de antes cuelgan de donde empezó lo medido', async () => {
    // El borde que abre el arreglo. Un juego que arrastras dos años sin un
    // solo evento de estado: sus horas manuales son de ANTES de todo esto, así
    // que el sitio menos malo es el principio de lo que sabemos, igual que un
    // 'started' manda cuando no hay final. Colgarlas de la última sesión las
    // movería de año cada vez que vuelvas a jugar.
    const terraria = await juego('Terraria', { manualHours: 80 });
    await makeSession(db, terraria.iterationId, '2024-07-05T18:00:00Z', 2);
    await makeSession(db, terraria.iterationId, '2026-03-01T18:00:00Z', 3);

    assert.equal(await horasDe(2024), 82);
    assert.equal(await horasDe(2026), 3);
    assert.equal(await horasDe('all'), 85);
  });

  it('el log manda sobre las sesiones: las sesiones solo entran cuando no hay ninguna fecha escrita', async () => {
    // La otra mitad de la guarda, y la que evita que el arreglo se lleve por
    // delante el caso de SPEC-2 §4.4: "me lo pasé en enero de 2026" pone las
    // horas en 2026 aunque las sesiones medidas sean todas de 2025. El log es
    // lo que contaste tú; lo medido solo habla cuando el log calla.
    const eldenRing = await juego('Elden Ring', { manualHours: 200 });
    await makeStateEvent(db, eldenRing.iterationId, 'completed', '2026-01-10T18:00:00Z');
    await makeSession(db, eldenRing.iterationId, '2025-11-02T21:00:00Z', 3);

    assert.equal(await horasDe(2025), 3);
    assert.equal(await horasDe(2026), 200);
  });

  it('una sesión abierta también fecha las horas manuales: está empezando ahora', async () => {
    // Una sesión en marcha no aporta horas todavía (no tiene durationSec), pero
    // sí es una fecha: el juego se está jugando. Sin esto, arrancar un juego
    // recién añadido con horas manuales lo dejaría en "sin año" justo mientras
    // lo tienes abierto.
    const hades = await juego('Hades', { manualHours: 15 });
    await makeOpenSession(db, hades.iterationId, '2026-08-13T10:00:00Z');

    assert.equal(await horasDe(2026), 15);
    assert.equal(await horasDe('all'), 15);
  });
});

describe('precisión de fecha de año: "lo terminé en 2019" es 2019', () => {
  it('un final registrado con precisión de año cuenta en ese año, no el 31 de diciembre anterior', async () => {
    // Al elegir precisión "año" en el picker, la app guarda el 1 de enero a
    // MEDIANOCHE LOCAL (parseIsoDate en add-game/precisionDate.ts, que evita a
    // propósito el `new Date('YYYY-MM-DD')` que se interpreta como UTC). De
    // ahí que la fecha de este test vaya sin la Z: es el instante EXACTO que
    // escribe la app, el peor posible — está a una hora del año anterior.
    //
    // Cualquier refactor que lea el año en UTC (o que corte la cadena ISO por
    // los cuatro primeros caracteres) manda estas 60 horas a 2018 y le vacía
    // el año al usuario.
    const suikoden = await juego('Suikoden II', { manualHours: 60 });
    await makeStateEvent(db, suikoden.iterationId, 'completed', '2019-01-01T00:00:00', {
      datePrecision: 'year',
    });

    assert.equal(await horasDe(2019), 60);
    assert.equal(await horasDe(2018), 0);
  });

  it('ese mismo instante también cae en 2019 en el móvil, que ya no lee en UTC', async () => {
    // ARREGLADO, y era la divergencia Home/Stats en carne viva. Un Worker no
    // tiene zona horaria: su getFullYear() es UTC, así que la MISMA fecha con
    // precisión de año que el escritorio cuenta en 2019 la portada del móvil
    // la contaba en 2018 — 60 horas cambiando de año según qué pantalla
    // mirases.
    //
    // El año ya no lo decide el reloj del proceso que responde, sino yearOf
    // con la zona del que mira (worker/src/index.ts la saca de la petición).
    // Aquí se comprueba el helper contra el instante exacto que escribe la app
    // —1 de enero a medianoche LOCAL, a una hora del año anterior en UTC—, que
    // es donde se rompía.
    const ancla = manualHoursAnchor([
      { type: 'completed', occurredAt: new Date('2019-01-01T00:00:00') },
    ]);
    assert.ok(ancla !== null);

    // El escritorio, que ya estaba bien: lee en su propia zona.
    assert.equal(ancla.getFullYear(), 2019);
    // Y el móvil, con la zona del que mira, dice lo mismo.
    assert.equal(yearOf(ancla, 'Europe/Madrid'), 2019);
    // La trampa sigue ahí para quien vuelva a leer en UTC, y por eso yearOf
    // recibe la zona en vez de adivinarla: sin ella, el instante cae en 2018.
    assert.equal(ancla.getUTCFullYear(), 2018);
    assert.equal(yearOf(ancla, 'UTC'), 2018);
  });

  it('sin zona, yearOf lee en el reloj del proceso: el escritorio no cambia de comportamiento', async () => {
    // La zona es opcional a propósito — el escritorio ya corre en el reloj
    // bueno y el Worker sin ella se comporta como siempre (UTC). Si algún día
    // el valor por defecto pasara a ser UTC "para ser consistentes", Stats del
    // escritorio empezaría a mandar los eneros al año anterior.
    const medianocheLocal = new Date('2019-01-01T00:00:00');

    assert.equal(yearOf(medianocheLocal), 2019);
    assert.equal(yearOf(medianocheLocal, null), 2019);
    // Y una zona que no existe no revienta la pantalla: se cae al reloj del
    // proceso en vez de dejar la petición sin contestar.
    assert.equal(yearOf(medianocheLocal, 'Marte/Olympus'), 2019);
  });
});

describe('qué cuenta como juego jugado ese año', () => {
  it('un juego cuyas únicas horas del año son manuales cuenta como jugado', async () => {
    // GAMES PLAYED de un año son los juegos con horas > 0 ESE año. Si las
    // horas manuales no entraran en la cuenta, un juego terminado en 2026 con
    // 25 h de antes de la app saldría en el desglose de estados de 2026 pero
    // no en el contador de juegos: dos cifras de la misma pantalla
    // contradiciéndose.
    const chronoCross = await juego('Chrono Cross', { manualHours: 25 });
    await makeStateEvent(db, chronoCross.iterationId, 'completed', '2026-03-15T18:00:00Z');
    await juego('Nunca tocado');

    const dosMilVeintiseis = await cifrasDe(2026);
    assert.equal(dosMilVeintiseis.totalGames, 1);
    assert.equal(dosMilVeintiseis.totalHours, 25);
  });

  it('marcar un estado no es jugar, pero All Time cuenta la biblioteca entera', async () => {
    // Un Beaten tecleado sin horas no aporta ni una hora, así que no es un
    // "juego jugado" de ese año. En All Time la etiqueta es otra (GAMES
    // TRACKED) y sí entran todos, incluidos los que no has tocado nunca: son
    // dos preguntas distintas contestadas por la misma función.
    const marcado = await juego('Journey');
    await makeStateEvent(db, marcado.iterationId, 'completed', '2026-06-01T18:00:00Z');
    await juego('Nunca tocado');

    assert.equal((await cifrasDe(2026)).totalGames, 0);
    assert.equal((await cifrasDe(2026)).totalHours, 0);
    assert.equal((await cifrasDe('all')).totalGames, 2);
  });
});

describe('bordes de sesión que ya han mordido', () => {
  it('la sesión de nochevieja se cuenta entera en el año en que empezó', async () => {
    // Cuatro horas desde las diez de la noche del 31: la sesión acaba en el
    // año siguiente. El reparto es por la fecha de INICIO y no se parte por la
    // mitad — lo importante no es cuál de las dos reglas sea, es que la hora
    // se cuente UNA vez: 4 en 2026, 0 en 2027 y 4 en total.
    //
    // La fecha va en hora local a propósito (sin Z): es el borde exacto que se
    // quiere probar, y a las 22:00 UTC en Madrid ya sería 2027.
    const balatro = await juego('Balatro');
    await makeSession(db, balatro.iterationId, '2026-12-31T22:00:00', 4);

    assert.equal(await horasDe(2026), 4);
    assert.equal(await horasDe(2027), 0);
    assert.equal(await horasDe('all'), 4);
  });

  it('la sesión que está en marcha todavía no aporta horas al año', async () => {
    // Una sesión abierta no tiene durationSec, y sumarla como 0 es lo correcto
    // (sus horas entran al cerrarla). Ojo con el detalle que ya costó un fallo
    // en el overlay: la sesión abierta SÍ cuenta como sesión desde el primer
    // minuto, así que este juego enseña 1 sesión y 0 horas a la vez, y no está
    // roto.
    const factorio = await juego('Factorio');
    await makeOpenSession(db, factorio.iterationId, '2026-08-13T10:00:00Z');

    const dosMilVeintiseis = await cifrasDe(2026);
    assert.equal(dosMilVeintiseis.totalHours, 0);
    assert.equal(dosMilVeintiseis.totalGames, 0);

    const [enPantalla] = await getGames();
    assert.equal(enPantalla.sessionCount, 1);
    assert.equal(enPantalla.totalHours, 0);
  });

  it('cada vuelta al mismo juego deja sus horas manuales en su propio año', async () => {
    // Un juego con dos playthroughs no tiene "unas horas manuales": tiene una
    // por vuelta, cada una con su año. Sumarlas por juego antes de repartir
    // las metería todas en el mismo año y falsearía los dos.
    const darkSouls = await juego('Dark Souls', { manualHours: 30 });
    const ngPlus = await otraVuelta(darkSouls.gameId, 'NG+', 12);
    await makeStateEvent(db, darkSouls.iterationId, 'completed', '2023-05-01T18:00:00Z');
    await makeStateEvent(db, ngPlus, 'completed', '2026-02-14T18:00:00Z');

    assert.equal(await horasDe(2023), 30);
    assert.equal(await horasDe(2026), 12);
    assert.equal(await horasDe('all'), 42);
    // Y sigue siendo UN juego jugado en cada uno de los dos años, no dos.
    assert.equal((await cifrasDe(2023)).totalGames, 1);
    assert.equal((await cifrasDe(2026)).totalGames, 1);
  });
});

describe('el gasto del año y el coste por hora', () => {
  it('el gasto se filtra por SU fecha, aunque las horas del juego caigan en otro año', async () => {
    // Comprado en las rebajas de diciembre y jugado al año siguiente: el
    // dinero cuenta en el año en que salió de la cartera y las horas en el
    // suyo. Mezclarlos daría un coste por hora inventado en los dos años.
    const tunic = await juego('Tunic', { manualHours: 10 });
    await makeStateEvent(db, tunic.iterationId, 'completed', '2026-03-01T18:00:00Z');
    const gastos = [gasto(tunic.gameId, 20, '2025-12-22T12:00:00Z')];

    const dosMilVeintiseis = await cifrasDe(2026, gastos);
    assert.equal(dosMilVeintiseis.totalHours, 10);
    assert.equal(dosMilVeintiseis.totalSpent, 0);
    assert.equal(dosMilVeintiseis.costPerHour, 0);

    const dosMilVeinticinco = await cifrasDe(2025, gastos);
    assert.equal(dosMilVeinticinco.totalSpent, 20);
  });

  it('un año con gasto y sin horas no tiene coste por hora: null, no infinito', async () => {
    // Comprar un juego y no tocarlo es de lo más normal, y una división entre
    // cero pintaría "∞ €/h" en la cabecera de Stats. null es "no se puede
    // decir", que es la verdad.
    const comprado = await juego('Cyberpunk 2077');
    const gastos = [gasto(comprado.gameId, 60, '2025-11-20T12:00:00Z')];

    const dosMilVeinticinco = await cifrasDe(2025, gastos);
    assert.equal(dosMilVeinticinco.totalHours, 0);
    assert.equal(dosMilVeinticinco.totalSpent, 60);
    assert.equal(dosMilVeinticinco.costPerHour, null);
  });
});
