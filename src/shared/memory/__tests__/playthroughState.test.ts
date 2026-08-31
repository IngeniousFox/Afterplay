import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
// El andamio de la DB se importa ARRIBA a propósito: registra su mock.module
// al cargarse, y tiene que estar puesto antes de que nadie importe la consulta
// bajo prueba (por eso getMemoryFacts entra con un await import dentro de un
// before, ver su cabecera). Los tests puros de este fichero no se enteran.
import {
  cleanupDbs,
  freshDb,
  makeGame,
  makeIteration,
  makeStateEvent,
  type TestDb,
} from '../../../main/db/__tests__/harness';
import {
  closesOpenSession,
  endsPlaythrough,
  isAddedAtArtifact,
  latestRealStateEvent,
  leavesEndDate,
  manualHoursAnchor,
} from '../../playthroughState';
import type { StateEvent } from '../../types';
import { isMeaningfulStateEvent, listClosedPeriodsWithActivity } from '../chapters';

type EventType = StateEvent['type'];

// Una fila del log de estados tal como la traen los llamantes reales
// (getGames, el Journey, resolveIterationForPlay): el trío que mira el helper
// más el iterationId que NO mira pero que quien llama necesita de vuelta.
type LogEvent = {
  id: number;
  iterationId: number;
  type: EventType;
  occurredAt: Date;
};

// El id crece en el orden en que se escribieron los eventos, que es justo lo
// que desempata cuando dos comparten fecha exacta. Los tests que dependen del
// desempate pasan el id a mano; el resto no se entera de que existe.
let nextId = 1;
const logEvent = (
  type: EventType,
  occurredAt: string,
  overrides: Partial<LogEvent> = {},
): LogEvent => ({
  id: nextId++,
  iterationId: 1,
  type,
  occurredAt: new Date(occurredAt),
  ...overrides,
});

// El instante del alta de un juego: la fila del juego y su evento inicial se
// escriben en la MISMA transacción, así que todo lo que aterrice a unos
// milisegundos de aquí es papeleo, no una jugada.
const ALTA = new Date('2026-08-13T10:00:00');
const cercaDelAlta = (offsetMs: number): Date => new Date(ALTA.getTime() + offsetMs);

describe('los tres "terminal" de SPEC 4.5', () => {
  // Cada predicado contesta una pregunta distinta y por eso son tres
  // conjuntos y no uno. Estas cuatro tablas son la SPEC 4.5 escrita como
  // aserción: si alguien mueve un tipo de conjunto, aquí se ve el sitio
  // exacto. Van como Record<EventType, …> a propósito — añadir un estado al
  // enum del schema deja de compilar hasta que se decida qué contesta.
  const ENDS: Record<EventType, boolean> = {
    started: false,
    completed: true,
    dropped: true,
    on_hold: false,
    resting: false,
    plan_to_play: false,
  };
  const LEAVES: Record<EventType, boolean> = {
    started: false,
    completed: true,
    dropped: true,
    on_hold: true,
    resting: false,
    plan_to_play: false,
  };
  const CLOSES: Record<EventType, boolean> = {
    started: false,
    completed: true,
    dropped: true,
    on_hold: true,
    resting: true,
    plan_to_play: false,
  };
  const TODOS = Object.keys(ENDS) as EventType[];

  it('solo completed y dropped cierran el playthrough: volver a jugar abre uno nuevo', () => {
    // Quien decide con esto es resolveIterationForPlay (¿playthrough nuevo o
    // reanudar?) y el isTerminal del renderer. Si on_hold se colara aquí,
    // retomar un juego aparcado dejaría un playthrough huérfano por cada
    // vuelta en vez de continuar el mismo.
    for (const type of TODOS) {
      assert.equal(endsPlaythrough(type), ENDS[type], type);
    }
  });

  it('on_hold no acaba el playthrough pero sí deja fecha de salida', () => {
    // La asimetría que más se paga: aparcar algo es una fecha que enseñar
    // ("Finished / left") y el ancla de sus horas manuales, pero el
    // playthrough sigue vivo y retomarlo es seguir el mismo.
    assert.equal(endsPlaythrough('on_hold'), false);
    assert.equal(leavesEndDate('on_hold'), true);
    for (const type of TODOS) {
      assert.equal(leavesEndDate(type), LEAVES[type], type);
    }
  });

  it('resting cierra la sesión abierta aunque no deje fecha ni acabe nada', () => {
    // El endless que pasa a descansar tampoco se está jugando: si addStateEvent
    // no cerrara su sesión abierta, esas horas se quedarían sin contar hasta
    // que el watcher detectara el cierre real del proceso. Y aun así resting
    // NO deja fecha de salida: un descanso no es un final.
    assert.equal(closesOpenSession('resting'), true);
    assert.equal(leavesEndDate('resting'), false);
    assert.equal(endsPlaythrough('resting'), false);
    for (const type of TODOS) {
      assert.equal(closesOpenSession(type), CLOSES[type], type);
    }
  });

  it('plan_to_play no es final de nada: planear no es jugar', () => {
    // Es una entrada de historial, no un estado (schema.ts). Si entrara en
    // cualquiera de los tres, meter un juego en el Plan cerraría sesiones o
    // fabricaría una fecha de fin de algo que no se ha tocado.
    assert.equal(endsPlaythrough('plan_to_play'), false);
    assert.equal(leavesEndDate('plan_to_play'), false);
    assert.equal(closesOpenSession('plan_to_play'), false);
  });

  it('un juego sin eventos (Unplayed) no es terminal: null y undefined contestan false', () => {
    // Los tres aceptan nullable a propósito — currentState es null en un juego
    // sin tocar y los llamantes no deben repetir la guarda. Un `!` mal puesto
    // aquí convertiría toda la biblioteca sin jugar en "terminada".
    for (const predicado of [endsPlaythrough, leavesEndDate, closesOpenSession]) {
      assert.equal(predicado(null), false);
      assert.equal(predicado(undefined), false);
    }
  });

  it('hoy los tres conjuntos anidan: lo que acaba deja fecha, y lo que deja fecha cierra sesión', () => {
    // El código avisa de que anidar es casualidad del enum y no una regla, así
    // que esto es un cable trampa, no un dogma: si alguien mete un estado en
    // el conjunto estrecho y se olvida de los otros dos, salta aquí y decide
    // a propósito. Que estuvieran escritos a mano en ocho sitios (SPEC 12.3)
    // es exactamente cómo se llegó a tres definiciones que no coincidían.
    for (const type of TODOS) {
      if (endsPlaythrough(type)) assert.equal(leavesEndDate(type), true, type);
      if (leavesEndDate(type)) assert.equal(closesOpenSession(type), true, type);
    }
  });
});

describe('latestRealStateEvent — cuál es el estado de ahora', () => {
  it('un plan_to_play posterior no roba el estado: planear no es jugar', () => {
    // Caso real y no rebuscado: un juego del Plan que pasas a la biblioteca
    // marcándolo como jugado en el pasado. El 'completed' lleva la fecha de
    // entonces y el 'plan_to_play' la de cuando lo planeaste, que es POSTERIOR.
    // Sin el filtro, la ficha diría "Plan to play" de un juego terminado.
    const jugadoEnSuDia = logEvent('completed', '2019-11-02T21:00');
    const planeado = logEvent('plan_to_play', '2026-05-01T09:00');
    assert.equal(latestRealStateEvent([jugadoEnSuDia, planeado]), jugadoEnSuDia);
  });

  it('sin eventos reales no hay estado: devuelve undefined, que es Unplayed', () => {
    // Unplayed es ausencia, no un valor del enum (SPEC 4.4). Un juego que solo
    // está planeado tiene log y aun así no tiene estado.
    assert.equal(latestRealStateEvent([]), undefined);
    assert.equal(latestRealStateEvent([logEvent('plan_to_play', '2026-05-01T09:00')]), undefined);
  });

  it('con la misma fecha exacta gana el insertado después, el de id mayor', () => {
    // Esto no es un empate teórico: dar de alta un juego como Beaten poniendo
    // solo la fecha de inicio escribe DOS eventos —'started' y 'completed'—
    // con el MISMO occurredAt (writeInitialPlaythrough usa la fecha de inicio
    // cuando no hay fecha de fin). El id es lo único que distingue "lo empecé"
    // de "me lo pasé"; sin el desempate la ficha diría Playing.
    const empezado = logEvent('started', '2023-04-02T00:00', { id: 40 });
    const terminado = logEvent('completed', '2023-04-02T00:00', { id: 41 });
    assert.equal(latestRealStateEvent([empezado, terminado]), terminado);
    // Y da igual el orden del array: el id manda, no la posición.
    assert.equal(latestRealStateEvent([terminado, empezado]), terminado);
  });

  it('no depende de ningún ORDER BY: el mismo log revuelto da el mismo estado', () => {
    // Cada llamante trae sus filas de una query distinta y alguna no ordena.
    // Recorrer el array entero quedándose con la mejor candidata es lo que
    // permite que getGames agrupe por juego sin volver a ordenar nada.
    const log = [
      logEvent('started', '2024-01-05T18:00', { id: 1 }),
      logEvent('on_hold', '2024-03-20T18:00', { id: 2 }),
      logEvent('started', '2024-06-01T18:00', { id: 3 }),
      logEvent('completed', '2024-08-11T22:30', { id: 4 }),
    ];
    const esperado = log[3];
    const revuelto = [log[2], log[0], log[3], log[1]];
    assert.equal(latestRealStateEvent(log), esperado);
    assert.equal(latestRealStateEvent(revuelto), esperado);
    assert.equal(latestRealStateEvent([...log].reverse()), esperado);
  });

  it('el primer candidato no se pierde aunque el log empiece por plan_to_play', () => {
    // El `if (!latest)` de dentro corre DESPUÉS del filtro, no antes. Si se
    // invirtieran, el plan quedaría como candidato inicial y un 'started'
    // anterior ya no podría desbancarlo por fecha.
    const planeado = logEvent('plan_to_play', '2026-05-01T09:00', { id: 10 });
    const empezado = logEvent('started', '2020-02-02T12:00', { id: 11 });
    assert.equal(latestRealStateEvent([planeado, empezado]), empezado);
  });

  it('devuelve la fila entera que le pasaron, no un resumen de tres campos', () => {
    // Es genérico porque cada llamante trae campos de más y los necesita de
    // vuelta: getGames se lleva el iterationId de esta misma fila para
    // atribuir el año de las horas manuales. Un refactor que "normalizara" la
    // salida a {type, occurredAt, id} rompería eso en silencio.
    const evento = logEvent('completed', '2025-12-24T23:00', { iterationId: 77 });
    assert.equal(latestRealStateEvent([evento])?.iterationId, 77);
  });
});

describe('isAddedAtArtifact — el papeleo del alta no es una jugada', () => {
  it('el evento que escribe el alta cae pegado al addedAt y no cuenta como jugado', () => {
    // Medido en la BD real: 6 juegos de 331 salían los primeros en "Last
    // played" sin haberse tocado nunca, porque su evento inicial heredó la
    // hora del alta. El alta y el evento son dos escrituras de la misma
    // transacción: caen a milisegundos, nunca en el mismo timestamp.
    assert.equal(isAddedAtArtifact(cercaDelAlta(37), ALTA), true);
    assert.equal(isAddedAtArtifact(cercaDelAlta(0), ALTA), true);
  });

  it('una fecha tecleada por ti se guarda a medianoche, a horas del alta', () => {
    // Por esto el margen puede ser tan generoso como 5 segundos sin tragarse
    // datos buenos: lo que tecleas aterriza en la medianoche local de ese día,
    // así que ni el mismo día del alta se acerca al umbral.
    const tecleadaHoyMismo = new Date('2026-08-13T00:00:00');
    assert.equal(isAddedAtArtifact(tecleadaHoyMismo, ALTA), false);
  });

  it('el margen son 5 s y el borde exacto NO es artefacto', () => {
    // Fijar el borde importa porque el número está copiado a mano en tres
    // sitios más (renderer/lib/journeyEntries.ts, shared/memory/chapters.ts y
    // worker/src/queries/library.ts): si alguien cambia uno, el juego aparece
    // en el Journey y no en la biblioteca, o al revés.
    assert.equal(isAddedAtArtifact(cercaDelAlta(4_999), ALTA), true);
    assert.equal(isAddedAtArtifact(cercaDelAlta(5_000), ALTA), false);
  });

  it('el margen es simétrico: un evento un pelín ANTES del alta también es papeleo', () => {
    // El orden de las dos escrituras dentro de la transacción no es una
    // garantía, y el addedAt también cae de un default. Con un valor absoluto
    // el signo deja de importar; con una resta a pelo, medio caso se escapa.
    assert.equal(isAddedAtArtifact(cercaDelAlta(-37), ALTA), true);
    assert.equal(isAddedAtArtifact(cercaDelAlta(-5_000), ALTA), false);
  });

  it('sin addedAt no hay con qué comparar y se conserva la fecha', () => {
    // "No lo sé" es NO artefacto a propósito: descartar un evento por si acaso
    // pierde una fecha buena, que duele más que colar una mala.
    assert.equal(isAddedAtArtifact(cercaDelAlta(37), null), false);
    assert.equal(isAddedAtArtifact(cercaDelAlta(37), undefined), false);
  });

  it('el papeleo del PROMOTE se reconoce contra promotedAt, no contra addedAt', () => {
    // El agujero que trajo la segunda referencia: planeas en enero (addedAt),
    // promocionas en agosto marcando Beaten SIN fechas — el 'completed' nace
    // en la transacción del promote, a meses de addedAt, y pasaba por jugada
    // real de hoy. promotedAt se sella en esa misma transacción, así que el
    // papeleo cae dentro de su margen igual que el del alta cae en el suyo.
    const PROMOTE = new Date('2026-08-26T18:00:00');
    const papeleoDelPromote = new Date(PROMOTE.getTime() + 41);
    assert.equal(isAddedAtArtifact(papeleoDelPromote, ALTA), false);
    assert.equal(isAddedAtArtifact(papeleoDelPromote, ALTA, PROMOTE), true);
    // Y las dos referencias conviven: el papeleo del ALTA sigue cayendo.
    assert.equal(isAddedAtArtifact(cercaDelAlta(37), ALTA, PROMOTE), true);
    // Un juego nunca promocionado (promotedAt null) responde como siempre.
    assert.equal(isAddedAtArtifact(papeleoDelPromote, ALTA, null), false);
  });
});

describe('manualHoursAnchor — a qué año van unas horas que nadie midió', () => {
  it('el fin manda sobre el principio: "me lo pasé en 2023" pone ahí las horas', () => {
    // SPEC 4.4. Un playthrough que arrancó en 2022 y terminó en 2023 cuelga
    // sus horas manuales de 2023, que es como lo cuenta uno mismo. Si mandara
    // el inicio, Stats diría que ese año jugaste algo que acabaste al otro.
    const ancla = manualHoursAnchor([
      logEvent('started', '2022-11-05T20:00'),
      logEvent('completed', '2023-04-02T23:30'),
    ]);
    assert.equal(ancla?.getFullYear(), 2023);
  });

  it('con varios finales manda el último: el playthrough que se aparcó y luego se acabó', () => {
    // Aparcado en enero, retomado y terminado al año siguiente. Las horas van
    // al desenlace, no a la primera pausa.
    const ancla = manualHoursAnchor([
      logEvent('started', '2022-11-05T20:00'),
      logEvent('on_hold', '2023-01-10T19:00'),
      logEvent('started', '2024-01-02T19:00'),
      logEvent('completed', '2024-02-01T21:00'),
    ]);
    assert.equal(ancla?.getTime(), new Date('2024-02-01T21:00').getTime());
  });

  it('un on_hold ancla las horas aunque el playthrough siga vivo', () => {
    // Aquí se ve para qué existe el conjunto de en medio: aparcar no acaba
    // nada, pero es la última fecha en la que ese juego estuvo en tu vida, y
    // es donde tienen sentido sus horas.
    const ancla = manualHoursAnchor([
      logEvent('started', '2022-01-01T12:00'),
      logEvent('on_hold', '2022-06-01T12:00'),
    ]);
    assert.equal(ancla?.getTime(), new Date('2022-06-01T12:00').getTime());
  });

  it('resting no ancla: el endless que descansa se queda con su fecha de inicio', () => {
    // La otra cara de la moneda anterior, y la que sorprende: resting cierra
    // la sesión abierta pero NO deja fecha de salida, así que unas horas
    // manuales de un endless en descanso siguen colgadas de cuando empezó.
    const ancla = manualHoursAnchor([
      logEvent('started', '2021-03-01T17:00'),
      logEvent('resting', '2024-09-01T17:00'),
    ]);
    assert.equal(ancla?.getTime(), new Date('2021-03-01T17:00').getTime());
  });

  it('sin final ancla el PRIMER started, no el último', () => {
    // Un playthrough que se retomó tiene varios 'started'. Las horas van a
    // cuando empezó la historia; si fuera el último, reanudar un juego movería
    // de año unas horas que ya estaban contadas.
    const ancla = manualHoursAnchor([
      logEvent('started', '2022-08-14T10:00'),
      logEvent('started', '2022-01-09T10:00'),
    ]);
    assert.equal(ancla?.getTime(), new Date('2022-01-09T10:00').getTime());
  });

  it('el fin manda aunque esté ANTES del inicio: es prioridad, no "el último evento"', () => {
    // Log tecleado a mano y contradictorio (un Beaten de 2019 y un Started de
    // 2022). La regla no es "el evento más reciente", es "el fin si lo hay":
    // un refactor que lo reescribiera como un solo recorrido buscando el
    // máximo cambiaría esta respuesta sin que nadie lo notara.
    const ancla = manualHoursAnchor([
      logEvent('completed', '2019-05-05T18:00'),
      logEvent('started', '2022-03-03T18:00'),
    ]);
    assert.equal(ancla?.getFullYear(), 2019);
  });

  it('un playthrough sin fechas del log devuelve null: esas horas solo cuentan en All Time', () => {
    // Ni log vacío ni un log que solo tenga intención. Devolver una fecha
    // inventada aquí metería horas en un año al azar de Stats.
    assert.equal(manualHoursAnchor([]), null);
    assert.equal(manualHoursAnchor([logEvent('plan_to_play', '2026-05-01T09:00')]), null);
  });

  it('el evento del alta ya NO ancla las horas manuales: sin fechas de verdad, solo All Time', () => {
    // ARREGLADO. Antes esto anclaba en el año del alta y estaba fijado como
    // caracterización: manualHoursAnchor no aplicaba isAddedAtArtifact aunque
    // la regla viva en el mismo fichero y getGames sí la aplique para
    // "Last played" — la misma pantalla se contradecía consigo misma.
    //
    // Caso real: das de alta hoy (agosto de 2026) un juego viejo marcándolo
    // Beaten con 90 horas a mano y SIN teclear fechas. writeInitialPlaythrough
    // escribe el 'completed' con el occurredAt por defecto, o sea el instante
    // del alta, y esas 90 horas aparecían en el año 2026 de Stats: 90 horas
    // que nadie jugó este año, en la cifra que más se mira. Ahora ese log no
    // tiene ninguna fecha de verdad, así que no hay ancla y las horas solo
    // cuentan en All Time, que es lo que promete la cabecera de la función.
    const eventoDelAlta = logEvent('completed', '2026-08-13T10:00:00.037');
    assert.equal(manualHoursAnchor([eventoDelAlta], ALTA), null);
  });

  it('quien no sabe el addedAt sigue anclando: "no lo sé" no tira fechas por si acaso', () => {
    // El parámetro es opcional a propósito, igual que isAddedAtArtifact acepta
    // un addedAt nulo: sin nada con que comparar, descartar el evento perdería
    // una fecha buena. Es el contrato que permitió arreglar esto sin romper de
    // golpe a los cuatro llamantes.
    const eventoDelAlta = logEvent('completed', '2026-08-13T10:00:00.037');
    assert.equal(manualHoursAnchor([eventoDelAlta])?.getFullYear(), 2026);
    assert.equal(manualHoursAnchor([eventoDelAlta], null)?.getFullYear(), 2026);
  });

  it('el filtro del alta no se lleva por delante las fechas que sí tecleaste', () => {
    // El borde contrario del arreglo, que es el que de verdad daba miedo: un
    // juego dado de alta HOY y marcado como terminado en 2019 tiene su fecha
    // buena, y perderla sacaría 90 horas del año que les toca. Solo cae lo que
    // aterriza pegado al alta.
    const ancla = manualHoursAnchor(
      [logEvent('started', '2018-01-06T00:00'), logEvent('completed', '2019-05-05T00:00')],
      ALTA,
    );
    assert.equal(ancla?.getFullYear(), 2019);
  });

  it('con el fin descartado por artefacto, el inicio tecleado se queda con las horas', () => {
    // Los dos recorridos de la función (el fin primero, el inicio después)
    // tienen que ver el MISMO log filtrado. Caso: marcas hoy como Beaten un
    // juego del que sí recuerdas cuándo lo empezaste. El 'completed' es
    // papeleo del alta y se cae; el 'started' de 2015 es tuyo y manda.
    const ancla = manualHoursAnchor(
      [logEvent('started', '2015-07-01T00:00'), logEvent('completed', ALTA.toISOString())],
      ALTA,
    );
    assert.equal(ancla?.getFullYear(), 2015);
  });

  it('el orden de llegada de los eventos no cambia el ancla', () => {
    // Igual que latestRealStateEvent: las filas llegan de queries distintas y
    // ninguna promete orden.
    const log = [
      logEvent('completed', '2024-02-01T21:00'),
      logEvent('started', '2022-11-05T20:00'),
      logEvent('on_hold', '2023-01-10T19:00'),
    ];
    const esperado = new Date('2024-02-01T21:00').getTime();
    assert.equal(manualHoursAnchor(log)?.getTime(), esperado);
    assert.equal(manualHoursAnchor([...log].reverse())?.getTime(), esperado);
  });
});

describe('una sola regla del alta, y no cuatro copias del mismo número', () => {
  it('el filtro del Loop y isAddedAtArtifact parten el pelo en el mismo milisegundo', () => {
    // ARREGLADO: isMeaningfulStateEvent (shared/memory/chapters.ts) llamaba a
    // su propia copia del 5_000 y ahora pregunta a isAddedAtArtifact. Las dos
    // pantallas tienen que estar de acuerdo en qué meses existen: si el Loop
    // considera hito lo que el Journey descarta, cobra un recap de un mes que
    // no se puede leer en ninguna parte. Con la delegación esto ya no puede
    // separarse por el valor, pero sigue vigilando el operador y el sentido
    // (que nadie invierta la condición al tocar el filtro).
    for (const offset of [0, 37, 4_999, 5_000, 60_000]) {
      const occurredAt = cercaDelAlta(offset);
      assert.equal(
        isMeaningfulStateEvent({ gameId: 1, type: 'completed', occurredAt, addedAt: ALTA }),
        !isAddedAtArtifact(occurredAt, ALTA),
        `offset ${offset}`,
      );
    }
  });

  it('sin addedAt el Loop conserva el evento: la otra mitad del filtro no se contagia', () => {
    // La mitad "intención" cae siempre; la mitad "alta" solo cuando hay con
    // qué comparar. Un juego cuyo addedAt no llegue no puede perder su
    // historia por el camino.
    const lejosDelAlta = cercaDelAlta(60_000);
    assert.equal(isMeaningfulStateEvent({ gameId: 1, type: 'completed', occurredAt: ALTA }), true);
    assert.equal(
      isMeaningfulStateEvent({ gameId: 1, type: 'plan_to_play', occurredAt: lejosDelAlta }),
      false,
    );
  });

  it('ni el Journey ni la biblioteca del móvil llevan ya su copia del margen', () => {
    // Este test lee CÓDIGO FUENTE, que es raro, y tiene un porqué: las otras
    // dos copias no se pueden vigilar comparando resultados desde aquí —
    // journeyEntries.ts no exporta su meaningfulEvents, y el worker vive en
    // otro proyecto que este fichero no puede importar. Eran cuatro escrituras
    // del mismo 5_000 que coincidían por costumbre; mover el margen en shared
    // dejaba al Journey y al móvil con el criterio viejo y el mismo juego era
    // hito del mes en una pantalla y no en la otra.
    //
    // Se comprueba lo mínimo que delata una recaída: que el fichero llame a la
    // función compartida, que no DECLARE otra tolerancia y que no vuelva a
    // haber una resta a mano contra el occurredAt. Nada de buscar el número
    // suelto — un 5000 de un timeout ajeno pondría esto rojo sin motivo — y la
    // tolerancia se busca con su `=` delante para no cazar los comentarios que
    // cuentan justo esta historia.
    const copias = [
      '../../../renderer/src/lib/journeyEntries.ts',
      '../../../../worker/src/queries/library.ts',
    ];
    for (const ruta of copias) {
      const fuente = readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
      assert.ok(fuente.includes('isAddedAtArtifact'), `${ruta} ya no llama a la regla compartida`);
      assert.ok(
        !/ADDED_AT_TOLERANCE_MS\s*=/.test(fuente),
        `${ruta} ha vuelto a declarar su propia tolerancia`,
      );
      assert.ok(
        !/Math\.abs\([^\n]*occurredAt/.test(fuente),
        `${ruta} ha vuelto a restar la fecha del alta a mano`,
      );
    }
  });
});

// La regla del alta estaba escrita y probada, pero al Loop le faltaba el DATO:
// getMemoryFacts seleccionaba iteración, juego, tipo y fecha, nunca
// games.addedAt, así que la mitad "alta" de isMeaningfulStateEvent no llegaba a
// aplicarse NUNCA en la app por muy verde que estuviera su test unitario. Por
// eso esto se prueba contra la base de datos de verdad y no con un doble: lo
// que faltaba era el cableado, y un doble lo habría cableado por mí.
describe('el Loop recibe de la DB la fecha de alta que su filtro necesita', () => {
  let db: TestDb;
  let getMemoryFacts: typeof import('../../../main/db/queries/memories/getMemoryFacts').getMemoryFacts;

  // El await import va DENTRO del before para que el mock.module del andamio ya
  // esté registrado cuando la consulta resuelva su getDb (ver harness.ts).
  before(async () => {
    ({ getMemoryFacts } = await import('../../../main/db/queries/memories/getMemoryFacts'));
  });
  beforeEach(async () => {
    db = await freshDb();
  });
  after(cleanupDbs);

  // Agosto, para que marzo y enero cuenten como periodos CERRADOS.
  const AHORA = new Date('2026-08-13T12:00:00');
  const ALTA_DE_MARZO = new Date('2026-03-05T10:00:00Z');

  // Los meses que el Loop consideraría generables con esos hechos, como
  // 'año-mes' (mes 0-11, como Date). Sin sesiones: aquí se mide qué abren los
  // EVENTOS, que es lo que el papeleo del alta inflaba.
  const mesesDe = (events: Awaited<ReturnType<typeof getMemoryFacts>>['events']): string[] =>
    listClosedPeriodsWithActivity([], events, AHORA).months.map((scope) =>
      scope.type === 'month' ? `${scope.year}-${scope.month}` : String(scope.year),
    );

  it('meter juegos viejos marcados Beaten ya no abre —ni cobra recap de— el mes del alta', async () => {
    // El caso de la ficha: treinta juegos viejos dados de alta en marzo sin
    // teclear fechas abrían marzo en el Loop ("you finished thirty games in
    // March") mientras el Journey no pintaba ni una carátula ese mes, así que
    // ese recap pagado no se podía leer en ninguna parte.
    const viejo = await makeGame(db, { title: 'Juego viejo', addedAt: ALTA_DE_MARZO });
    const iteracion = await makeIteration(db, viejo);
    await makeStateEvent(
      db,
      iteracion,
      'completed',
      new Date(ALTA_DE_MARZO.getTime() + 37).toISOString(),
    );

    const facts = await getMemoryFacts();
    assert.equal(facts.events.length, 1);
    assert.deepEqual(facts.events[0].addedAt, ALTA_DE_MARZO);
    assert.deepEqual(mesesDe(facts.events), []);
  });

  it('un final tecleado de verdad sí abre su mes, aunque el alta sea de otro', async () => {
    // El borde contrario: lo que se filtra es el papeleo, no la historia. Un
    // Beaten fechado a mano en enero abre enero por mucho que el juego se
    // diera de alta en marzo — si esto cayera, el arreglo habría dejado ciego
    // al Loop en vez de sincerarlo.
    const juego = await makeGame(db, { title: 'Terminado en enero', addedAt: ALTA_DE_MARZO });
    const iteracion = await makeIteration(db, juego);
    await makeStateEvent(db, iteracion, 'completed', '2026-01-20T18:00:00');

    assert.deepEqual(mesesDe((await getMemoryFacts()).events), ['2026-0']);
  });

  it('unas horas manuales que solo tienen el evento del alta no se cuelgan de ningún mes', async () => {
    // La misma cadena un paso más allá: el ancla de esas horas. Sin esto, el
    // capítulo del mes del alta se llevaba 200 horas de un juego que llevas
    // años sin tocar, y encima las narraba.
    const juego = await makeGame(db, {
      title: 'Doscientas horas de antes',
      addedAt: ALTA_DE_MARZO,
    });
    const iteracion = await makeIteration(db, juego, { manualTotalPlayed: 200 });
    await makeStateEvent(
      db,
      iteracion,
      'completed',
      new Date(ALTA_DE_MARZO.getTime() + 12).toISOString(),
    );

    const facts = await getMemoryFacts();
    assert.deepEqual(facts.manualBlocks, [{ gameId: juego, hours: 200, anchor: null }]);
    // Y el total por juego NO se toca: esas horas siguen existiendo en All
    // Time, lo único que no tienen es un mes al que pertenecer.
    assert.equal(facts.manualHoursByGame.get(juego), 200);
  });
});
