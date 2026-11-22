import {
  ArrowRight,
  ChevronDown,
  Flame,
  Monitor,
  NotebookPen,
  PencilLine,
  Smartphone,
  Timer,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { IterationDetail, Session } from '../../../../../shared/types';
import { useGameAchievements } from '../../../hooks/achievements';
import { useDeviceContext } from '../../../hooks/devices';
import {
  SessionAchievements,
  type SessionAchievementEntry,
} from '../../sessions/SessionAchievements';
import { useTimeFormat } from '../../../hooks/settings';
import { useFlashLanding } from '../../../hooks/useFlashLanding';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import {
  consumeSessionFlash,
  getPendingSessionFlash,
  subscribeSessionFlash,
} from '../../../hooks/useSessionClosedToast';
import { requestAchievementFlash } from '../../../lib/achievementFlash';
import {
  formatByPrecision,
  formatElapsed,
  formatHours,
  formatTime,
  pluralize,
} from '../../../lib/format';
import { DeleteSessionDialog } from '../../sessions/DeleteSessionDialog';
import { useSessionDevice } from '../../../hooks/sessionDevice';
import { SessionNote } from '../../sessions/SessionNote';
import { celebrate } from '../../fx/sparks';
import { Stagger } from '../../fx/Stagger';
import { textLinkClass } from '../../shell/controls';
import type { AchievementId, GameId, SessionId } from '../../../../../shared/entityIds';

// LAS SESIONES DE LA FICHA (ficha-sesiones.png).
//
// En Overview, las tres más recientes en filas compactas con "See all". En la
// pestaña Sessions, todas: agrupadas por playthrough (el actual abierto, los
// anteriores plegados) y dentro por semana, la más nueva arriba, con el total
// de la semana a la izquierda. Cada fila dice día, horas, duración en Big
// Shoulders, dispositivo y sus marcas: logros de la noche (que llevan a su
// logro), "Closed automatically" si la cerró el barrido (§10.5), "Added by
// hand" si se tecleó, y la nota de la sesión debajo.

// "22m" y no "0h 22m": por debajo de la hora las horas no dicen nada.
const formatDuration = (seconds: number): string =>
  seconds < 3600 ? `${Math.round(seconds / 60)}m` : formatHours(seconds / 3600);

const sessionSeconds = (session: Session, liveSeconds: number): number =>
  session.endedAt === null ? liveSeconds : (session.durationSec ?? 0);

const dayLabel = (session: Session, timeFormat: '12h' | '24h'): string => {
  if (session.datePrecision !== 'datetime' && session.datePrecision !== 'day') {
    return formatByPrecision(session.startedAt, session.datePrecision, timeFormat);
  }
  return session.startedAt
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .replace(',', '');
};

const timeRange = (session: Session, timeFormat: '12h' | '24h'): string | null => {
  if (session.datePrecision !== 'datetime') return null;
  const start = formatTime(session.startedAt, timeFormat);
  if (session.endedAt === null) return `since ${start}`;
  return `${start} to ${formatTime(session.endedAt, timeFormat)}`;
};

// Los logros del juego, agrupados por la sesión en la que cayeron — el cruce
// ya viene hecho del main (placeUnlock); esto solo lo indexa. Los que no
// cayeron en ninguna sesión trackeada no aparecen en ninguna fila.
const useAchievementsBySession = (gameId: GameId): Map<SessionId, SessionAchievementEntry[]> => {
  const { data } = useGameAchievements(gameId);
  const bySession = new Map<SessionId, SessionAchievementEntry[]>();
  for (const entry of data?.entries ?? []) {
    if (entry.sessionId === null || entry.unlockedAt === null) continue;
    const list = bySession.get(entry.sessionId) ?? [];
    // Con el achievementId EXPLÍCITO: sin él el trofeo no enlaza a nada.
    list.push({
      achievementId: entry.id,
      displayName: entry.displayName,
      iconUrl: entry.iconUrl,
      globalPercent: entry.globalPercent,
    });
    bySession.set(entry.sessionId, list);
  }
  return bySession;
};

const DeviceLabel = ({
  session,
  tag,
}: {
  session: Session;
  tag: string | null;
}): React.JSX.Element | null => {
  const { devices } = useDeviceContext();
  if (tag === null) return null;
  const os = devices.find((device) => device.id === session.deviceId)?.os;
  const Icon = os === 'web' || session.startedBy === 'timer' ? Smartphone : Monitor;
  return (
    <span className="flex min-w-0 items-center gap-2 text-body font-semibold text-bone">
      <Icon size={14} className="flex-none text-dust" />
      <span className="[overflow-wrap:anywhere]">{tag}</span>
    </span>
  );
};

const markClass = 'flex items-center gap-1.5 text-small text-dust';

// Lo que tarda la fila en llegar a la vista al aterrizar desde el aviso de
// cierre (useFlashLanding espera 450 ms) antes de medir de dónde salen las
// chispas.
const RECORD_SPARKS_DELAY_MS = 500;

// UN RÉCORD NUEVO. La marca "Longest" ya es la señal en la UI; las chispas
// (fx/sparks) salen de ella cuando el récord es NOTICIA:
//   · la sesión estaba en marcha con la ficha abierta y, al cerrarse, es la
//     más larga, o
//   · se aterriza en ella desde el aviso de cierre de sesión y es la más larga.
// Abrir la pestaña y encontrarse un récord antiguo no celebra nada, y que una
// fila herede el récord porque se borró otra, tampoco.
const useRecordSparks = (
  isRecord: boolean,
  landing: boolean,
  isLive: boolean,
): React.RefObject<HTMLSpanElement | null> => {
  const markRef = useRef<HTMLSpanElement>(null);
  const wasLive = useRef(isLive);
  const fired = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const justClosed = wasLive.current && !isLive;
    wasLive.current = isLive;
    if (!isRecord || fired.current || !(justClosed || landing)) return;
    fired.current = true;
    // Sin limpieza ligada a `landing`: la fila consume el aterrizaje (vuelve a
    // false) antes de que venza la espera, y eso no debe cancelar la fiesta.
    timer.current = setTimeout(
      () => celebrate('record', { origin: markRef.current }),
      landing ? RECORD_SPARKS_DELAY_MS : 0,
    );
  }, [isRecord, landing, isLive]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return markRef;
};

const SessionRow = ({
  session,
  isRecord,
  flash,
  achievements,
  onOpenAchievement,
  onDelete,
}: {
  session: Session;
  isRecord: boolean;
  // Parpadeo dorado al llegar desde el aviso de cierre: "esta es la sesión de
  // la que te hablaba". Dos pulsos y se acaba.
  flash: boolean;
  // Los logros que cayeron EN esta sesión (LOGROS-IDEAS.md §2.1).
  achievements: SessionAchievementEntry[];
  // Pulsar un trofeo salta a SU logro, en la pestaña Achievements.
  onOpenAchievement: (achievementId: AchievementId) => void;
  // Solo para sesiones CERRADAS — una viva se para con Stop, no se borra.
  onDelete?: () => void;
}): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  const seconds = sessionSeconds(session, liveSeconds);
  // §10.8: una abierta en otro PC es "Playing on PC-A"; y con más de un
  // dispositivo conocido, cada fila dice en cuál se jugó.
  const device = useSessionDevice(session);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const range = timeRange(session, timeFormat);
  const { rowRef, flashClass, onAnimationEnd } = useFlashLanding(flash, consumeSessionFlash);
  const recordRef = useRecordSparks(isRecord, flash, session.endedAt === null);

  return (
    <div
      ref={rowRef}
      onAnimationEnd={onAnimationEnd}
      className={cn(
        'group/session relative scroll-mt-48 border-b border-line py-2.5 pl-3 last:border-b-0',
        isLive && 'border-l-2 border-l-live bg-live/6 pl-3.5',
        flashClass,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span className="w-26 flex-none text-body font-semibold text-bone">
          {dayLabel(session, timeFormat)}
        </span>
        <span className="w-28 flex-none text-body text-bone tabular-nums">{range ?? ''}</span>
        <span
          className={cn(
            'w-22 flex-none font-display text-[24px] leading-none font-bold tabular-nums',
            isLive ? 'text-live' : 'text-bone',
          )}
        >
          {isLive ? formatElapsed(seconds) : formatDuration(seconds)}
        </span>
        <span className="min-w-32 flex-[1_1_140px]">
          {isLive ? (
            <span className="flex items-center gap-2 text-body font-semibold text-live">
              <span
                aria-hidden
                className="size-2 flex-none animate-led-live rounded-full bg-live motion-reduce:animate-none"
              />
              {device.remote ? `Playing on ${device.deviceName}` : 'Playing now'}
              {device.noSignal !== null && (
                <span className="font-normal text-dust">{device.noSignal}</span>
              )}
            </span>
          ) : session.isManual ? (
            <span className="text-body text-dust">No device</span>
          ) : (
            <DeviceLabel session={session} tag={device.deviceTag} />
          )}
        </span>
        <span className="flex min-w-0 flex-[2_1_220px] flex-wrap items-center gap-x-4 gap-y-1">
          {/* Los trofeos de la noche: la misma pieza que las filas de la
              pantalla de Sesiones y el aviso de cierre. */}
          <SessionAchievements entries={achievements} onOpen={onOpenAchievement} />
          {session.closedBy === 'janitor' && (
            <span
              className={markClass}
              title="Afterplay closed it after losing the signal; the end time is the last one it saw."
            >
              <Timer size={13} className="flex-none" />
              Closed automatically
            </span>
          )}
          {session.isManual && !isLive && (
            <span className={markClass}>
              <PencilLine size={13} className="flex-none" />
              Added by hand
            </span>
          )}
          {isRecord && (
            <span ref={recordRef} className={markClass}>
              <Flame size={13} className="flex-none text-live" />
              Longest
            </span>
          )}
          {/* Sin nota, "Add a note" asoma al pasar por la fila: en una lista
              larga, una pastilla por fila taparía las marcas de verdad. */}
          {!session.note && (
            <span className="-mt-1.5 opacity-0 transition-opacity duration-150 group-hover/session:opacity-100 focus-within:opacity-100">
              <SessionNote sessionId={session.id} note={session.note} />
            </span>
          )}
        </span>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete session"
            className="flex size-7 flex-none items-center justify-center rounded-sm text-dust opacity-0 transition-[opacity,background-color,color] duration-150 group-hover/session:opacity-100 hover:bg-live/12 hover:text-live focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-phosphor"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Diario de sesión: "dónde lo dejé", a todo el ancho — ver SessionNote. */}
      {session.note && <SessionNote sessionId={session.id} note={session.note} />}
    </div>
  );
};

// ── Overview ────────────────────────────────────────────────────────────────

const RECENT_LIMIT = 3;

const RecentRow = ({ session }: { session: Session }): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  const device = useSessionDevice(session);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const seconds = sessionSeconds(session, liveSeconds);
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line px-4 py-3 last:border-b-0',
        isLive && 'border-l-2 border-l-live bg-live/6',
      )}
    >
      <span className="w-24 flex-none text-body text-bone">{dayLabel(session, timeFormat)}</span>
      <span className="w-32 flex-none text-body text-bone tabular-nums">
        {timeRange(session, timeFormat) ?? ''}
      </span>
      <span
        className={cn(
          'w-22 flex-none font-display text-[24px] leading-none font-bold tabular-nums',
          isLive ? 'text-live' : 'text-bone',
        )}
      >
        {isLive ? formatElapsed(seconds) : formatDuration(seconds)}
      </span>
      <span className="min-w-0 flex-1 text-body text-bone [overflow-wrap:anywhere]">
        {isLive
          ? device.remote
            ? `Playing on ${device.deviceName}`
            : 'Playing now'
          : session.isManual
            ? 'Added by hand'
            : (device.deviceTag ?? 'Tracked')}
      </span>
    </li>
  );
};

export const RecentSessions = ({
  sessions,
  onSeeAll,
}: {
  sessions: Session[];
  onSeeAll: () => void;
}): React.JSX.Element | null => {
  if (sessions.length === 0) return null;
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-small font-semibold text-dust">Recent sessions</h2>
        <button type="button" onClick={onSeeAll} className={textLinkClass}>
          See all
        </button>
      </div>
      <Stagger as="ul" className="overflow-hidden rounded-md border border-line bg-panel">
        {sessions.slice(0, RECENT_LIMIT).map((session) => (
          <RecentRow key={session.id} session={session} />
        ))}
      </Stagger>
    </section>
  );
};

// ── Pestaña Sessions ────────────────────────────────────────────────────────

type Week = { key: number; start: Date; sessions: Session[] };

const startOfWeek = (date: Date): Date => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  // Semana de lunes a domingo.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
};

const groupByWeek = (sessions: Session[]): Week[] => {
  const weeks = new Map<number, Week>();
  for (const session of sessions) {
    const start = startOfWeek(session.startedAt);
    const key = start.getTime();
    const week = weeks.get(key) ?? { key, start, sessions: [] };
    week.sessions.push(session);
    weeks.set(key, week);
  }
  return [...weeks.values()].sort((a, b) => b.key - a.key);
};

const weekLabel = (start: Date): string => {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const month = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short' });
  const thisYear = new Date().getFullYear();
  const year = end.getFullYear() === thisYear ? '' : `, ${end.getFullYear()}`;
  return start.getMonth() === end.getMonth()
    ? `${month(start)} ${start.getDate()} to ${end.getDate()}${year}`
    : `${month(start)} ${start.getDate()} to ${month(end)} ${end.getDate()}${year}`;
};

const PlaythroughBlock = ({
  iteration,
  open,
  onToggle,
  flashSessionId,
  achievementsBySession,
  onDelete,
}: {
  iteration: IterationDetail;
  open: boolean;
  onToggle: () => void;
  flashSessionId: SessionId | null;
  achievementsBySession: Map<SessionId, SessionAchievementEntry[]>;
  onDelete: (session: Session) => void;
}): React.JSX.Element => {
  const sessions = [...iteration.sessions].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
  );
  const weeks = groupByWeek(sessions);
  const closed = sessions.filter((session) => session.endedAt !== null);
  const average =
    closed.length > 0
      ? closed.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) / closed.length
      : 0;
  const maxSeconds = Math.max(0, ...closed.map((session) => session.durationSec ?? 0));
  const currentWeek = startOfWeek(new Date()).getTime();
  const started = iteration.startedAt
    ? iteration.startedAt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    // Las semanas entran escalonadas al abrir la pestaña (fx/Stagger: solo las
    // que se ven, sin nada puesto en reposo).
    <Stagger as="section" step={50} className="border-b border-line pb-4 last:border-b-0">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group/pt flex items-center gap-2.5 rounded-sm text-left outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
        >
          <ChevronDown
            size={18}
            className={cn(
              'flex-none text-dust transition-transform duration-150 motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          <span>
            <span className="block font-display text-title font-bold text-bone group-hover/pt:text-phosphor">
              {iteration.label}
            </span>
            <span className="block text-small text-dust">
              {started ? `Started ${started}` : 'No start date'}
              {iteration.endedAt === null && iteration.startedAt !== null && ' · still going'}
            </span>
          </span>
        </button>
        <dl className="flex gap-8">
          {[
            ['played', formatDuration(iteration.hours * 3600)],
            ['sessions', String(sessions.length)],
            ['average', average > 0 ? formatDuration(average) : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <dd className="font-display text-[30px] leading-none font-bold text-bone tabular-nums">
                {value}
              </dd>
              <dt className="mt-1 text-small text-dust">{label}</dt>
            </div>
          ))}
        </dl>
      </div>

      {open &&
        (weeks.length === 0 ? (
          <p className="py-4 text-body text-dust">No sessions in this playthrough yet.</p>
        ) : (
          weeks.map((week, index) => {
            const total = week.sessions.reduce(
              (sum, session) => sum + (session.endedAt === null ? 0 : (session.durationSec ?? 0)),
              0,
            );
            return (
              <div
                key={week.key}
                className="grid grid-cols-[132px_minmax(0,1fr)] gap-x-4 border-b border-line last:border-b-0"
              >
                <div className="py-2.5">
                  <div className="text-body font-semibold text-bone">{weekLabel(week.start)}</div>
                  {week.key === currentWeek && (
                    <div className="text-small text-dust">this week</div>
                  )}
                  {index === weeks.length - 1 && week.key !== currentWeek && weeks.length > 1 && (
                    <div className="text-small text-dust">first week</div>
                  )}
                  <div className="mt-1 font-display text-[24px] leading-none font-bold text-bone tabular-nums">
                    {formatDuration(total)}
                  </div>
                </div>
                <div>
                  {week.sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      isRecord={
                        closed.length > 1 &&
                        session.endedAt !== null &&
                        (session.durationSec ?? 0) > 0 &&
                        session.durationSec === maxSeconds
                      }
                      flash={session.id === flashSessionId}
                      achievements={achievementsBySession.get(session.id) ?? []}
                      // El flash viaja por el módulo y la ficha cambia sola a
                      // la pestaña Achievements, que lo recoge al montar.
                      onOpenAchievement={requestAchievementFlash}
                      onDelete={session.endedAt !== null ? () => onDelete(session) : undefined}
                    />
                  ))}
                </div>
              </div>
            );
          })
        ))}
    </Stagger>
  );
};

// Tiempo por dispositivo (barras), solo con más de un dispositivo conocido:
// con un PC solo es una barra al 100 %.
const TimeByDevice = ({ sessions }: { sessions: Session[] }): React.JSX.Element | null => {
  const { hasSeveral, nameOf, devices } = useDeviceContext();
  if (!hasSeveral) return null;
  const totals = new Map<string, { label: string; seconds: number; phone: boolean }>();
  for (const session of sessions) {
    if (session.endedAt === null) continue;
    const key = session.isManual ? 'manual' : session.deviceId;
    const os = devices.find((device) => device.id === session.deviceId)?.os;
    const row = totals.get(key) ?? {
      label: session.isManual ? 'Added by hand' : nameOf(session.deviceId),
      seconds: 0,
      phone: !session.isManual && (os === 'web' || session.startedBy === 'timer'),
    };
    row.seconds += session.durationSec ?? 0;
    totals.set(key, row);
  }
  const rows = [...totals.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map(([, row]) => row.seconds));
  const BAR = ['bg-phosphor', 'bg-tube', 'bg-st-resting', 'bg-st-beaten'];

  return (
    <section>
      <h2 className="mb-3 text-lead font-semibold text-bone">Time by device</h2>
      <ul className="flex flex-col gap-4">
        {rows.map(([key, row], index) => (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 text-body font-semibold text-bone">
                {key !== 'manual' &&
                  (row.phone ? (
                    <Smartphone size={14} className="text-dust" />
                  ) : (
                    <Monitor size={14} className="text-dust" />
                  ))}
                {row.label}
              </span>
              <span className="font-display text-[24px] leading-none font-bold text-bone tabular-nums">
                {formatDuration(row.seconds)}
              </span>
            </div>
            {key !== 'manual' && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-inset">
                <div
                  className={cn('h-full rounded-full', BAR[index] ?? 'bg-dust')}
                  style={{ width: `${Math.max(2, (row.seconds / max) * 100)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

export const SessionsTab = ({
  gameId,
  iterations,
  aside,
}: {
  gameId: GameId;
  iterations: IterationDetail[];
  // La columna derecha que pone la ficha (el History).
  aside?: React.ReactNode;
}): React.JSX.Element => {
  const navigate = useNavigate();
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const { data: timeFormat = '24h' } = useTimeFormat();
  // Qué sesión resaltar por haber llegado desde el aviso de cierre. Vive
  // fuera de React (el aviso puede llegar en cualquier pantalla). Quien lo
  // consume es la propia fila, en cuanto arranca el parpadeo.
  const flashSessionId = useSyncExternalStore(subscribeSessionFlash, getPendingSessionFlash);
  const achievementsBySession = useAchievementsBySession(gameId);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const ordered = [...iterations].reverse();
  const newestId = ordered[0]?.id;
  const allSessions = iterations.flatMap((iteration) => iteration.sessions);

  return (
    <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        {allSessions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-line-strong px-5 py-6 text-body text-dust">
            <NotebookPen size={16} className="flex-none" />
            No sessions yet. Play it from here or let Afterplay notice it running.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {ordered.map((iteration) => {
              const holdsFlash = iteration.sessions.some((s) => s.id === flashSessionId);
              const open = toggled[iteration.id] ?? (iteration.id === newestId || holdsFlash);
              return (
                <PlaythroughBlock
                  key={iteration.id}
                  iteration={iteration}
                  open={open || holdsFlash}
                  onToggle={() => setToggled((current) => ({ ...current, [iteration.id]: !open }))}
                  flashSessionId={flashSessionId}
                  achievementsBySession={achievementsBySession}
                  onDelete={setPendingDelete}
                />
              );
            })}
          </div>
        )}
        {allSessions.length > 0 && (
          <button
            type="button"
            onClick={() => navigate(`/sessions?game=${gameId}`)}
            className={cn(textLinkClass, 'mt-5 inline-flex items-center gap-1.5')}
          >
            Open in Sessions ({pluralize(allSessions.length, 'session')})
            <ArrowRight size={14} />
          </button>
        )}
      </div>

      <aside className="flex flex-col gap-9">
        <TimeByDevice sessions={allSessions} />
        {aside}
      </aside>

      <DeleteSessionDialog
        session={
          pendingDelete
            ? {
                id: pendingDelete.id,
                label: `${formatByPrecision(pendingDelete.startedAt, pendingDelete.datePrecision, timeFormat)} · ${formatElapsed(pendingDelete.durationSec ?? 0)}`,
              }
            : null
        }
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
};
