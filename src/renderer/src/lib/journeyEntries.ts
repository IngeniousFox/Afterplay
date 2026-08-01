// Las entradas del Journey — la línea temporal de tu vida jugando — cocinadas
// desde los datos crudos de Stats. Extraído de components/stats/Journey.tsx
// porque el modo TV (tv/TvJourney.tsx, BIG-PICTURE.md §5.7) pinta ESTAS
// mismas entradas con otro traje: mismos datos, dos presentaciones.

import type {
  EventDatePrecision,
  GameListItem,
  SessionWithGame,
  StateEventSummary,
} from '../../../shared/types';
import { latestRealStateEvent, manualHoursAnchor } from '../../../shared/playthroughState';

export type JourneySession = Pick<
  SessionWithGame,
  'id' | 'startedAt' | 'durationSec' | 'datePrecision' | 'note'
>;

// Una carátula de la línea temporal, ya cocinada: todo lo que hace falta para
// pintarla y para su panel flotante, sin volver a mirar los datos crudos.
// Exportada (junto a buildEntries) porque el Journey del modo TV
// (tv/TvJourney.tsx) es OTRA presentación de estas mismas entradas — mismos
// datos, otro traje (BIG-PICTURE.md §5.7).
export type JourneyEntry = {
  key: string;
  // Los endless no tienen vueltas discretas y se trocean por mes (ver
  // buildEntries), así que una misma partida infinita puede dar varias
  // entradas. El resto son un playthrough cada una.
  kind: 'endless' | 'playthrough';
  iterationLabel: string;
  gameId: number;
  title: string;
  coverUrl: string | null;
  heroUrl: string | null;
  // Los bordes del tramo. Van con su precisión al lado porque un playthrough
  // registrado a mano puede saber solo el año ("2019"), y escribirlo como
  // "1 de enero de 2019" sería inventarse un día que nadie dijo.
  firstAt: Date;
  firstPrecision: EventDatePrecision;
  // lastAt manda: es la fecha por la que la entrada cae en un mes u otro.
  lastAt: Date;
  lastPrecision: EventDatePrecision;
  hours: number;
  sessions: JourneySession[];
  // La última nota de sesión con texto — "dónde lo dejé", la frase que
  // convierte una carátula en un recuerdo.
  note: string | null;
  state: StateEventSummary['type'] | null;
};

// Cualquier cosa fechada que demuestre que ESE tramo existió: una sesión o un
// evento del log. De juntarlas todas y ordenarlas salen firstAt y lastAt.
type ActivityPoint = {
  at: Date;
  precision: EventDatePrecision;
};

type JourneyMonthBucket = {
  at: Date;
  sessions: SessionWithGame[];
  events: StateEventSummary[];
  manualHours: number;
};

// Eventos que cuentan como "algo pasó de verdad aquí".
//
// Fuera 'plan_to_play', que es intención y no juego (ver schema.ts). Y fuera
// también lo que caiga pegado al alta del juego: al añadir uno se escribe su
// estado inicial en el mismo instante, así que ese evento no es un hito del
// viaje, es un efecto secundario de darlo de alta. Sin este filtro, cada
// juego de la biblioteca aparecía en el mes en que lo metiste aunque no lo
// hubieras tocado nunca.
//
// 5 segundos y no una comparación exacta porque el alta y el evento son dos
// escrituras distintas de la misma transacción: caen con unos milisegundos de
// diferencia, nunca con el mismo timestamp.
const meaningfulEvents = (events: StateEventSummary[], game: GameListItem): StateEventSummary[] =>
  events.filter(
    (event) =>
      event.type !== 'plan_to_play' &&
      Math.abs(event.occurredAt.getTime() - game.addedAt.getTime()) >= 5_000,
  );

// De los datos crudos de Stats a las carátulas de la línea temporal. Dos
// recorridos distintos porque hay dos clases de juego (ver más abajo): los
// endless se trocean por mes, el resto va por playthrough.
export const buildEntries = (
  games: GameListItem[],
  sessions: SessionWithGame[],
  stateEvents: StateEventSummary[],
): JourneyEntry[] => {
  const gameById = new Map(games.map((game) => [game.id, game]));
  const sessionsByIteration = new Map<number, SessionWithGame[]>();
  const eventsByIteration = new Map<number, StateEventSummary[]>();

  for (const session of sessions) {
    const list = sessionsByIteration.get(session.iterationId) ?? [];
    list.push(session);
    sessionsByIteration.set(session.iterationId, list);
  }
  for (const event of stateEvents) {
    const list = eventsByIteration.get(event.iterationId) ?? [];
    list.push(event);
    eventsByIteration.set(event.iterationId, list);
  }

  // Las tres formas que tiene un playthrough de haber existido: sesiones
  // medidas, eventos del log, o solo unas horas apuntadas a mano. Las tres
  // valen — un "me pasé esto en 2015, 60 horas" merece su carátula igual que
  // uno que trackeó la app entera.
  const iterationIds = new Set<number>([
    ...sessionsByIteration.keys(),
    ...eventsByIteration.keys(),
    ...games.flatMap((game) => game.manualIterations.map((entry) => entry.iterationId)),
  ]);
  const entries: JourneyEntry[] = [];

  // Cocina una entrada a partir de su material. Devuelve null cuando no hay
  // NADA que enseñar (ni sesiones, ni eventos, ni horas): un playthrough
  // vacío no es un recuerdo, es una fila de la base de datos.
  const makeEntry = ({
    key,
    game,
    label,
    allSessions,
    allEvents,
    manualHours,
    totalHours,
    fallbackAt,
    state,
  }: {
    key: string;
    game: GameListItem;
    label: string;
    allSessions: SessionWithGame[];
    allEvents: StateEventSummary[];
    manualHours: number;
    totalHours?: number;
    fallbackAt?: Date | null;
    state: StateEventSummary['type'] | null;
  }): JourneyEntry | null => {
    const relevantEvents = meaningfulEvents(allEvents, game);
    if (
      allSessions.length === 0 &&
      relevantEvents.length === 0 &&
      manualHours === 0 &&
      (totalHours ?? 0) === 0
    ) {
      return null;
    }

    // Sesiones y eventos revueltos y ordenados: los extremos de esa mezcla
    // son el principio y el final del tramo. Da igual de cuál de las dos
    // fuentes venga cada uno — un playthrough puede empezar por una sesión
    // que el watcher pilló y terminar por un Beaten tecleado a mano.
    const activity: ActivityPoint[] = [
      ...allSessions.map((session) => ({
        at: session.startedAt,
        precision: session.datePrecision,
      })),
      ...relevantEvents.map((event) => ({
        at: event.occurredAt,
        precision: event.datePrecision,
      })),
    ];
    // Solo horas manuales, sin una sola fecha: se cae al ancla que dé quien
    // llama y, en última instancia, al alta del juego. Precisión 'year' para
    // no fingir que se sabe el día.
    if (activity.length === 0) {
      activity.push({ at: fallbackAt ?? game.addedAt, precision: 'year' });
    }
    activity.sort((a, b) => a.at.getTime() - b.at.getTime());

    const sortedSessions = [...allSessions].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    );
    // La nota MÁS RECIENTE con texto, no la primera: "dónde lo dejé" es por
    // definición lo último que escribiste, y las sesiones sin nota se saltan
    // en vez de dejar la entrada muda.
    const note = [...sortedSessions]
      .reverse()
      .find((session) => session.note?.trim())
      ?.note?.trim();
    const trackedSeconds = allSessions.reduce(
      (sum, session) => sum + (session.durationSec ?? 0),
      0,
    );

    return {
      key,
      kind: game.endless ? 'endless' : 'playthrough',
      iterationLabel: label,
      gameId: game.id,
      title: game.title,
      coverUrl: game.coverUrl,
      heroUrl: game.heroUrl,
      firstAt: activity[0].at,
      firstPrecision: activity[0].precision,
      lastAt: activity.at(-1)?.at ?? activity[0].at,
      lastPrecision: activity.at(-1)?.precision ?? activity[0].precision,
      hours: totalHours ?? manualHours + trackedSeconds / 3600,
      sessions: sortedSessions,
      note: note ?? null,
      state,
    };
  };

  // Un endless no tiene vueltas discretas, pero sí etapas en el viaje: si se
  // jugó en marzo y octubre aparece en ambos meses. Cada entrada contiene
  // solo las sesiones y horas de ese mes; juntas vuelven a sumar exactamente
  // el total canónico del juego.
  for (const game of games.filter((candidate) => candidate.endless)) {
    const gameSessions = sessions.filter((session) => session.gameId === game.id);
    const gameEvents = meaningfulEvents(
      stateEvents.filter((event) => event.gameId === game.id),
      game,
    );
    const monthBuckets = new Map<string, JourneyMonthBucket>();
    const getMonthBucket = (at: Date): JourneyMonthBucket => {
      const key = `${at.getFullYear()}-${at.getMonth()}`;
      const bucket = monthBuckets.get(key) ?? {
        at: new Date(at.getFullYear(), at.getMonth(), 1),
        sessions: [],
        events: [],
        manualHours: 0,
      };
      monthBuckets.set(key, bucket);
      return bucket;
    };

    for (const session of gameSessions) getMonthBucket(session.startedAt).sessions.push(session);
    for (const event of gameEvents) getMonthBucket(event.occurredAt).events.push(event);

    // Las horas manuales no tienen fecha, así que se cuelgan del log de su
    // playthrough con la misma regla que usa getGames para atribuirles año
    // (manualHoursAnchor). Si el playthrough no tiene ninguna fecha caen a
    // mitad del año que Stats les asignó, y de ahí a lo último que se sepa
    // del juego — un mes cualquiera es mejor que perderlas.
    for (const manual of game.manualIterations) {
      const anchor =
        manualHoursAnchor(gameEvents.filter((event) => event.iterationId === manual.iterationId)) ??
        (manual.year === null ? null : new Date(manual.year, 6, 1)) ??
        game.lastPlayedAt ??
        game.addedAt;
      getMonthBucket(anchor).manualHours += manual.hours;
    }

    // Un endless con horas pero sin rastro fechado de dónde salieron (todo
    // manual y sin log): se le abre un mes igualmente para que no desaparezca
    // del viaje teniendo horas de verdad.
    if (monthBuckets.size === 0 && game.totalHours > 0) {
      getMonthBucket(game.lastPlayedAt ?? game.addedAt);
    }

    // El total del juego es el canónico (game.totalHours, el mismo que
    // enseñan Library y la ficha); lo repartido por meses puede quedarse
    // corto si alguna hora no tenía dónde caer. El resto se echa al mes MÁS
    // RECIENTE para que la suma de las entradas siga cuadrando con el total
    // — de ahí que los buckets vayan ordenados de nuevo a viejo.
    const sortedBuckets = [...monthBuckets.entries()].sort(
      ([, a], [, b]) => b.at.getTime() - a.at.getTime(),
    );
    const allocatedHours = sortedBuckets.reduce(
      (sum, [, bucket]) =>
        sum +
        bucket.manualHours +
        bucket.sessions.reduce((seconds, session) => seconds + (session.durationSec ?? 0), 0) /
          3600,
      0,
    );
    const unallocatedHours = Math.max(0, game.totalHours - allocatedHours);

    for (const [monthKey, bucket] of sortedBuckets) {
      const entry = makeEntry({
        key: `endless:${game.id}:${monthKey}`,
        game,
        label: 'Endless game',
        allSessions: bucket.sessions,
        allEvents: bucket.events,
        manualHours: bucket.manualHours + (bucket === sortedBuckets[0]?.[1] ? unallocatedHours : 0),
        fallbackAt: bucket.at,
        state: game.currentState,
      });
      if (entry) entries.push(entry);
    }
  }

  // El resto: una entrada por playthrough. El gameId se saca de sus propios
  // eventos o sesiones porque una iteración puede llegar aquí solo por tener
  // horas manuales, sin ninguna de las dos cosas — en ese caso no hay nada
  // que colocar y se descarta.
  for (const iterationId of iterationIds) {
    const allSessions = sessionsByIteration.get(iterationId) ?? [];
    const allEvents = eventsByIteration.get(iterationId) ?? [];
    const eventGameId = allEvents[0]?.gameId;
    const sessionGameId = allSessions[0]?.gameId;
    const gameId = eventGameId ?? sessionGameId;
    if (gameId === undefined) continue;

    const game = gameById.get(gameId);
    if (!game) continue;
    // Los endless ya salieron arriba, troceados por mes: pasarlos otra vez
    // aquí los duplicaría, una vez por mes y otra entera.
    if (game.endless) continue;
    const manual = game.manualIterations.find((entry) => entry.iterationId === iterationId);
    const entry = makeEntry({
      key: `iteration:${iterationId}`,
      game,
      label: allEvents[0]?.iterationLabel ?? 'Playthrough',
      allSessions,
      allEvents,
      manualHours: manual?.hours ?? 0,
      fallbackAt: manual?.year ? new Date(manual.year, 6, 1) : game.lastPlayedAt,
      state: latestRealStateEvent(allEvents)?.type ?? null,
    });
    if (entry) entries.push(entry);
  }

  // De lo más reciente a lo más antiguo: el viaje se lee empezando por donde
  // estás ahora y bajando hacia atrás.
  return entries.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
};
