import { CalendarRange, Clock3, Gamepad2, Route } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  EventDatePrecision,
  GameListItem,
  SessionWithGame,
  StateEventSummary,
} from '../../../../shared/types';
import { latestRealStateEvent, manualHoursAnchor } from '../../../../shared/playthroughState';
import { useImageSrc } from '../../hooks/useImageSrc';
import { formatHours } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { revealClass, revealStyle } from '../../lib/styles';
import { BLUE, GREEN } from '../../lib/colors';

// La otra vista de Stats: no cifras, sino el recorrido. Una línea temporal de
// años y meses con las carátulas de lo que jugaste en cada uno.
//
// La decisión que lo explica casi todo: la unidad NO es el juego, es el
// PLAYTHROUGH. Pasarte Hollow Knight tres veces son tres entradas en tres
// momentos distintos de tu vida, no una carátula repetida — que es justo lo
// que un historial debería enseñar. De ahí que se recorran las iteraciones y
// no los juegos.
//
// Y cada entrada se coloca por su fecha de FIN (lastAt), no de inicio: un
// playthrough que empezaste en diciembre y acabaste en marzo se recuerda como
// "el de marzo", que es cuando lo dejaste.

// Las dos cifras del panel flotante (horas y sesiones), teñidas de su color.
const JourneyStatTile = ({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}): React.JSX.Element => (
  <div
    className="flex-1 rounded-[9px] border px-2.5 py-2"
    style={{ borderColor: `${color}2e`, background: `${color}0f` }}
  >
    <div className="text-[9.5px] font-bold tracking-[.11em]" style={{ color: `${color}c4` }}>
      {label}
    </div>
    <div className="mt-0.5 text-[14px] font-extrabold tabular-nums" style={{ color }}>
      {value}
    </div>
  </div>
);

type JourneyProps = {
  games: GameListItem[];
  sessions: SessionWithGame[];
  stateEvents: StateEventSummary[];
  onOpenGame: (gameId: number) => void;
};

type JourneySession = Pick<
  SessionWithGame,
  'id' | 'startedAt' | 'durationSec' | 'datePrecision' | 'note'
>;

// Una carátula de la línea temporal, ya cocinada: todo lo que hace falta para
// pintarla y para su panel flotante, sin volver a mirar los datos crudos.
type JourneyEntry = {
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

// Sin año: se usa dentro del panel flotante, donde el año ya se ha dicho
// arriba en el rango completo y repetirlo solo mete ruido.
const shortDate = (date: Date, precision: EventDatePrecision): string => {
  if (precision === 'year') return String(date.getFullYear());
  if (precision === 'month') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// El titular del panel: "Mar 3, 2024 - Apr 18, 2024". Con año SIEMPRE (aquí
// sí, es la primera vez que se dice), y colapsado a una sola fecha cuando los
// dos extremos caen igual — un playthrough de una tarde no debe leerse como
// "3 de marzo - 3 de marzo".
const dateRange = (entry: JourneyEntry): string => {
  const formatJourneyDate = (date: Date, precision: EventDatePrecision): string => {
    if (precision === 'year') return String(date.getFullYear());
    if (precision === 'month') {
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };
  const first = formatJourneyDate(entry.firstAt, entry.firstPrecision);
  const last = formatJourneyDate(entry.lastAt, entry.lastPrecision);
  return first === last ? first : `${first} - ${last}`;
};

const monthLabel = (month: number): string =>
  new Date(2020, month, 1).toLocaleDateString('en-US', { month: 'long' }).toUpperCase();

const monthShortLabel = (month: number): string =>
  new Date(2020, month, 1).toLocaleDateString('en-US', { month: 'short' });

// La chapita "2"/"3" de la esquina de la carátula, para las rejugadas. El
// número sale de la etiqueta ("Playthrough 2") y el 1 se calla a propósito:
// marcar la primera vuelta no dice nada, y lo que importa señalar es
// justamente que esa no lo es.
const iterationBadge = (label: string): string | null => {
  const number = /\d+/.exec(label)?.[0];
  return number && number !== '1' ? number : null;
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
const buildEntries = (
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

// El rastro de puntitos del panel: una bolita por sesión sobre una línea, con
// su fecha y duración en el title. Cuenta de un vistazo si el playthrough fue
// una sentada larga o goteo de meses.
const SessionTrail = ({ entry }: { entry: JourneyEntry }): React.JSX.Element => {
  if (entry.sessions.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="h-px flex-1 bg-white/[0.08]" />
        Manually logged playthrough
        <span className="h-px flex-1 bg-white/[0.08]" />
      </div>
    );
  }

  const first = entry.sessions[0].startedAt.getTime();
  const last = entry.sessions.at(-1)?.startedAt.getTime() ?? first;
  const span = Math.max(1, last - first);
  // Las bolitas van en su sitio REAL del tramo (dos tardes seguidas salen
  // pegadas, un regreso seis meses después sale al otro extremo). Pero si
  // todas caen en el mismo instante — sesiones de un solo día, o manuales con
  // precisión de mes — se repartirían todas encima de la misma, así que ahí
  // se pasa a espaciarlas por igual: se pierde la escala temporal, que en ese
  // caso no dice nada, y se gana poder contarlas.

  return (
    <div className="mt-3">
      <div className="relative h-3">
        <div className="absolute top-1.25 right-0 left-0 h-px bg-white/[0.1]" />
        {entry.sessions.map((session, index) => {
          const temporalPosition = ((session.startedAt.getTime() - first) / span) * 100;
          const evenPosition =
            entry.sessions.length === 1 ? 50 : (index / (entry.sessions.length - 1)) * 100;
          const left = first === last ? evenPosition : temporalPosition;
          return (
            <span
              key={session.id}
              title={`${shortDate(session.startedAt, session.datePrecision)} · ${formatHours(
                (session.durationSec ?? 0) / 3600,
              )}`}
              className="absolute top-0.25 h-2.25 w-2.25 -translate-x-1/2 rounded-full border-2 border-[#171918]"
              style={{ left: `${left}%`, background: GREEN }}
            />
          );
        })}
      </div>
      <div className="mt-0.5 flex justify-between text-[9.5px] font-semibold text-muted-foreground">
        <span>{shortDate(entry.firstAt, entry.firstPrecision)}</span>
        <span>{shortDate(entry.lastAt, entry.lastPrecision)}</span>
      </div>
    </div>
  );
};

// La ficha flotante al pasar el ratón por una carátula: banner, fechas, las
// dos cifras, el rastro de sesiones y la última nota.
//
// Va por portal a document.body y no dentro del botón porque la rejilla de
// meses recorta y apila (overflow + z-index), y ahí dentro el panel salía
// cortado por el mes de al lado.
const HoverPanel = ({
  entry,
  anchor,
}: {
  entry: JourneyEntry;
  anchor: DOMRect;
}): React.JSX.Element => {
  const heroSrc = useImageSrc(entry.heroUrl, 'heroes');
  const status = entry.state ? getGameStatusMeta(entry.state) : null;
  // Medidas a mano en vez de medir el panel ya montado: se necesitan ANTES de
  // pintarlo para decidir dónde ponerlo, y medir después significaría pintar
  // en un sitio y saltar al otro.
  const panelWidth = 360;
  const panelHeight = 310;
  const gap = 12;
  // Centrado sobre la carátula, pero sin salirse por ninguno de los dos lados
  // — las carátulas de los bordes de la rejilla lo empujarían fuera.
  const left = Math.min(
    window.innerWidth - panelWidth / 2 - 14,
    Math.max(panelWidth / 2 + 14, anchor.left + anchor.width / 2),
  );
  // Debajo por defecto; arriba solo si abajo no cabe Y arriba hay más sitio.
  const spaceAbove = anchor.top - gap;
  const spaceBelow = window.innerHeight - anchor.bottom - gap;
  const showAbove = spaceBelow < panelHeight && spaceAbove > spaceBelow;

  return createPortal(
    <div
      className="pointer-events-none fixed z-100 w-90"
      style={{
        left,
        top: showAbove ? anchor.top - gap : anchor.bottom + gap,
        transform: showAbove ? 'translate(-50%, -100%)' : 'translateX(-50%)',
      }}
    >
      <div
        className={`overflow-hidden rounded-[12px] border border-white/14 bg-[#171918] shadow-[0_22px_65px_rgba(0,0,0,.68)] animate-in fade-in-0 zoom-in-95 duration-250 ${
          showAbove ? 'origin-bottom' : 'origin-top'
        }`}
      >
        <div className="relative h-26 overflow-hidden">
          {heroSrc ? (
            <img src={heroSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-white/[0.025]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,12,11,.18),rgba(23,25,24,.98))]" />
          <div className="absolute right-4 bottom-3 left-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[17px] font-extrabold text-foreground">
                  {entry.title}
                </div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">
                  {entry.iterationLabel}
                </div>
              </div>
              {status && (
                <div
                  className="flex flex-none items-center gap-1.25 text-[10px] font-extrabold uppercase"
                  style={{ color: status.color }}
                >
                  <status.Icon size={11} fill={status.filled ? status.color : 'none'} />
                  {status.label}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 pb-3.5">
          <div className="py-3">
            <div className="text-[8.5px] font-extrabold tracking-[.14em] text-muted-foreground/60">
              {entry.kind === 'endless' ? 'ACTIVITY DATES' : 'PLAYTHROUGH DATES'}
            </div>
            <div className="mt-1.25 flex items-center gap-2.25">
              <CalendarRange size={16} strokeWidth={2} style={{ color: BLUE }} />
              <span className="text-[14.5px] font-extrabold text-foreground tabular-nums">
                {dateRange(entry)}
              </span>
            </div>
          </div>

          <div className="flex gap-1.5">
            <JourneyStatTile color={GREEN} label="PLAYED" value={formatHours(entry.hours)} />
            <JourneyStatTile color={BLUE} label="SESSIONS" value={String(entry.sessions.length)} />
          </div>

          <SessionTrail entry={entry} />

          {entry.note && (
            <div className="mt-2.5 line-clamp-2 border-t border-white/[0.07] pt-2 text-[11px] leading-relaxed italic text-muted-foreground">
              “{entry.note}”
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

// Una carátula de la rejilla. El panel se abre con ratón Y con teclado
// (focus/blur además de enter/leave): navegando a tabuladores la ficha tiene
// que salir igual, si no la información solo existe para quien usa ratón.
const JourneyCover = ({
  entry,
  onOpen,
}: {
  entry: JourneyEntry;
  onOpen: () => void;
}): React.JSX.Element => {
  const coverSrc = useImageSrc(entry.coverUrl, 'covers');
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const status = entry.state ? getGameStatusMeta(entry.state) : null;
  const accent = status?.color ?? BLUE;
  const badge = iterationBadge(entry.iterationLabel);

  return (
    <button
      type="button"
      aria-label={`Open ${entry.title}, ${entry.iterationLabel}`}
      onClick={onOpen}
      onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
      onFocus={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      onBlur={() => setAnchor(null)}
      className="group/cover relative h-37 w-26 flex-none cursor-pointer transition-[transform,filter,opacity] duration-250 ease-[cubic-bezier(.16,1,.3,1)] hover:z-5 hover:-translate-y-1.5 hover:scale-[1.045] focus-visible:z-5 focus-visible:-translate-y-1.5 focus-visible:scale-[1.045] focus-visible:outline-none"
    >
      <div
        className="absolute inset-0 overflow-hidden rounded-[9px] border bg-card shadow-[0_5px_16px_rgba(0,0,0,.26)] transition-[border-color,box-shadow] duration-250 group-hover/cover:shadow-[0_12px_28px_rgba(0,0,0,.48)]"
        style={{ borderColor: 'var(--border)' }}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            loading="lazy"
            alt=""
            className="h-full w-full object-cover brightness-90 transition-[filter] duration-250 group-hover/cover:brightness-105"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-muted px-1.5 text-center">
            <Gamepad2 size={18} className="text-muted-foreground/35" />
            <span className="line-clamp-3 text-[8px] font-semibold text-muted-foreground">
              {entry.title}
            </span>
          </div>
        )}
        <div className="absolute right-0 bottom-0 left-0 h-0.75" style={{ background: accent }} />
      </div>

      {badge && (
        <span className="absolute -top-1.25 -right-1.25 flex h-4 min-w-4 items-center justify-center rounded-full border border-white/15 bg-[#171918] px-1 text-[8.5px] font-extrabold text-foreground shadow-md">
          {badge}
        </span>
      )}

      {anchor && <HoverPanel entry={entry} anchor={anchor} />}
    </button>
  );
};

// La pantalla: línea temporal a la izquierda, índice de años y meses pegado a
// la derecha. El índice se sincroniza con el scroll en los dos sentidos —
// bajando se ilumina solo, y pulsando un año salta hasta él.
export const Journey = ({
  games,
  sessions,
  stateEvents,
  onOpenGame,
}: JourneyProps): React.JSX.Element => {
  const topRef = useRef<HTMLDivElement>(null);
  // Los nodos del DOM de cada año y cada mes, para poder hacerles scroll y
  // para observarlos. En refs y no en estado: cambiarlos no repinta nada.
  const yearRefs = useRef(new Map<number, HTMLElement>());
  const monthRefs = useRef(new Map<string, HTMLElement>());
  // El candado del scroll programático (ver los dos observers de abajo).
  const navigationTargetRef = useRef<{ year: number; month?: string } | null>(null);
  const navigationUnlockTimerRef = useRef<number | null>(null);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const entries = useMemo(
    () => buildEntries(games, sessions, stateEvents),
    [games, sessions, stateEvents],
  );
  // Entradas agrupadas en año -> mes -> carátulas, todo de nuevo a viejo.
  const byYear = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const grouped = new Map<number, Map<number, JourneyEntry[]>>();
    for (const entry of entries) {
      const year = entry.lastAt.getFullYear();
      const month = entry.lastAt.getMonth();
      const months = grouped.get(year) ?? new Map<number, JourneyEntry[]>();
      months.set(month, [...(months.get(month) ?? []), entry]);
      grouped.set(year, months);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => b - a)
      .flatMap(([year, months]) => {
        // Del año en curso solo se enseñan los meses que YA han pasado: la
        // línea temporal es un historial, y dejar diciembre en blanco
        // esperando parece que falta algo. (Un mes futuro puede tener
        // entradas: una fecha del pasado mal tecleada.)
        const availableMonths = [...months.keys()].filter(
          (month) => year !== currentYear || month <= currentMonth,
        );
        if (availableMonths.length === 0) return [];
        return [
          {
            year,
            months: availableMonths
              .sort((a, b) => b - a)
              .map((month) => [month, months.get(month) ?? []] as const),
          },
        ];
      });
  }, [entries]);

  // Scroll-spy del año: ilumina en el índice el año que se está mirando.
  //
  // El rootMargin recorta la ventana a una banda estrecha por arriba (72px de
  // cabecera fuera, 62% de abajo fuera) en vez de usarla entera: si no, con
  // tres años a la vez en pantalla los tres cuentan como visibles y el
  // resaltado se vuelve loco. Así "el que estás mirando" es el que cruza la
  // franja de arriba, que es donde de verdad mira uno al leer.
  //
  // EL CANDADO (navigationTargetRef): al pulsar un año del índice se hace
  // scroll suave, y durante ese viaje el observer ve pasar todos los años
  // intermedios y los iría iluminando uno a uno. Mientras hay destino fijado
  // se ignora todo lo que informe el observer, y solo se suelta cuando el
  // destino aparece de verdad en pantalla (o cuando salta el temporizador de
  // seguridad, por si el scroll se queda a medias — ver los onClick del
  // índice).
  useEffect(() => {
    const visibleYears = new Set<number>();
    const observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          const year = Number((entry.target as HTMLElement).dataset.year);
          if (entry.isIntersecting) visibleYears.add(year);
          else visibleYears.delete(year);
        }
        const navigationTarget = navigationTargetRef.current;
        if (navigationTarget) {
          if (navigationTarget.month === undefined && visibleYears.has(navigationTarget.year)) {
            navigationTargetRef.current = null;
            if (navigationUnlockTimerRef.current !== null) {
              window.clearTimeout(navigationUnlockTimerRef.current);
              navigationUnlockTimerRef.current = null;
            }
            setActiveYear(navigationTarget.year);
          }
          return;
        }
        // El PRIMERO de byYear que esté visible, no el último que avisó: así
        // con dos años en la banda gana siempre el más reciente, que es el
        // orden en que se leen.
        const visibleYear = byYear.find(({ year }) => visibleYears.has(year))?.year;
        if (visibleYear !== undefined) setActiveYear(visibleYear);
      },
      { rootMargin: '-72px 0px -62% 0px' },
    );
    for (const element of yearRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [byYear]);

  // Lo resaltado no es directamente el estado: al arrancar todavía no hubo
  // scroll (activeYear null) y, si cambian los datos, el año guardado puede
  // haber dejado de existir. En los dos casos se cae al más reciente, para
  // que el índice nunca aparezca sin nada iluminado. Igual con el mes, que
  // además tiene que pertenecer al año resaltado — si no, se vería marcado un
  // mes de otro año.
  const highlightedYear = byYear.some(({ year }) => year === activeYear)
    ? activeYear
    : (byYear[0]?.year ?? null);
  const highlightedYearData = byYear.find(({ year }) => year === highlightedYear);
  const highlightedMonth =
    activeMonth?.startsWith(`${highlightedYear}-`) === true
      ? activeMonth
      : highlightedYearData
        ? `${highlightedYearData.year}-${highlightedYearData.months[0]?.[0]}`
        : null;

  // El mismo scroll-spy pero para el mes, con su banda algo más estrecha
  // (-72%): los meses son bloques más bajos que los años y con la del año
  // entraban varios a la vez. Va aparte y no dentro del observer de arriba
  // porque solo se observan los meses del año DESPLEGADO, que cambian cada
  // vez que cambia el año resaltado.
  useEffect(() => {
    const visibleMonths = new Set<string>();
    const observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          const key = (entry.target as HTMLElement).dataset.monthKey;
          if (!key) continue;
          if (entry.isIntersecting) visibleMonths.add(key);
          else visibleMonths.delete(key);
        }
        const navigationTarget = navigationTargetRef.current;
        if (navigationTarget) {
          if (navigationTarget.month && visibleMonths.has(navigationTarget.month)) {
            navigationTargetRef.current = null;
            if (navigationUnlockTimerRef.current !== null) {
              window.clearTimeout(navigationUnlockTimerRef.current);
              navigationUnlockTimerRef.current = null;
            }
            setActiveYear(navigationTarget.year);
            setActiveMonth(navigationTarget.month);
          }
          return;
        }
        const visibleMonth = byYear
          .flatMap(({ year, months }) => months.map(([month]) => `${year}-${month}`))
          .find((key) => visibleMonths.has(key));
        if (visibleMonth) setActiveMonth(visibleMonth);
      },
      { rootMargin: '-72px 0px -72% 0px' },
    );
    for (const element of monthRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [byYear]);
  // La tira de resumen de arriba. gamesTouched cuenta JUEGOS distintos y no
  // entradas: tres vueltas a Hollow Knight son tres carátulas en el viaje,
  // pero un solo juego jugado.
  const totalHours = entries.reduce((sum, entry) => sum + entry.hours, 0);
  const totalSessions = entries.reduce((sum, entry) => sum + entry.sessions.length, 0);
  const gamesTouched = new Set(entries.map((entry) => entry.gameId)).size;

  if (entries.length === 0) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center text-center">
        <div className="flex h-13 w-13 items-center justify-center rounded-full bg-white/[0.04]">
          <Route size={23} strokeWidth={1.5} className="text-muted-foreground/45" />
        </div>
        <div className="mt-3 text-sm font-semibold text-foreground">Your journey starts here</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Played and logged games will become part of it.
        </div>
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-6">
      <div className={`mb-7 flex items-center gap-4 ${revealClass}`} style={revealStyle(0)}>
        <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
          <Gamepad2 size={13} color={BLUE} />
          <span>
            <strong className="font-extrabold text-foreground tabular-nums">{gamesTouched}</strong>{' '}
            games played
          </span>
        </div>
        <span className="h-3 w-px bg-border" />
        <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
          <Clock3 size={13} color={GREEN} />
          <span>
            <strong className="font-extrabold text-foreground tabular-nums">
              {formatHours(totalHours)}
            </strong>{' '}
            played
          </span>
        </div>
        <span className="h-3 w-px bg-border" />
        <span className="text-[12px] font-semibold text-muted-foreground">
          <strong className="font-extrabold text-foreground tabular-nums">{totalSessions}</strong>{' '}
          sessions
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-10">
        <div className="flex min-w-0 flex-col gap-4">
          {byYear.map(({ year, months }, yearIndex) => (
            <section
              key={year}
              data-year={year}
              ref={(element) => {
                if (element) yearRefs.current.set(year, element);
                else yearRefs.current.delete(year);
              }}
              className="scroll-mt-6"
            >
              <div className="mb-3 flex items-center gap-3">
                <span className="text-xl font-extrabold text-foreground tabular-nums">{year}</span>
                <span className="h-px flex-1 bg-border/75" />
              </div>
              {months.map(([month, monthEntries], monthIndex) => (
                <div
                  key={month}
                  data-month-key={`${year}-${month}`}
                  ref={(element) => {
                    const key = `${year}-${month}`;
                    if (element) monthRefs.current.set(key, element);
                    else monthRefs.current.delete(key);
                  }}
                  className={`group/month grid grid-cols-[5.5rem_1fr] gap-x-4 ${revealClass}`}
                  style={revealStyle(yearIndex + monthIndex + 1)}
                >
                  <div className="relative border-r border-border/80 pr-4 text-right">
                    <div className="sticky top-3 pt-1 text-[10px] font-extrabold tracking-[.14em] text-muted-foreground transition-colors duration-200 group-hover/month:text-foreground">
                      {monthLabel(month)}
                    </div>
                    <span className="absolute top-2 -right-1 h-2 w-2 rounded-full border-2 border-[#0d0f0e] bg-white/20 transition-[background,box-shadow] duration-200 group-hover/month:bg-primary group-hover/month:shadow-[0_0_10px_rgba(47,220,126,.45)]" />
                  </div>

                  {/* min-h fija un alto mínimo por mes: sin él, un mes con
                      una sola carátula y otro con doce daban un ritmo
                      irregular al bajar. Con suelo, el recorrido respira
                      parejo y se nota mejor cuánto tuvo cada mes. */}
                  <div className="min-h-45 pb-7">
                    <div className="mb-2.5 flex items-center gap-2">
                      <span className="h-px flex-1 bg-border/55 transition-colors duration-200 group-hover/month:bg-white/[0.11]" />
                      {monthEntries.length > 0 && (
                        <span className="text-[9.5px] font-bold text-muted-foreground/55 tabular-nums">
                          {monthEntries.length}{' '}
                          {monthEntries.length === 1 ? 'playthrough' : 'playthroughs'}
                        </span>
                      )}
                    </div>
                    {/* Al señalar una carátula, las demás del mes se apagan:
                        con el panel flotante abierto encima, lo de alrededor
                        estorba. En CSS puro (has-*) y no con estado de React
                        — mover el ratón por una rejilla de carátulas no debe
                        repintar el árbol. */}
                    <div className="flex flex-wrap gap-3 transition-opacity duration-200 has-[button:hover]:[&>button:not(:hover)]:opacity-45 has-[button:focus-visible]:[&>button:not(:focus-visible)]:opacity-45">
                      {monthEntries.map((entry) => (
                        <JourneyCover
                          key={entry.key}
                          entry={entry}
                          onOpen={() => onOpenGame(entry.gameId)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>

        {/* El índice. Solo despliega los meses del año resaltado: con diez
            años abiertos a la vez la columna se convertía en una lista de
            120 entradas y dejaba de servir para orientarse. */}
        <nav aria-label="Journey date navigation" className="sticky top-5 py-1">
          <div className="mb-3 pl-4 text-[8.5px] font-extrabold tracking-[.16em] text-muted-foreground/50">
            JOURNEY
          </div>
          <div className="relative flex flex-col gap-1 border-l border-border/70 pl-4">
            {byYear.map(({ year, months }) => {
              const active = highlightedYear === year;
              return (
                <div key={year}>
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => {
                      // Se fija el destino ANTES de mover el scroll: a partir
                      // de aquí el observer calla hasta llegar (ver el
                      // candado arriba). El temporizador es la red de
                      // seguridad — si el destino nunca llega a la banda (un
                      // año al final del todo que no alcanza a subir), a los
                      // 1,2 s se suelta el candado igualmente en vez de
                      // dejar el resaltado congelado para siempre.
                      navigationTargetRef.current = { year };
                      if (navigationUnlockTimerRef.current !== null) {
                        window.clearTimeout(navigationUnlockTimerRef.current);
                      }
                      navigationUnlockTimerRef.current = window.setTimeout(() => {
                        navigationTargetRef.current = null;
                        navigationUnlockTimerRef.current = null;
                      }, 1_200);
                      setActiveYear(year);
                      setActiveMonth(`${year}-${months[0]?.[0]}`);
                      yearRefs.current.get(year)?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      });
                    }}
                    className="group/year relative w-full py-1.25 text-left text-[12px] font-extrabold tabular-nums transition-colors duration-150"
                    style={{ color: active ? BLUE : 'var(--muted-foreground)' }}
                  >
                    <span
                      className="absolute top-1/2 -left-[1.19rem] h-2.25 w-2.25 -translate-y-1/2 rounded-full border-2 border-[#0d0f0e] transition-[background,box-shadow,transform] duration-150 group-hover/year:scale-125"
                      style={{
                        background: active ? BLUE : 'var(--muted-foreground)',
                        boxShadow: active ? `0 0 10px ${BLUE}80` : 'none',
                      }}
                    />
                    {year}
                  </button>

                  {active && (
                    <div className="mb-2 flex flex-col border-l border-white/[0.07] pl-2">
                      {months.map(([month, monthEntries]) => {
                        const key = `${year}-${month}`;
                        const monthActive = highlightedMonth === key;
                        return (
                          <button
                            key={month}
                            type="button"
                            aria-current={monthActive ? 'true' : undefined}
                            onClick={() => {
                              navigationTargetRef.current = { year, month: key };
                              if (navigationUnlockTimerRef.current !== null) {
                                window.clearTimeout(navigationUnlockTimerRef.current);
                              }
                              navigationUnlockTimerRef.current = window.setTimeout(() => {
                                navigationTargetRef.current = null;
                                navigationUnlockTimerRef.current = null;
                              }, 1_200);
                              setActiveYear(year);
                              setActiveMonth(key);
                              monthRefs.current.get(key)?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'start',
                              });
                            }}
                            className="flex items-center justify-between gap-2 py-1 text-left text-[10px] font-semibold transition-colors duration-150"
                            style={{
                              color: monthActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                            }}
                          >
                            <span>{monthShortLabel(month)}</span>
                            {monthEntries.length > 0 && (
                              <span className="text-[8.5px] text-muted-foreground/45 tabular-nums">
                                {monthEntries.length}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
};
