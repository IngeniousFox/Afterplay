// Cómo se lee el log de estados de un playthrough: qué significa cada tipo de
// evento y cómo se deriva de ellos el estado actual. Vive en shared porque las
// mismas reglas hacen falta a los dos lados — el main al escribir y derivar, el
// renderer al pintar el Journey y el historial — y tenerlas por duplicado ya
// había dejado versiones que no coincidían.

import type { StateEvent } from './types';

type StateEventType = StateEvent['type'];

// SPEC 4.5 — "estado terminal" NO significa lo mismo en los tres sitios donde
// hace falta, y por eso hay tres conjuntos y no uno. Estaban repetidos a mano
// (`type === 'completed' || type === 'dropped' || ...`) en main y en renderer,
// con el riesgo obvio: tocar uno y olvidarse de los otros dos.
//
// La diferencia entre ellos es a qué pregunta responden:
//
//   ¿se acabó ESTE playthrough?        -> ENDS_PLAYTHROUGH    (completed, dropped)
//   ¿deja una fecha de "salida"?       -> LEAVES_END_DATE     (+ on_hold)
//   ¿hay que cerrar la sesión abierta? -> CLOSES_OPEN_SESSION (+ resting)
//
// Van de menos a más inclusivo, pero NO los derivo unos de otros: que hoy
// sean subconjuntos es una casualidad del enum, no una regla. Escribirlos
// enteros deja que cada uno cambie sin arrastrar a los demás.

// El playthrough se cerró para siempre: volver a jugar abre uno NUEVO, no
// reanuda este. On Hold y Resting quedan fuera a propósito — son pausas, y
// retomarlas es seguir el mismo playthrough.
//
// Lo usan `resolveIterationForPlay` (¿playthrough nuevo o reanudar?) y la
// ventana de reparto del gasto entre playthroughs.
const ENDS_PLAYTHROUGH = new Set<StateEventType>(['completed', 'dropped']);

// El playthrough deja una fecha de "Finished / left". On Hold entra porque
// aparcar algo también es una fecha de salida que enseñar, aunque el
// playthrough siga vivo y se pueda retomar.
//
// Lo usan la fecha de fin derivada de getGameById, la atribución de año de
// las horas manuales y el Journey.
const LEAVES_END_DATE = new Set<StateEventType>(['completed', 'dropped', 'on_hold']);

// Registrar este estado tiene que cerrar la sesión que estuviera abierta. Es
// el más amplio de los tres: aquí sí entra Resting, porque un endless que
// pasa a descansar tampoco se sigue jugando. Si no se cerrara, sus horas se
// quedarían sin contar hasta que el watcher detectara el cierre real.
const CLOSES_OPEN_SESSION = new Set<StateEventType>(['completed', 'dropped', 'on_hold', 'resting']);

// Aceptan null/undefined a propósito: "sin eventos" es un estado real de la
// app (Unplayed) y así los sitios que trabajan con `currentState` — que es
// nullable — no tienen que repetir la guarda.
export const endsPlaythrough = (type: StateEventType | null | undefined): boolean =>
  type != null && ENDS_PLAYTHROUGH.has(type);

export const leavesEndDate = (type: StateEventType | null | undefined): boolean =>
  type != null && LEAVES_END_DATE.has(type);

export const closesOpenSession = (type: StateEventType | null | undefined): boolean =>
  type != null && CLOSES_OPEN_SESSION.has(type);

// Forma mínima que hace falta para decidir "el más reciente": type para poder
// ignorar 'plan_to_play' (solo historial, nunca estado real — ver schema.ts),
// occurredAt para comparar fechas, e id para desempatar cuando dos eventos
// comparten fecha exacta (gana el insertado después). Genérico a propósito —
// getGames, getGameById, resolveIterationForPlay y el Journey traen cada uno
// su propia forma de fila con estos tres campos pegados.
export type RealStateEventCandidate = {
  type: string;
  occurredAt: Date;
  id: number;
};

// El "último estado real" de un juego/iteración: el evento con occurredAt más
// reciente ignorando 'plan_to_play', con empate resuelto por id más alto.
// Funciona igual reciba las filas ordenadas o no — recorre todo el array y se
// queda con la mejor candidata vista hasta el momento, así que no depende de
// ningún ORDER BY previo.
export const latestRealStateEvent = <T extends RealStateEventCandidate>(
  events: readonly T[],
): T | undefined => {
  let latest: T | undefined;

  for (const event of events) {
    if (event.type === 'plan_to_play') continue;

    if (!latest) {
      latest = event;
      continue;
    }

    const isNewer = event.occurredAt.getTime() > latest.occurredAt.getTime();
    const isSameDateButHigherId =
      event.occurredAt.getTime() === latest.occurredAt.getTime() && event.id > latest.id;

    if (isNewer || isSameDateButHigherId) {
      latest = event;
    }
  }

  return latest;
};

// Dar de alta un juego escribe su estado inicial en la MISMA transacción que
// la fila del juego (writeInitialPlaythrough), así que ese primer evento no
// dice cuándo lo jugaste: dice cuándo lo metiste. Se reconoce porque su fecha
// cae pegada al `addedAt` — y no por comparación exacta, porque son dos
// escrituras distintas de la misma transacción y caen con unos milisegundos de
// diferencia. Una fecha tecleada por ti nunca aterriza ahí: se guarda a
// medianoche de ese día, a horas de distancia del alta.
//
// La regla vive aquí porque la necesitan los dos lados y tenerla por duplicado
// ya se pagó: getGames la usa para que el respaldo de "Last played" no
// convierta el orden de la biblioteca en "los últimos que añadí" disfrazado de
// "los últimos que jugué" (medido en la BD real: 6 juegos de 331, y los seis
// salían arriba del todo), y el Journey del renderer para que un juego que no
// has tocado nunca no aparezca como hito del mes en que lo metiste.
//
// LOS CUATRO CONSUMIDORES LLAMAN AQUÍ, y eso hubo que arreglarlo: durante un
// tiempo este comentario decía que el Journey usaba la función compartida
// cuando en realidad reimplementaba el 5_000 en línea, y con él el filtro del
// Loop (shared/memory/chapters.ts) y la biblioteca del móvil
// (worker/src/queries/library.ts). Cuatro copias del mismo número que hoy
// coincidían y que nada obligaba a seguir coincidiendo: mover el margen en un
// sitio hacía que el mismo juego fuese hito del mes en una pantalla y no en la
// otra. Si aparece una quinta copia, que sea porque alguien la escribió a
// mano contra este comentario.
//
// La tolerancia se queda privada a propósito: el número no es un parámetro que
// nadie deba pasar, es el margen de una transacción.
const ADDED_AT_TOLERANCE_MS = 5_000;

// Sin `addedAt` no hay con qué comparar, y "no lo sé" es NO artefacto: tirar
// un evento por si acaso pierde una fecha buena, que es peor.
export const isAddedAtArtifact = (occurredAt: Date, addedAt: Date | null | undefined): boolean =>
  addedAt != null && Math.abs(occurredAt.getTime() - addedAt.getTime()) < ADDED_AT_TOLERANCE_MS;

// A qué momento del calendario se atribuyen unas horas que nadie midió. Las
// horas manuales no tienen fecha propia — son un número suelto en la
// iteración —, así que hay que colgarlas de alguna fecha del playthrough.
//
// TRES PISTAS, EN ESTE ORDEN: el FIN del playthrough si lo tuvo, su PRINCIPIO
// si sigue abierto y, como último recurso, la PRIMERA SESIÓN medida.
//
// El fin manda sobre el principio a propósito: "me pasé Elden Ring en 2023"
// coloca las 90 horas en 2023 aunque el playthrough arrancara en 2022, que es
// como lo cuenta uno mismo. Devuelve null si no hay ni log ni sesiones —
// entonces esas horas solo pueden contar en All Time.
//
// Y LAS SESIONES VAN LAS ÚLTIMAS, PERO VAN. Antes no entraban en absoluto y
// ese era el agujero más corriente que había: un juego que el watcher detectó
// solo (sesiones sí, log de estados no) al que le tecleas "ya le había echado
// 50 horas en la otra máquina" dejaba esas 50 horas SIN AÑO, o sea fuera de
// toda vista por año —Stats y la portada del móvil— aunque sus sesiones
// dijeran a gritos en qué año se estuvo jugando. El log manda mientras diga
// algo, porque es lo que contaste tú; cuando calla, lo medido es mejor dato
// que ninguno. Se toma la PRIMERA sesión por lo mismo que el 'started' manda
// cuando no hay final: sin desenlace, lo que fecha al playthrough es su
// principio.
//
// Las sesiones llegan ya como fechas de inicio sueltas y no como filas: quien
// llama tiene que agruparlas por iteración de todas formas, y así este fichero
// no depende de la forma de una sesión. No se filtran por artefacto del alta
// como los eventos — una sesión es tiempo medido de verdad, nunca papeleo.
//
// `addedAt` NO sobra aunque la función viva al lado de isAddedAtArtifact: sin
// él el papeleo del alta pasaba por fecha buena. Das de alta hoy un juego
// viejo marcándolo Beaten con 90 horas y SIN teclear fechas,
// writeInitialPlaythrough escribe el 'completed' con el occurredAt por defecto
// (= ahora), y esas 90 horas aterrizaban en el año EN CURSO de Stats — justo
// lo que el párrafo de arriba promete que no puede pasar. Es el mismo evento
// que "Last played" ya descartaba en getGames, así que la incoherencia vivía
// dentro de la misma pantalla.
//
// Opcional porque "no sé cuándo se dio de alta" tiene que seguir contestando
// lo de antes y no tirar fechas por si acaso — la misma postura que
// isAddedAtArtifact con un addedAt nulo. Quien lo tenga, que lo pase.
//
// Genérico sobre la forma de los eventos porque cada lado trae la suya
// (StateEventCandidate en el main, StateEventSummary en el renderer) y lo
// único que importa aquí son el tipo y la fecha.
export const manualHoursAnchor = <T extends { type: StateEventType; occurredAt: Date }>(
  allEvents: readonly T[],
  addedAt?: Date | null,
  sessionStarts: readonly Date[] = [],
): Date | null => {
  // Se filtra una sola vez y solo si hay con qué comparar: los dos recorridos
  // de abajo tienen que ver EXACTAMENTE el mismo log, o un artefacto colado en
  // el segundo cambiaría la respuesta cuando el primero no encuentra fin.
  const events =
    addedAt == null
      ? allEvents
      : allEvents.filter((event) => !isAddedAtArtifact(event.occurredAt, addedAt));

  let latestEnd: Date | null = null;
  for (const event of events) {
    if (!leavesEndDate(event.type)) continue;
    if (latestEnd === null || event.occurredAt.getTime() > latestEnd.getTime()) {
      latestEnd = event.occurredAt;
    }
  }
  if (latestEnd !== null) return latestEnd;

  let firstStart: Date | null = null;
  for (const event of events) {
    if (event.type !== 'started') continue;
    if (firstStart === null || event.occurredAt.getTime() < firstStart.getTime()) {
      firstStart = event.occurredAt;
    }
  }
  if (firstStart !== null) return firstStart;

  let firstSession: Date | null = null;
  for (const startedAt of sessionStarts) {
    if (firstSession === null || startedAt.getTime() < firstSession.getTime()) {
      firstSession = startedAt;
    }
  }
  return firstSession;
};
