import { Activity, ArrowRight, Calendar, Clock, Flame } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { SessionWithGame } from '../../../shared/types';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { SessionRow } from '../components/sessions/SessionRow';
import { useGames } from '../hooks/games';
import { useAllSessions } from '../hooks/sessions';
import { formatHours, pluralize } from '../lib/format';

const outlineButtonClass =
  'flex items-center gap-1.75 rounded-[9px] border px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap';

// Sin filtro, el panel solo lista las últimas 25 sesiones de TODA la
// biblioteca (un feed de actividad reciente, no un muro sin fondo de toda tu
// vida jugando); filtrado a un juego sí se ve completo, porque ahí el
// volumen ya es manejable. El prototipo (Backlog.html) usaba 18 — subido a
// 25 a petición expresa.
const UNFILTERED_LIMIT = 25;

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

type SessionGroup = { label: string; sessions: SessionWithGame[] };

// Agrupa por antigüedad relativa al día de hoy — rompe la monotonía de una
// lista plana de filas idénticas. Se agrupa por la fecha real de la sesión
// sin mirar su datePrecision: una sesión logueada a mano con precisión de
// año casi siempre cae en "Earlier" de todos modos, sin necesitar un caso
// especial.
const groupSessionsByDate = (sessions: SessionWithGame[]): SessionGroup[] => {
  const todayStart = startOfDay(new Date());
  const buckets: Record<'Today' | 'Yesterday' | 'This Week' | 'Earlier', SessionWithGame[]> = {
    Today: [],
    Yesterday: [],
    'This Week': [],
    Earlier: [],
  };

  for (const session of sessions) {
    const diffDays = Math.round((todayStart - startOfDay(session.startedAt)) / DAY_MS);
    if (diffDays <= 0) buckets.Today.push(session);
    else if (diffDays === 1) buckets.Yesterday.push(session);
    else if (diffDays <= 7) buckets['This Week'].push(session);
    else buckets.Earlier.push(session);
  }

  return (['Today', 'Yesterday', 'This Week', 'Earlier'] as const)
    .map((label) => ({ label, sessions: buckets[label] }))
    .filter((group) => group.sessions.length > 0);
};

// Bloque 5A — todas las sesiones, o filtradas a un juego vía el ?game= que
// pone SessionsNavColumn (MiddleColumn.tsx) al hacer clic en la columna de
// nav. Mismo filtro, misma URL: los dos componentes leen el search param en
// vez de compartir estado por otra vía.
export const Sessions = (): React.JSX.Element => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gameParam = searchParams.get('game');
  const gameId = gameParam ? Number(gameParam) : null;

  const { data: sessions = [], isLoading, isError } = useAllSessions();
  const { data: games = [] } = useGames();

  const selectedGame = gameId === null ? null : (games.find((g) => g.id === gameId) ?? null);
  const filtered = useMemo(
    () => (gameId === null ? sessions : sessions.filter((s) => s.gameId === gameId)),
    [sessions, gameId],
  );
  const visible = gameId === null ? filtered.slice(0, UNFILTERED_LIMIT) : filtered;
  const groups = useMemo(() => groupSessionsByDate(visible), [visible]);

  // Filtrado a un juego, usa selectedGame.totalHours (useGames(), la misma
  // fuente que Library/detalle) en vez de re-sumar durationSec a mano — así
  // nunca puede desacordarse del número que se ve en el resto de la app
  // (esta vista no sabe de manualTotalPlayed, que sí cuenta ahí). Sin
  // filtro, suma esa misma fuente para las 4 cards de resumen.
  const totalHours = selectedGame
    ? selectedGame.totalHours
    : games.reduce((sum, game) => sum + game.totalHours, 0);

  // Sesión más larga y media SOLO de sesiones ya cerradas — una en marcha
  // tiene durationSec null (su tiempo real está en su propio contador en
  // vivo, no aquí), incluirla como 0 falsearía las dos métricas hacia abajo.
  const closedSessions = filtered.filter((session) => session.endedAt !== null);
  const longestSessionSec = closedSessions.reduce(
    (max, session) => Math.max(max, session.durationSec ?? 0),
    0,
  );
  const avgSessionSec =
    closedSessions.length > 0
      ? closedSessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) /
        closedSessions.length
      : 0;

  const subtitle = selectedGame
    ? `${pluralize(filtered.length, 'session')} · ${formatHours(selectedGame.totalHours)} total`
    : `${pluralize(sessions.length, 'session')} across your library`;

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mx-auto max-w-250">
        <div className="mb-6.5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
              {selectedGame ? selectedGame.title : 'All Sessions'}
            </h1>
            <p className="mt-1.25 text-[13.5px] text-muted-foreground">{subtitle}</p>
          </div>

          {selectedGame && (
            <div className="flex flex-none gap-2.5">
              <button
                type="button"
                onClick={() => navigate(`/games/${selectedGame.id}`)}
                className={`${outlineButtonClass} border-primary/45 bg-primary/10 text-primary hover:bg-primary/16`}
              >
                <span>Open game</span>
                <ArrowRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className={`${outlineButtonClass} border-input bg-white/[0.03] text-foreground hover:bg-white/[0.06]`}
              >
                All sessions
              </button>
            </div>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading sessions…</p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Something went wrong loading your sessions. Try again in a moment.
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-24 text-center">
            <p className="text-sm font-semibold text-foreground">No sessions yet</p>
            <p className="text-xs text-muted-foreground">
              {selectedGame
                ? 'Sessions you play (or log manually) for this game will show up here.'
                : 'Play a game with the watcher running, or log one manually, to see it here.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6.5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <MetricCard Icon={Clock} label="TOTAL HOURS" value={formatHours(totalHours)} />
              <MetricCard Icon={Calendar} label="SESSIONS" value={String(filtered.length)} />
              <MetricCard
                Icon={Flame}
                label="LONGEST SESSION"
                value={formatHours(longestSessionSec / 3600)}
              />
              <MetricCard
                Icon={Activity}
                label="AVG SESSION"
                value={formatHours(avgSessionSec / 3600)}
              />
            </div>

            <div className="flex flex-col gap-5.5">
              {groups.map((group) => (
                <div key={group.label}>
                  <div className="mb-2.5 text-[11px] font-bold tracking-[.13em] text-muted-foreground uppercase">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {group.sessions.map((session) => (
                      <SessionRow key={session.id} session={session} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
