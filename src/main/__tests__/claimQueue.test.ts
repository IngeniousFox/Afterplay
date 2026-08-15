import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { ClaimQueue, ClaimQueueProgress } from '../lib/claimQueue';
import { createClaimQueue } from '../lib/claimQueue';

// La cola serial con reserva, probada DIRECTAMENTE.
//
// Hasta ahora solo se probaba de refilón, a través de sus tres inquilinos
// (curiosities, memories, steam) en queues.test.ts. Eso valió para blindar la
// unificación —era su propósito: caracterizar las tres colas originales y
// comprobar que la deduplicación no movía nada—, pero deja la mecánica atada
// a los dominios: para tocar el ciclo de vida hay que leer tres módulos con
// Anthropic, Steam y la DB en medio, y cada regla queda contada tres veces y
// media.
//
// Aquí no hay dominio ninguno: elementos con id y etiqueta, y las reglas que
// el propio módulo declara en su cabecera (SERIE, RESERVA, RACHAS, PUERTA,
// STOP, FALLOS, PROGRESO) más las que AFTERPLAY-LOOP.md §3.2 le pide a la
// cola de recaps ("serial, una llamada en vuelo como mucho, claimed por
// scope, stop after this one").
//
// No hace falta mock.module ni base de datos: lib/claimQueue no importa nada.
// Cada test se fabrica su propia cola con makeRig(), así que no hay estado
// compartido entre tests ni orden que respetar.

// ── El banco de pruebas ───────────────────────────────────────────────────

type Item = { id: number; label: string };

const item = (id: number, label = `Elemento ${id}`): Item => ({ id, label });

// [running, done, total, failed, id del elemento en vuelo]. En tupla porque
// las secuencias de progreso se leen mejor de un vistazo que como objetos.
type ProgressRow = [boolean, number, number, number, number | null];

type Deferred = { promise: Promise<void>; resolve: () => void };

const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Espera activa: la cola no expone su promesa de worker (a propósito, igual
// que en la app), así que se observa desde fuera como haría el renderer.
const waitUntil = async (condition: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timeout esperando: ${what}`);
    await sleep(5);
  }
};

type Rig = {
  queue: ClaimQueue<Item>;
  // Los ids en el orden en que ENTRARON a process, que es el orden real de
  // atención de la cola (el de salida puede engañar si algo se queda colgado).
  started: number[];
  // Las etiquetas con las que se llamó a process: sirve para ver CUÁL de dos
  // elementos con la misma clave es el que llegó a ejecutarse.
  startedLabels: string[];
  finished: number[];
  progress: ProgressRow[];
  // isRunning() leído DENTRO de cada onProgress: el renderer no ve otra cosa.
  runningAtProgress: boolean[];
  itemErrors: Array<{ id: number; message: string }>;
  workerErrors: string[];
  runStarts: number;
  maxInFlight: number;
  // Deja el elemento colgado dentro de process hasta que se le suelte: así el
  // test decide cuándo avanza la cola sin depender de relojes.
  hold: (id: number) => void;
  release: (id: number) => void;
  failOn: (id: number) => void;
  // Deja de fallar: para los reintentos, donde lo que se comprueba es que el
  // elemento vuelve a pasar, no que vuelva a romperse.
  healOn: (id: number) => void;
  closeGate: () => void;
  openGate: () => void;
  setGate: (gate: () => boolean) => void;
  onProgressExtra: (progress: ClaimQueueProgress<Item>) => void;
};

const makeRig = (
  options: { keyOf?: (item: Item) => number | string; breatheMs?: number } = {},
): Rig => {
  const gates = new Map<number, Deferred>();
  const failing = new Set<number>();
  let gateOpen = true;
  let gate: () => boolean = () => gateOpen;
  let inFlight = 0;

  const rig: Rig = {
    queue: null as unknown as ClaimQueue<Item>,
    started: [],
    startedLabels: [],
    finished: [],
    progress: [],
    runningAtProgress: [],
    itemErrors: [],
    workerErrors: [],
    runStarts: 0,
    maxInFlight: 0,
    hold: (id) => gates.set(id, deferred()),
    release: (id) => gates.get(id)?.resolve(),
    failOn: (id) => failing.add(id),
    healOn: (id) => failing.delete(id),
    closeGate: () => {
      gateOpen = false;
    },
    openGate: () => {
      gateOpen = true;
    },
    setGate: (next) => {
      gate = next;
    },
    onProgressExtra: () => {},
  };

  rig.queue = createClaimQueue<Item>({
    keyOf: options.keyOf ?? ((entry) => entry.id),
    canRun: () => gate(),
    breatheMs: options.breatheMs,
    process: async (entry) => {
      inFlight++;
      rig.maxInFlight = Math.max(rig.maxInFlight, inFlight);
      rig.started.push(entry.id);
      rig.startedLabels.push(entry.label);
      try {
        await gates.get(entry.id)?.promise;
        if (failing.has(entry.id)) throw new Error(`boom ${entry.id}`);
        rig.finished.push(entry.id);
      } finally {
        inFlight--;
      }
    },
    onProgress: (progress) => {
      rig.progress.push([
        progress.running,
        progress.done,
        progress.total,
        progress.failed,
        progress.current?.id ?? null,
      ]);
      rig.runningAtProgress.push(rig.queue.isRunning());
      rig.onProgressExtra(progress);
    },
    onItemError: (entry, error) => {
      rig.itemErrors.push({ id: entry.id, message: (error as Error).message });
    },
    onWorkerError: (error) => {
      rig.workerErrors.push((error as Error).message);
    },
    onRunStart: () => {
      rig.runStarts++;
    },
  });

  return rig;
};

const idle = (rig: Rig): Promise<void> =>
  waitUntil(() => !rig.queue.isRunning(), 'que la cola quede parada');

let rig: Rig;

beforeEach(() => {
  rig = makeRig();
});

// ── SERIE ─────────────────────────────────────────────────────────────────

describe('la serie', () => {
  it('atiende en el orden en que se encolaron y nunca tiene dos en vuelo a la vez', async () => {
    // FIFO estricto con uno en vuelo: es lo que evita las ráfagas contra IGDB
    // (4 req/s) y contra la Steam Web API, que es justo el motivo por el que
    // estas tres colas existen en vez de un Promise.all.
    rig.hold(1);
    rig.hold(2);
    rig.hold(3);
    rig.queue.enqueue([item(1), item(2), item(3)]);

    // El primero entra solo; los otros dos esperan turno de verdad, no en
    // paralelo con él.
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');
    await sleep(20);
    assert.deepEqual(rig.started, [1]);

    rig.release(1);
    await waitUntil(() => rig.started.length === 2, 'el segundo en vuelo');
    assert.deepEqual(rig.started, [1, 2]);

    rig.release(2);
    await waitUntil(() => rig.started.length === 3, 'el tercero en vuelo');
    rig.release(3);
    await idle(rig);

    assert.deepEqual(rig.started, [1, 2, 3]);
    assert.deepEqual(rig.finished, [1, 2, 3]);
    assert.equal(rig.maxInFlight, 1);
  });

  it('encolar con la cola en marcha se suma al final de la fila sin arrancar un segundo worker', async () => {
    // Dos workers vivos serían dos elementos en vuelo: la reserva ya no
    // protegería nada y el progreso contaría dos rachas mezcladas.
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');

    rig.queue.enqueue([item(3)]);
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.started, [1, 2, 3]);
    assert.equal(rig.maxInFlight, 1);
    assert.equal(rig.runStarts, 1);
  });

  it('la cola se declara en marcha en cuanto se encola, sin esperar a que arranque nada', async () => {
    // enqueue devuelve enseguida pero isRunning() ya tiene que decir la
    // verdad: Ajustes pinta el botón de "stop" con esto, y un false de un
    // tick habría dejado el botón muerto justo al pulsar "Generate".
    rig.hold(1);
    rig.queue.enqueue([item(1)]);
    assert.equal(rig.queue.isRunning(), true);
    rig.release(1);
    await idle(rig);
    assert.equal(rig.queue.isRunning(), false);
  });
});

// ── RESERVA ───────────────────────────────────────────────────────────────

describe('la reserva', () => {
  it('el mismo elemento pedido dos veces mientras espera turno se procesa una sola vez', async () => {
    // El caso real: la pasada de Ajustes ve "pendiente" a un juego que ya está
    // encolado porque su marca no se escribe hasta que termina. Sin reserva se
    // pagaba dos veces la misma generación.
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');

    rig.queue.enqueue([item(2), item(2)]);
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.started, [1, 2]);
  });

  it('el mismo elemento pedido otra vez mientras está EN VUELO tampoco se re-encola', async () => {
    // La ventana peligrosa: ya no está en la fila (se hizo shift) pero aún no
    // ha terminado. Si la reserva se soltara al sacarlo de la fila en vez de
    // al acabarlo, este sería el duplicado que se cuela.
    rig.hold(1);
    rig.queue.enqueue([item(1)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');

    rig.queue.enqueue([item(1)]);
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.started, [1]);
  });

  it('al terminar se suelta la reserva: el mismo elemento puede volver a pasar en otra racha', async () => {
    // Los logros NO son "una vez en la vida" (steam/queue.ts): un juego vuelve
    // a pasar cada vez que lo cierras. Una reserva que no se soltase dejaría
    // sus desbloqueos congelados para siempre.
    rig.queue.enqueue([item(1)]);
    await idle(rig);
    rig.queue.enqueue([item(1)]);
    await idle(rig);

    assert.deepEqual(rig.started, [1, 1]);
    assert.equal(rig.runStarts, 2);
  });

  it('un elemento que falla también suelta su reserva y puede reintentarse', async () => {
    // Si el fallo se quedara la reserva, "reintentar los fallidos" de Ajustes
    // sería un botón que no hace nada hasta reiniciar la app.
    rig.failOn(1);
    rig.queue.enqueue([item(1)]);
    await idle(rig);
    assert.deepEqual(rig.itemErrors, [{ id: 1, message: 'boom 1' }]);
    assert.deepEqual(rig.finished, []);

    rig.healOn(1);
    rig.queue.enqueue([item(1)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 1]);
    assert.deepEqual(rig.finished, [1]);
  });

  it('con la clave repetida se descarta el SEGUNDO elemento entero, no solo la clave', async () => {
    // La cicatriz que obligó a steam/queue.ts a llevar su propio mapa de
    // `intents`: la reserva es por clave y tira el elemento COMPLETO, así que
    // ganaba siempre el primero que llegó. Si el segundo traía notify=true
    // (acabas de cerrar el juego) y el primero venía de la pasada masiva que
    // no avisa, los logros se guardaban bien pero sin tarjeta flotante.
    rig.queue.enqueue([item(1, 'de la pasada masiva'), item(1, 'CON AVISO')]);
    await idle(rig);

    assert.deepEqual(rig.startedLabels, ['de la pasada masiva']);
  });

  it('la reserva va por clave y no por identidad: dos objetos distintos con la misma clave son uno', async () => {
    // memories reserva por scope (`month:2026-04`), no por id de fila: dos
    // peticiones del mismo mes llegadas por caminos distintos (la detección
    // automática y el backfill manual) son objetos diferentes y tienen que
    // colapsar en una sola generación.
    const byScope = makeRig({ keyOf: (entry) => `month:${entry.label}` });
    byScope.queue.enqueue([item(10, '2026-04'), item(20, '2026-04'), item(30, '2026-05')]);
    await idle(byScope);

    assert.deepEqual(byScope.startedLabels, ['2026-04', '2026-05']);
    assert.deepEqual(byScope.started, [10, 30]);
  });
});

// ── PROGRESO ──────────────────────────────────────────────────────────────

describe('el progreso', () => {
  it('emite uno al empezar cada elemento y uno final al acabar la racha', async () => {
    rig.queue.enqueue([item(1), item(2)]);
    await idle(rig);

    assert.deepEqual(rig.progress, [
      [true, 0, 2, 0, 1],
      [true, 1, 2, 0, 2],
      [false, 2, 2, 0, null],
    ]);
  });

  it('el total cuenta lo hecho, lo que espera y lo que está en vuelo — nunca dos veces lo mismo', async () => {
    // total = processed + queue.length + (current ? 1 : 0). El elemento en
    // vuelo ya salió de la fila y todavía no cuenta como hecho: si se olvidara
    // ese +1, el total bajaría a mitad de racha y la barra de Ajustes daría un
    // salto hacia atrás.
    rig.hold(2);
    rig.queue.enqueue([item(1), item(2), item(3)]);
    await waitUntil(() => rig.started.length === 2, 'el segundo en vuelo');

    const enVuelo = rig.progress.at(-1);
    // 1 hecho + 1 esperando + 1 en vuelo = 3, y ni uno más.
    assert.deepEqual(enVuelo, [true, 1, 3, 0, 2]);

    rig.release(2);
    await idle(rig);
    assert.deepEqual(rig.progress.at(-1), [false, 3, 3, 0, null]);
  });

  it('lo que entra a mitad de racha hace crecer el total sin reiniciar lo ya hecho', async () => {
    rig.hold(1);
    rig.queue.enqueue([item(1)]);
    await waitUntil(() => rig.progress.length === 1, 'el primer progreso');
    assert.deepEqual(rig.progress.at(-1), [true, 0, 1, 0, 1]);

    rig.queue.enqueue([item(2)]);
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.progress, [
      [true, 0, 1, 0, 1],
      [true, 1, 2, 0, 2],
      [false, 2, 2, 0, null],
    ]);
  });

  it('un duplicado ignorado no hincha el total', async () => {
    // Si el total contase lo PEDIDO en vez de lo reservado, la barra se
    // quedaría en "2 de 3" para siempre esperando a un tercero que la reserva
    // ya había descartado.
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');

    rig.queue.enqueue([item(1), item(2)]);
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.progress.at(-1), [false, 2, 2, 0, null]);
  });

  it('cuando llega el progreso final la cola ya se declara parada, y encolar desde ahí arranca racha nueva', async () => {
    // Orden delicado dentro del finally: worker = null ANTES de emitir el
    // último progreso. Quien escuche running=false y encole en respuesta tiene
    // que poder arrancar; si el nulo se pusiera después, ese encolado se
    // quedaría con el elemento reservado y sin worker que lo atienda — perdido
    // hasta reiniciar la app, que es el varado que el worker muerto de más
    // abajo llegó a tener de verdad hasta que se le puso su limpieza.
    const corriendoEnElAvisoFinal: boolean[] = [];
    let yaReencolado = false;
    rig.onProgressExtra = (progress) => {
      if (progress.running) return;
      corriendoEnElAvisoFinal.push(rig.queue.isRunning());
      if (yaReencolado) return;
      yaReencolado = true;
      rig.queue.enqueue([item(2)]);
    };

    rig.queue.enqueue([item(1)]);
    await waitUntil(() => rig.started.length === 2, 'la racha encadenada');
    await idle(rig);

    assert.deepEqual(rig.started, [1, 2]);
    assert.deepEqual(corriendoEnElAvisoFinal, [false, false]);
    assert.equal(rig.runStarts, 2);
  });

  it('ningún progreso sale reentrante desde enqueue, y el running del evento coincide con isRunning()', async () => {
    // ARREGLADO. drain() corre en síncrono hasta su primer await (process()),
    // así que llamarlo directamente desde enqueue emitía el primer onProgress
    // de la racha DENTRO de esa misma llamada y antes de que `worker` se
    // asignara: el oyente recibía running=true y, si preguntaba, isRunning()
    // le contestaba false — el evento y la cola diciendo lo contrario.
    //
    // Importaba porque enqueueAchievements/enqueueCuriosities reentraban en el
    // notificador antes de devolver, y cualquier oyente que consultase
    // isXQueueRunning() al recibir ese primer evento leía el revés. Ahora el
    // arranque se cede un tick (Promise.resolve().then(drain)) y el primer
    // aviso ya sale con la cola asignada.
    const dentroDeEnqueue: boolean[] = [];
    let enqueueEnCurso = false;
    rig.onProgressExtra = () => dentroDeEnqueue.push(enqueueEnCurso);

    enqueueEnCurso = true;
    rig.queue.enqueue([item(1), item(2)]);
    enqueueEnCurso = false;
    // Ni progreso ni trabajo dentro de la llamada: enqueue devuelve y punto.
    assert.deepEqual(dentroDeEnqueue, []);
    assert.deepEqual(rig.started, []);
    // Pero la cola ya se declara en marcha, que es lo que pinta Ajustes.
    assert.equal(rig.queue.isRunning(), true);

    await idle(rig);
    // Los tres avisos, y en los tres isRunning() dice lo mismo que el evento.
    assert.deepEqual(rig.runningAtProgress, [true, true, false]);
    assert.deepEqual(dentroDeEnqueue, [false, false, false]);
    assert.deepEqual(
      rig.progress.map((row) => row[0]),
      [true, true, false],
    );
  });
});

// ── FALLOS ────────────────────────────────────────────────────────────────

describe('los fallos', () => {
  it('un elemento que falla suma en failed, avisa por onItemError y no tumba a los que van detrás', async () => {
    rig.failOn(1);
    rig.queue.enqueue([item(1), item(2), item(3)]);
    await idle(rig);

    assert.deepEqual(rig.started, [1, 2, 3]);
    assert.deepEqual(rig.finished, [2, 3]);
    assert.deepEqual(rig.itemErrors, [{ id: 1, message: 'boom 1' }]);
    assert.deepEqual(rig.progress.at(-1), [false, 3, 3, 0 + 1, null]);
    // Fallar no aborta la racha ni la convierte en error de worker.
    assert.deepEqual(rig.workerErrors, []);
  });

  it('el que falla cuenta como procesado: done llega al total igual', async () => {
    // done es "atendidos", no "logrados". Si un fallo no incrementase
    // processed, la barra nunca cerraría y el aviso final diría 2 de 3.
    rig.failOn(2);
    rig.queue.enqueue([item(1), item(2)]);
    await idle(rig);

    assert.deepEqual(rig.progress.at(-1), [false, 2, 2, 1, null]);
  });
});

// ── STOP ──────────────────────────────────────────────────────────────────

describe('el stop', () => {
  it('"para después de este" no corta el elemento en vuelo y suelta el resto', async () => {
    // AFTERPLAY-LOOP.md §3.6: un backfill histórico es largo y pararlo a mitad
    // no debe tirar lo ya pagado — el periodo en vuelo se termina y se guarda.
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2), item(3)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');

    rig.queue.requestStop();
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.started, [1]);
    assert.deepEqual(rig.finished, [1]);
    // El total final solo cuenta lo que llegó a atenderse: lo soltado
    // desaparece de la cuenta en vez de quedarse como pendiente eterno.
    assert.deepEqual(rig.progress.at(-1), [false, 1, 1, 0, null]);
  });

  it('lo soltado por el stop queda sin reservar: se reencola y corre', async () => {
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');
    rig.queue.requestStop();
    rig.release(1);
    await idle(rig);

    rig.queue.enqueue([item(2)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 2]);
  });

  it('el stop no se arma para la racha siguiente: tras parar, la próxima corre entera', async () => {
    // La divergencia que motivó la unificación era justo esta (dónde se
    // reseteaba el flag): una cola se quedaba con el stop puesto y la racha
    // siguiente moría en el primer elemento sin que nadie hubiera pulsado nada.
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');
    rig.queue.requestStop();
    rig.release(1);
    await idle(rig);

    rig.queue.enqueue([item(3), item(4), item(5)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 3, 4, 5]);
  });

  it('pedir parar con la cola quieta es un no-op y no contamina lo que venga después', async () => {
    rig.queue.requestStop();
    rig.queue.enqueue([item(1), item(2)]);
    await idle(rig);

    assert.deepEqual(rig.started, [1, 2]);
  });

  it('lo que se encola DESPUÉS de pedir parar se suelta con el resto', async () => {
    // Documentado en steam/queue.ts: enqueueAchievements promete de más
    // cuando el usuario ya ha pedido parar, porque la cola no expone su stop.
    // El error cae del lado bueno, pero es comportamiento real y conviene
    // fijarlo: encolar durante un stop en curso NO rearma la racha.
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');

    rig.queue.requestStop();
    rig.queue.enqueue([item(3)]);
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.started, [1]);
    // Pero tampoco se queda reservado: el 3 vuelve a entrar en la racha siguiente.
    rig.queue.enqueue([item(3)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 3]);
  });
});

// ── PUERTA (canRun) ───────────────────────────────────────────────────────

describe('la puerta', () => {
  it('con la puerta cerrada encolar es un no-op y no deja nada reservado', async () => {
    // Sin clave de API no se encola nada, pero tampoco se puede "quemar" el
    // elemento: en cuanto la clave vuelve en Ajustes, el mismo elemento tiene
    // que poder pasar.
    rig.closeGate();
    rig.queue.enqueue([item(1)]);
    assert.equal(rig.queue.isRunning(), false);
    await sleep(20);
    assert.deepEqual(rig.started, []);
    assert.deepEqual(rig.progress, []);
    assert.equal(rig.runStarts, 0);

    rig.openGate();
    rig.queue.enqueue([item(1)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1]);
  });

  it('se comprueba antes de CADA elemento: si se cierra a mitad, lo pendiente se suelta con sus reservas', async () => {
    // La clave se borra en Ajustes con la racha corriendo. El elemento en
    // vuelo termina (ya está pagado); el resto se suelta libre para que otra
    // pasada lo recoja limpio cuando vuelva a haber clave.
    rig.hold(1);
    rig.queue.enqueue([item(1), item(2), item(3)]);
    await waitUntil(() => rig.started.length === 1, 'el primero en vuelo');

    rig.closeGate();
    rig.release(1);
    await idle(rig);

    assert.deepEqual(rig.started, [1]);
    assert.deepEqual(rig.finished, [1]);
    assert.deepEqual(rig.progress.at(-1), [false, 1, 1, 0, null]);

    rig.openGate();
    rig.queue.enqueue([item(2), item(3)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 2, 3]);
  });
});

// ── RACHAS ────────────────────────────────────────────────────────────────

describe('las rachas', () => {
  it('una racha nueva arranca con los contadores a cero', async () => {
    rig.failOn(1);
    rig.queue.enqueue([item(1)]);
    await idle(rig);
    assert.deepEqual(rig.progress.at(-1), [false, 1, 1, 1, null]);

    rig.progress.length = 0;
    rig.queue.enqueue([item(2)]);
    await idle(rig);

    // Ni el done ni el failed de la racha anterior se arrastran.
    assert.deepEqual(rig.progress, [
      [true, 0, 1, 0, 2],
      [false, 1, 1, 0, null],
    ]);
  });

  it('onRunStart avisa una vez por racha y solo cuando de verdad se encoló algo', async () => {
    // memories tira su foto de hechos en onRunStart. Un aviso de más a mitad
    // de racha la recargaría entera por cada encolado (recorre la historia
    // completa); uno de menos narraría los meses con hechos de ayer.
    rig.queue.enqueue([]);
    assert.equal(rig.runStarts, 0);
    assert.equal(rig.queue.isRunning(), false);

    rig.hold(1);
    rig.queue.enqueue([item(1)]);
    assert.equal(rig.runStarts, 1);

    // Encolar con la racha viva no reabre racha, ni siquiera con elementos nuevos.
    rig.queue.enqueue([item(2)]);
    rig.queue.enqueue([item(1)]);
    assert.equal(rig.runStarts, 1);

    rig.release(1);
    await idle(rig);

    rig.queue.enqueue([item(3)]);
    await idle(rig);
    assert.equal(rig.runStarts, 2);
  });
});

// ── RESPIRO ───────────────────────────────────────────────────────────────

describe('el respiro entre elementos', () => {
  it('respira entre elementos pero no después del último', async () => {
    // steam pone 120 ms entre juegos para soltar la DB y que el ciclo de sync
    // con Turso tenga turno. El "solo si queda cola por delante" no es un
    // detalle: sin él, cada pasada de un solo juego —el refresco al cerrar,
    // que es el caso más frecuente— pagaría el respiro entero para nada.
    const conRespiro = makeRig({ breatheMs: 400 });
    conRespiro.queue.enqueue([item(1), item(2)]);

    await waitUntil(() => conRespiro.finished.length === 1, 'el primero terminado');
    await sleep(40);
    // Sigue respirando: el segundo aún no ha entrado.
    assert.deepEqual(conRespiro.started, [1]);
    assert.equal(conRespiro.queue.isRunning(), true);

    await waitUntil(() => conRespiro.finished.length === 2, 'el segundo terminado');
    await sleep(40);
    // Tras el último no hay respiro que esperar: la racha cierra ya.
    assert.equal(conRespiro.queue.isRunning(), false);
    assert.deepEqual(conRespiro.progress.at(-1), [false, 2, 2, 0, null]);
  });
});

// ── EL WORKER MUERTO ──────────────────────────────────────────────────────

describe('cuando revienta el propio worker', () => {
  it('suelta la fila y sus reservas al morir: lo pendiente se puede reencolar y corre', async () => {
    // El try por elemento cubre process(). Lo que corre FUERA de él —canRun(),
    // onProgress(), keyOf()— tumba al worker entero, y el módulo lo sabe: para
    // eso existe onWorkerError ("no debería pasar, pero si pasa la cola no
    // puede morir en silencio").
    //
    // ARREGLADO: morir sin silencio no bastaba, porque el catch/finally avisaba
    // y limpiaba el worker pero dejaba la fila dentro y RESERVADA. Reencolar
    // esos elementos era un no-op (seguían reservados, así que `added` quedaba
    // en false y ni siquiera arrancaba worker) y quedaban varados hasta
    // reiniciar la app; resucitaban de tapadillo en la racha de cualquier otro
    // elemento, mezclados en su cuenta; y el progreso final prometía un total
    // que nunca se alcanzaba (una barra de Ajustes que no cierra). Ahora la
    // muerte suelta lo pendiente igual que la puerta o el stop: se pierde la
    // racha, no los elementos.
    let consultas = 0;
    rig.setGate(() => {
      consultas++;
      // 1ª al encolar, 2ª antes del elemento 1, 3ª antes del elemento 2.
      if (consultas === 3) throw new Error('la puerta explotó');
      return true;
    });

    rig.queue.enqueue([item(1), item(2), item(3)]);
    await idle(rig);

    assert.deepEqual(rig.started, [1]);
    assert.deepEqual(rig.workerErrors, ['la puerta explotó']);
    // La racha cierra por lo que de verdad se atendió: 1 de 1, sin prometer los
    // dos que se soltaron. La barra llega al final en vez de quedarse a medias.
    assert.deepEqual(rig.progress.at(-1), [false, 1, 1, 0, null]);

    // Con la puerta sana otra vez, los soltados vuelven a entrar por su propio
    // pie: su reserva se liberó al morir el worker.
    rig.setGate(() => true);
    rig.queue.enqueue([item(2), item(3)]);
    assert.equal(rig.queue.isRunning(), true);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 2, 3]);
    assert.deepEqual(rig.finished, [1, 2, 3]);
    // Racha limpia y completa, sin arrastrar nada de la muerta.
    assert.deepEqual(rig.progress.at(-1), [false, 2, 2, 0, null]);

    // Y ya no quedan fantasmas: un elemento nuevo arranca su racha a solas.
    rig.queue.enqueue([item(4)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 2, 3, 4]);
    assert.deepEqual(rig.progress.at(-1), [false, 1, 1, 0, null]);
  });

  it('también suelta al que estaba en vuelo cuando el que revienta es el notificador', async () => {
    // El borde contrario del anterior: aquí la muerte llega DESPUÉS de sacar el
    // elemento de la fila y marcarlo como current, en el propio onProgress, con
    // process() todavía sin llamar. Ese elemento no está ni en la fila (ya se
    // hizo shift) ni hecho, así que la limpieza tiene que soltarlo igual —si no,
    // sería el único que quedaría reservado para siempre. Por eso la limpieza
    // de la muerte barre el Set entero y pone current a null en vez de recorrer
    // la fila: keyOf() es una de las tres cosas que pueden haber matado al
    // worker y no se le puede volver a llamar para limpiar.
    let explota = true;
    rig.onProgressExtra = () => {
      // Solo el primero: el aviso final de la racha muerta tiene que poder
      // salir, o el finally rompería con una promesa rechazada suelta.
      if (!explota) return;
      explota = false;
      throw new Error('el notificador explotó');
    };

    rig.queue.enqueue([item(1), item(2)]);
    await idle(rig);

    // Nunca llegó a procesarse nada: la muerte fue antes de process().
    assert.deepEqual(rig.started, []);
    assert.deepEqual(rig.workerErrors, ['el notificador explotó']);
    assert.deepEqual(rig.progress.at(-1), [false, 0, 0, 0, null]);

    // Los dos vuelven a pasar: ni el de la fila ni el que estaba en vuelo se
    // quedaron con la reserva puesta.
    rig.queue.enqueue([item(1), item(2)]);
    await idle(rig);
    assert.deepEqual(rig.started, [1, 2]);
    assert.deepEqual(rig.finished, [1, 2]);
    assert.deepEqual(rig.workerErrors, ['el notificador explotó']);
  });
});
