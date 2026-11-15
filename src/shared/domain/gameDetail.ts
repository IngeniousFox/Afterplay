import type { EntityId, EntityIdLike, IterationId, StateEventId } from '../entityIds';
import { latestRealStateEvent, leavesEndDate } from '../playthroughState';
import type { StateEvent } from '../types';
import { compareRowsByCreation } from './creationOrder';
import { resolveIterationHours, trackedSecondsOf } from './hours';
import { costPerHourOf, splitSpendByPlaythrough, totalSpendOf } from './spend';

// LA FICHA DE UN JUEGO: el sitio donde el log de eventos se convierte en las
// fechas, el estado y las horas que enseña la app (SPEC 4.4). Nada de eso está
// almacenado. Escrita UNA vez (AFTERPLAY-2.0.md §15.2, F-26).
//
// Estaba dos veces: getGameById.ts en el escritorio y worker/src/queries/
// game.ts, que se describía a sí mismo como "puerto". Los comentarios del
// puerto documentaban tres divergencias ya ocurridas (el cierre de la ventana
// de gasto, su borde '<=' y el '!isManual' del inicio); la cuarta era "en
// vivo". Ahora los dos traen sus filas y llaman aquí; lo que queda en cada
// lado es la forma de la respuesta (Date en el IPC, epoch en el JSON).
//
// Genérica sobre las filas: cada lado trae su SELECT con más columnas de las
// que la regla necesita, y las recibe de vuelta tal cual (las sesiones del
// playthrough, los eventos borde) para pintarlas.

type StateType = StateEvent['type'];

// Las filas son genéricas también en la representación del id (ver
// entityIds.ts): la ficha se deriva igual con los enteros del esquema 1.x que
// con el texto del 2.0, porque todo lo que hace con un id es agrupar por él y
// desempatar con compareByCreation.
//
// `syncCreated` (2.0, F-09) es el orden de creación entre dispositivos; opcional
// porque la 1.x y el Worker ordenan por id (ver domain/creationOrder.ts).
export type DetailIterationRow<Id extends EntityIdLike = EntityId> = {
  id: IterationId<Id>;
  syncCreated?: string | null;
  manualTotalPlayed: number | null;
};

export type DetailSessionRow<Id extends EntityIdLike = EntityId> = {
  iterationId: IterationId<Id> | null;
  isManual: boolean;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
};

export type DetailStateEventRow<Id extends EntityIdLike = EntityId> = {
  id: StateEventId<Id>;
  syncCreated?: string | null;
  iterationId: IterationId<Id>;
  type: StateType;
  occurredAt: Date;
  datePrecision: unknown;
};

export type DetailSpendRow = { amount: number; occurredAt: Date };

export type IterationEdge<E extends DetailStateEventRow<EntityIdLike>> = Pick<
  E,
  'id' | 'occurredAt' | 'datePrecision'
>;

export type DerivedIteration<
  I extends DetailIterationRow<EntityIdLike>,
  S extends DetailSessionRow<EntityIdLike>,
  E extends DetailStateEventRow<EntityIdLike>,
> = {
  iteration: I;
  hours: number;
  // Inicio: lo más temprano entre la primera sesión MEDIDA y el primer
  // 'started'. Fin: el último evento que deja fecha de salida, SOLO si el
  // playthrough sigue en ese estado ahora.
  startedAt: Date | null;
  endedAt: Date | null;
  startEvent: IterationEdge<E> | null;
  endEvent: IterationEdge<E> | null;
  startedBySession: boolean;
  currentState: StateType | null;
  sessions: S[];
  spend: number;
};

export type DerivedGameDetail<
  I extends DetailIterationRow<EntityIdLike>,
  S extends DetailSessionRow<EntityIdLike>,
  E extends DetailStateEventRow<EntityIdLike>,
> = {
  iterations: DerivedIteration<I, S, E>[];
  totalHours: number;
  totalSpend: number;
  costPerHour: number | null;
  currentState: StateType | null;
  isLive: boolean;
  // El arranque de la sesión en marcha (la más reciente si hubiera varias),
  // o null si no hay ninguna.
  liveSince: Date | null;
  // El PRIMER 'plan_to_play' por id (el orden de escritura, no la fecha
  // tecleada): cuándo entró en el Plan por primera vez.
  firstPlanEvent: E | null;
};

const edgeOf = <E extends DetailStateEventRow<EntityIdLike>>(event: E): IterationEdge<E> =>
  ({
    id: event.id,
    occurredAt: event.occurredAt,
    datePrecision: event.datePrecision,
  }) as IterationEdge<E>;

// El 'started' más temprano por fecha y, a igual fecha, por creación. Es lo que
// devolvía el `find` sobre el log ordenado por (occurredAt, id) asc de los dos
// SELECTs; escrito explícito para que la regla no dependa de su ORDER BY.
const firstStartedEvent = <E extends DetailStateEventRow<EntityIdLike>>(
  events: readonly E[],
): E | null => {
  let first: E | null = null;
  for (const event of events) {
    if (event.type !== 'started') continue;
    if (
      first === null ||
      event.occurredAt.getTime() < first.occurredAt.getTime() ||
      (event.occurredAt.getTime() === first.occurredAt.getTime() &&
        compareRowsByCreation(event, first) < 0)
    ) {
      first = event;
    }
  }
  return first;
};

// El arranque de la primera sesión MEDIDA. El '!isManual' no es cosmético:
// una sesión manual es un bloque de horas TECLEADO (filas heredadas del modelo
// v1), no algo que el watcher viera pasar. Sin el filtro, una de esas filas de
// 2020 arrastraba el inicio hasta su fecha gruesa y ponía
// startedBySession=true — que es justo la señal con la que el Edit bloquea la
// fecha "porque una medición no se falsea" y con la que el móvil pinta un
// instante exacto que nadie midió. Mismo criterio que Stats y
// shared/memory/moments.ts.
const firstMeasuredSessionAt = (
  sessions: readonly DetailSessionRow<EntityIdLike>[],
): Date | null => {
  let earliest: Date | null = null;
  for (const session of sessions) {
    if (session.isManual) continue;
    if (earliest === null || session.startedAt.getTime() < earliest.getTime()) {
      earliest = session.startedAt;
    }
  }
  return earliest;
};

const groupBy = <T, K>(rows: readonly T[], keyOf: (row: T) => K | null): Map<K, T[]> => {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    // iterationId nullable en las sesiones (las de emulador pendientes de
    // asignar): no son de ningún playthrough y no entran en ninguno.
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
};

// `isRunning` decide si una sesión ABIERTA (endedAt null) sigue de verdad en
// marcha. Por defecto, toda abierta lo está: es la regla del escritorio, donde
// el watcher barre en cada ciclo las de cronómetro rancias
// (sweepStaleTimerSessions) antes de que nadie lea. El Worker no tiene a nadie
// que barra mientras el PC está apagado, así que pasa la regla de frescura del
// cronómetro (isSessionLive, sobre shared/timerFreshness): la MISMA vara que el
// barrido del PC, aplicada en la lectura.
export const deriveGameDetail = <
  Id extends EntityIdLike,
  I extends DetailIterationRow<Id>,
  S extends DetailSessionRow<Id>,
  E extends DetailStateEventRow<Id>,
>(input: {
  // La intersección con la fila mínima es para que TypeScript INFIERA `Id` de
  // los argumentos (de una restricción no lo infiere) y así rechace mezclar
  // filas de ids de texto con filas de ids numéricos en la misma llamada.
  iterations: readonly (I & DetailIterationRow<Id>)[];
  sessions: readonly (S & DetailSessionRow<Id>)[];
  stateEvents: readonly (E & DetailStateEventRow<Id>)[];
  spendEvents: readonly DetailSpendRow[];
  isRunning?: (session: S) => boolean;
}): DerivedGameDetail<I, S, E> => {
  const { sessions, stateEvents, spendEvents } = input;
  // En orden de creación (`syncCreated`, y el id de desempate o si falta): el
  // reparto del gasto recorre los playthroughs en ese orden y la ficha los
  // enseña igual. Los dos SELECTs ya lo piden.
  const iterations = [...input.iterations].sort(compareRowsByCreation);

  const sessionsByIteration = groupBy(sessions, (session) => session.iterationId);
  const eventsByIteration = groupBy(stateEvents, (event) => event.iterationId);
  const spendByIteration = splitSpendByPlaythrough(iterations, eventsByIteration, spendEvents);

  const derived = iterations.map((iteration): DerivedIteration<I, S, E> => {
    const iterationSessions = sessionsByIteration.get(iteration.id) ?? [];
    const iterationEvents = eventsByIteration.get(iteration.id) ?? [];
    // Ignorando 'plan_to_play': es solo historial, nunca el estado real — un
    // juego promovido desde el Plan como Unplayed debe salir null.
    const latestEvent = latestRealStateEvent(iterationEvents);

    const startEvent = firstStartedEvent(iterationEvents);
    const firstSessionAt = firstMeasuredSessionAt(iterationSessions);
    const startedBySession =
      firstSessionAt !== null &&
      (startEvent === null || firstSessionAt.getTime() < startEvent.occurredAt.getTime());
    // Fin: solo si el playthrough ESTÁ ahora en un estado que deja fecha de
    // salida — uno reabierto no tiene fin aunque arrastre un completed antiguo.
    const endEvent = latestEvent && leavesEndDate(latestEvent.type) ? latestEvent : null;

    return {
      iteration,
      hours: resolveIterationHours(
        iteration.manualTotalPlayed,
        trackedSecondsOf(iterationSessions),
      ),
      startedAt: startedBySession ? firstSessionAt : (startEvent?.occurredAt ?? null),
      endedAt: endEvent?.occurredAt ?? null,
      startEvent: startEvent ? edgeOf(startEvent) : null,
      endEvent: endEvent ? edgeOf(endEvent) : null,
      startedBySession,
      currentState: latestEvent?.type ?? null,
      sessions: iterationSessions,
      spend: spendByIteration.get(iteration.id) ?? 0,
    };
  });

  const totalHours = derived.reduce((sum, iteration) => sum + iteration.hours, 0);
  const totalSpend = totalSpendOf(spendEvents);

  // "En vivo" y desde cuándo: entre las abiertas que siguen en marcha, gana el
  // arranque MÁS RECIENTE — el mismo criterio que la biblioteca (library.ts).
  // La base no impide dos filas abiertas del mismo juego (una que nadie cerró
  // más otra después), y la que de verdad está en marcha es la última.
  const isRunning = input.isRunning ?? (() => true);
  let liveSince: Date | null = null;
  for (const session of sessions) {
    if (session.endedAt !== null || !isRunning(session)) continue;
    if (liveSince === null || session.startedAt.getTime() > liveSince.getTime()) {
      liveSince = session.startedAt;
    }
  }

  let firstPlanEvent: E | null = null;
  for (const event of stateEvents) {
    if (event.type !== 'plan_to_play') continue;
    if (firstPlanEvent === null || compareRowsByCreation(event, firstPlanEvent) < 0)
      firstPlanEvent = event;
  }

  return {
    iterations: derived,
    totalHours,
    totalSpend,
    costPerHour: costPerHourOf(totalSpend, totalHours),
    // Mismo filtro de 'plan_to_play' que por iteración.
    currentState: latestRealStateEvent(stateEvents)?.type ?? null,
    isLive: liveSince !== null,
    liveSince,
    firstPlanEvent,
  };
};
