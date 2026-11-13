// "¿En qué playthrough cae jugar a este juego en `at`?" — SPEC 4/4.5 como
// DECISIÓN PURA (AFTERPLAY-2.0 §15.2, fallos F-10 y F-26).
//
// POR QUÉ EXISTE ESTE FICHERO. La regla vivía dos veces: resolveIterationForPlay
// en el escritorio (la buena, con las cicatrices) y resolveIterationForTimer en
// el Worker, una réplica "rama a rama" escrita a mano que se había quedado
// atrás — le faltaban el hermano activo HOY con su 'started' posterior a `at`,
// el 'started' ya escrito de `at` en adelante y la rama de crear. Dos
// implementaciones de la misma pregunta contestaban distinto y nada lo
// detectaba: los tests de paridad repetían escenarios, no llamaban al código
// del otro lado.
//
// Ahora la DECISIÓN vive aquí y solo aquí. Cada lado lee sus filas, pide la
// decisión y la ejecuta con su forma de escribir (la transacción de drizzle en
// el escritorio, un `batch` de libsql en el Worker). Lo que NO hay aquí, a
// propósito: base de datos, drizzle, Electron, ni un `new Date()` — el reloj
// entra como `now` para que la misma entrada dé siempre la misma salida.
//
// Los tipos de entrada son ESTRUCTURALES y mínimos: cada lado trae sus SELECTs
// recortados, y lo único que importa es que lleven estos campos.

import { compareByCreation } from '../entityIds';
import type { IterationId, StateEventId } from '../entityIds';
import { endsPlaythrough, latestRealStateEvent } from '../playthroughState';
import type { StateEvent } from '../types';
import { nextPlaythroughLabel } from './nextPlaythroughLabel';

type StateEventType = StateEvent['type'];

// Un playthrough (fila de `iterations`) del juego. La etiqueta hace falta para
// numerar el siguiente si hay que crear uno.
export type PlaythroughRow = { id: IterationId; label: string };

// Un evento de estado de cualquiera de esos playthroughs. El id desempata dos
// eventos en el mismo instante (manda el escrito después, ver
// latestRealStateEvent) y además forma parte de la firma "cerrado al vuelo".
export type PlaythroughStateEventRow = {
  id: StateEventId;
  iterationId: IterationId;
  type: StateEventType;
  occurredAt: Date;
};

// Lo que hace falta del juego: `endless` decide la rama (un endless no tiene
// playthroughs discretos) y las plataformas, con qué nace uno nuevo. Nullable
// porque el escritorio nunca ha exigido que la fila exista para decidir: sin
// juego, nace en 'PC' y no es endless — lo mismo que hacía con `game?.…`.
export type PlaythroughGameRow = {
  endless: boolean;
  isEmulated: boolean;
  officialPlatforms: readonly string[] | null;
};

export type ResolvePlaythroughInput = {
  // En cualquier orden: la decisión ordena por id (la "última" es la de id más
  // alto, ver abajo) y no se fía de ningún ORDER BY del que llama.
  playthroughs: readonly PlaythroughRow[];
  // TODOS los eventos de esos playthroughs, también los posteriores a `at`:
  // hacen falta dos lecturas del mismo log (a fecha `at` y hoy). Los de
  // iteraciones que no estén en `playthroughs` se ignoran.
  events: readonly PlaythroughStateEventRow[];
  game: PlaythroughGameRow | null | undefined;
  // La fecha A LA QUE SE PREGUNTA: "ahora" para el watcher, el botón Play y el
  // cronómetro; la fecha real de la sesión para una asignación retroactiva.
  at: Date;
  // Cuándo se toma la decisión. Solo sirve para saber si `at` es historia (un
  // día natural anterior) — inyectable para que los tests no dependan del día.
  now: Date;
};

// Un evento que el ejecutor tiene que escribir. Ya con todos sus campos: el
// ejecutor solo añade el iterationId (que, si el playthrough es nuevo, todavía
// no existe cuando se decide).
export type PlaythroughEventToWrite = {
  type: 'started' | 'completed';
  occurredAt: Date;
  datePrecision: 'datetime';
  note: null;
};

// Los valores del playthrough nuevo, sin gameId (lo pone el ejecutor: aquí no
// hace falta para decidir).
export type NewPlaythroughValues = {
  label: string;
  playedPlatform: string;
  origin: 'Purchased';
  format: 'digital';
};

// La decisión. Tres formas y ninguna más:
//   · use    — cuelga la sesión de este playthrough y NO escribas nada.
//   · resume — cuelga la sesión de este playthrough y escríbele estos eventos
//              (hoy siempre un 'started': reanudar es reactivarlo).
//   · create — crea un playthrough con estos valores, escríbele estos eventos y
//              cuelga la sesión de él.
export type PlaythroughDecision =
  | { kind: 'use'; iterationId: IterationId }
  | { kind: 'resume'; iterationId: IterationId; events: PlaythroughEventToWrite[] }
  | { kind: 'create'; playthrough: NewPlaythroughValues; events: PlaythroughEventToWrite[] };

// El día natural LOCAL de una fecha, para preguntar "¿esto es de hoy?". Local
// y no UTC porque el usuario ve —y teclea— días locales: una sesión de las
// 23:30 es de hoy aunque en UTC ya sea mañana. (En el Worker la zona es UTC,
// pero allí `at` y `now` son el mismo instante y la pregunta no llega a
// importar.)
const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const eventAt = (type: PlaythroughEventToWrite['type'], at: Date): PlaythroughEventToWrite => ({
  type,
  // Copia y no la misma referencia: el ejecutor podría mutarla y la decisión
  // no debe compartir estado con quien la pidió.
  occurredAt: new Date(at.getTime()),
  // Precisión de instante: esto no es una fecha tecleada, es un arranque.
  datePrecision: 'datetime',
  note: null,
});

// `at` no es solo la fecha del evento: es LA FECHA A LA QUE SE PREGUNTA. El
// estado de cada playthrough se deriva de sus eventos hasta `at`, igual que
// la ventana de reparto del gasto (SPEC 4.4: "el primer playthrough que
// seguía abierto en esa fecha"). Antes la decisión se tomaba con el último
// evento de HOY, y una sesión pendiente de emulador del 20-jul asignada en
// agosto —cuando su playthrough ya estaba Beaten— abría un playthrough nuevo
// fechado en julio: un fantasma con un 'started' como último evento, o sea
// activo para siempre, y las horas de julio colgadas de quien no las jugó.
//
// Pero el log entero SIGUE mirándose, porque preguntar solo hasta `at` deja
// dos agujeros y los dos se ven en pantalla:
//   · Un hermano activo HOY con su 'started' POSTERIOR a `at` es invisible
//     para la foto de `at`. Sin la segunda comprobación (activeNow), asignar
//     una sesión retroactiva creaba un playthrough más y le metía un 'started'
//     a pelo —sin la auto-pausa de hermanos de addStateEvent— dejando DOS
//     playthroughs con 'started' como último evento, contra SPEC 4.5.
//   · Y la iteración destino puede no tener ningún evento hasta `at` y sí un
//     'started' después (jugaste al emulador el martes, el playthrough arrancó
//     el viernes): escribir otro 'started' fechado el martes no activa nada
//     que no estuviera ya activo, solo deja un "Started" de más en el Journey
//     y mueve el ancla de las horas manuales.
//
// Y `at` tampoco es siempre "ahora": si la jugada es de un DÍA ANTERIOR a
// `now` es HISTORIA, y un playthrough que nace de historia nace con su
// desenlace puesto ('completed'). Sin eso, asignar una sesión de hace un mes
// dejaba el juego en "Playing" HOY —su último evento era el 'started' fechado
// en julio— y así se quedaba hasta que alguien lo cerrase a mano. Beaten por
// defecto es decisión del dueño: un playthrough histórico tiene que nacer con
// un estado, y si en realidad lo dropeaste se edita después.
//
// El corte es el DÍA natural y no un margen en minutos: la sesión de emulador
// que asignas por la noche es la de esta tarde, y ese juego SÍ es el que estás
// jugando; la de la semana pasada ya no.
export const resolvePlaythroughForPlay = (input: ResolvePlaythroughInput): PlaythroughDecision => {
  const { at, now, game } = input;
  const atMs = at.getTime();

  // La "última" es la de id más alto y no "la última que existía en `at`": una
  // iteración recién creada por Add Game no tiene ni un evento del que sacar su
  // fecha, y es justo el destino bueno cuando no hay nada activo.
  const playthroughs = [...input.playthroughs].sort((a, b) => compareByCreation(a.id, b.id));
  const knownIds = new Set(playthroughs.map((playthrough) => playthrough.id));

  // Ordenados por fecha y, a igualdad, por id: la firma "cerrado al vuelo" de
  // abajo depende del orden ('started' primero, 'completed' después) y aquí no
  // se puede heredar del ORDER BY de nadie.
  const eventsByIteration = new Map<IterationId, PlaythroughStateEventRow[]>();
  for (const event of input.events) {
    if (!knownIds.has(event.iterationId)) continue;
    const list = eventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    eventsByIteration.set(event.iterationId, list);
  }

  // El estado A FECHA `at` (lo posterior a `at` no existe todavía para esta
  // pregunta: un 'completed' de agosto no decide dónde cae una sesión de
  // julio) — es quien elige la rama nuevo/reanudar.
  const latestTypeAt = new Map<IterationId, StateEventType>();
  // El estado HOY, con el log entero. Solo se consulta si a fecha `at` no
  // había nada activo, y está para no romper "como mucho un playthrough
  // activo por juego" con una escritura retroactiva (ver cabecera).
  const latestTypeNow = new Map<IterationId, StateEventType>();
  // Iteraciones que ya tienen un 'started' en `at` o después: para ellas el
  // evento sobra, la activación ya está escrita y con mejor fecha.
  const startedFromAt = new Set<IterationId>();
  // Los playthroughs históricos que fabricó ESTA regla: log de exactamente
  // dos eventos, 'started' y 'completed', en el MISMO instante. Es una firma
  // que una mano no produce (las fechas tecleadas caen a medianoche del día y
  // el desenlace nunca coincide al milisegundo con el arranque) y hace falta
  // para no partir un mismo tirón en N playthroughs: las sesiones pendientes
  // de emulador se asignan de varias en varias, y si cada una viera "el último
  // terminó" abriría otro Playthrough — cinco tardes de la misma partida,
  // cinco playthroughs Beaten.
  const autoClosedRuns = new Set<IterationId>();

  for (const [iterationId, unsorted] of eventsByIteration) {
    const iterationEvents = [...unsorted].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || compareByCreation(a.id, b.id),
    );

    // "El más reciente" sale del helper compartido: ignora 'plan_to_play' —
    // no es estado— y sin ese filtro un juego recién pasado del Plan a la
    // biblioteca tendría el plan como "último estado".
    const latestNow = latestRealStateEvent(iterationEvents);
    if (latestNow) latestTypeNow.set(iterationId, latestNow.type);

    const latestAt = latestRealStateEvent(
      iterationEvents.filter((event) => event.occurredAt.getTime() <= atMs),
    );
    if (latestAt) latestTypeAt.set(iterationId, latestAt.type);

    if (
      iterationEvents.some(
        (event) => event.type === 'started' && event.occurredAt.getTime() >= atMs,
      )
    ) {
      startedFromAt.add(iterationId);
    }

    const real = iterationEvents.filter((event) => event.type !== 'plan_to_play');
    if (
      real.length === 2 &&
      real[0].type === 'started' &&
      real[1].type === 'completed' &&
      real[0].occurredAt.getTime() === real[1].occurredAt.getTime()
    ) {
      autoClosedRuns.add(iterationId);
    }
  }

  // Estaba "Playing" en `at`: solo falta colgar la sesión. Y no se escribe
  // ningún 'started': ya lo había.
  const activeAt = playthroughs.find(
    (playthrough) => latestTypeAt.get(playthrough.id) === 'started',
  );
  if (activeAt) return { kind: 'use', iterationId: activeAt.id };

  // A fecha `at` no había nada activo, pero puede haberlo AHORA: un
  // playthrough reabierto después de `at`. Ese es el destino, y sin escribir
  // nada — su 'started' es posterior, así que un evento fechado en `at` no lo
  // reactivaría (ya está activo) y crear un playthrough al lado dejaría dos
  // activos a la vez. Las fechas se recolocan solas al leer (el inicio se
  // deriva como el mínimo entre la primera sesión y el primer 'started').
  const activeNow = playthroughs.find(
    (playthrough) => latestTypeNow.get(playthrough.id) === 'started',
  );
  if (activeNow) return { kind: 'use', iterationId: activeNow.id };

  const last = playthroughs[playthroughs.length - 1];
  const lastType = last ? latestTypeAt.get(last.id) : undefined;

  // ¿Se está jugando AHORA o se está registrando algo que ya pasó? Solo lo
  // segundo puede dejar el estado de hoy mintiendo (ver cabecera).
  const isPastPlay = startOfLocalDay(at) < startOfLocalDay(now);

  // El flag endless también decide la rama: un ENDLESS no tiene playthroughs
  // discretos, así que retomarlo —aunque su último evento fuera un Dropped, que
  // en un juego normal significa "el próximo es un playthrough nuevo"— es
  // SIEMPRE volver a su contenedor único. Sin esto, jugar a un endless
  // abandonado le creaba un "Playthrough 2".
  if (!last || (endsPlaythrough(lastType) && !game?.endless)) {
    // Sin iteraciones o la última terminó (Beaten/Dropped): retomar es un
    // playthrough NUEVO (SPEC 4)...

    // ...salvo que la última sea uno de los históricos que esta misma regla
    // cerró al vuelo y esto sea otra sesión vieja del mismo tirón: la segunda
    // tarde no estrena partida, se cuelga de la misma. Sin evento nuevo — el
    // playthrough ya tiene su arranque y su desenlace, y las horas van por la
    // sesión, no por el log.
    if (isPastPlay && last && autoClosedRuns.has(last.id)) {
      return { kind: 'use', iterationId: last.id };
    }

    // Nace cerrado solo si es historia Y venía de un desenlace: una segunda
    // vuelta a algo que ya te habías pasado, registrada a toro pasado, es una
    // partida terminada. Queda fuera a propósito el primer playthrough de un
    // juego que no tenía ninguno: ahí no hay ningún desenlace previo que diga
    // que su historia está cerrada, y lo más probable es que siga en marcha.
    //
    // El 'completed' va en el MISMO instante que el 'started' porque aquí no
    // se sabe cuánto duró la sesión (`at` es su arranque): la fecha honesta es
    // la de la partida, y el orden lo desempata el id (el ejecutor escribe los
    // eventos en el orden de la lista), así que el estado derivado es Beaten.
    const bornClosed = isPastPlay && endsPlaythrough(lastType);
    const events = [eventAt('started', at)];
    if (bornClosed) events.push(eventAt('completed', at));

    return {
      kind: 'create',
      playthrough: {
        label: nextPlaythroughLabel(playthroughs.map((playthrough) => playthrough.label)),
        // Emulated manda sobre la oficial (EMULADORES.md §5), y sin plataformas
        // oficiales el respaldo es 'PC': la columna es NOT NULL.
        playedPlatform: game?.isEmulated ? 'Emulated' : (game?.officialPlatforms?.[0] ?? 'PC'),
        origin: 'Purchased',
        format: 'digital',
      },
      events,
    };
  }

  // Reanudar la última iteración: un on_hold/resting, un Playthrough recién
  // creado por Add Game que nunca se tocó, o el contenedor único de un endless
  // (venga del estado que venga — ver arriba).
  //
  // Sin evento si ya traía un 'started' de `at` en adelante: el destino puede
  // no tener NINGÚN evento hasta `at` y seguir teniendo su arranque más tarde
  // (la sesión de emulador del martes, el playthrough empezado el viernes), y
  // ahí otro 'started' no activaba nada y solo ensuciaba el historial.
  if (startedFromAt.has(last.id)) return { kind: 'use', iterationId: last.id };

  // El 'started' que lo deja activo. El ejecutor lo escribe a pelo —sin la
  // auto-pausa de hermanos de addStateEvent— y eso solo es legítimo porque
  // aquí arriba ya se ha descartado que haya ninguno activo, ni a fecha `at`
  // ni hoy: no queda nadie a quien pausar.
  return { kind: 'resume', iterationId: last.id, events: [eventAt('started', at)] };
};
