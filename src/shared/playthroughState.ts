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

// A qué momento del calendario se atribuyen unas horas que nadie midió. Las
// horas manuales no tienen fecha propia — son un número suelto en la
// iteración —, así que se cuelgan del log de estados de su playthrough: su
// fin si terminó, y si no su principio.
//
// El fin manda sobre el principio a propósito: "me pasé Elden Ring en 2023"
// coloca las 90 horas en 2023 aunque el playthrough arrancara en 2022, que es
// como lo cuenta uno mismo. Devuelve null si el playthrough no tiene ninguna
// fecha — entonces esas horas solo pueden contar en All Time.
//
// Genérico sobre la forma de los eventos porque cada lado trae la suya
// (StateEventCandidate en el main, StateEventSummary en el renderer) y lo
// único que importa aquí son el tipo y la fecha.
export const manualHoursAnchor = <T extends { type: StateEventType; occurredAt: Date }>(
  events: readonly T[],
): Date | null => {
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
  return firstStart;
};
