import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clock3, Gamepad2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchSessions, fetchStats } from '../api';
import type { StatsSummary } from '../api';
import { Cover } from '../components/Cover';
import { LiveBadge, LiveTimer } from '../components/LiveBadge';
import { ErrorState, Loading } from '../components/States';
import { formatHours, pluralize, relativeDay } from '../lib/format';
import { AMBER, BLUE, GREEN, statusOf, VIOLET } from '../lib/status';

// La tarjeta de "jugando ahora". Es la razón de que esta portada exista: una
// sesión abierta es una fila con endedAt a null, o sea que se ve desde fuera
// sin que el PC de casa esté encendido ni haya que inventar ningún canal
// (§2.1). Lleva el mismo halo verde que la card del escritorio.
const LiveCard = ({ live }: { live: NonNullable<StatsSummary['live']> }): React.JSX.Element => (
  <Link
    to={`/game/${live.gameId}`}
    className="afterplay-reveal relative flex items-center gap-3.5 rounded-2xl border border-border bg-card p-3"
    style={{ animation: 'afterplay-glow-card 2.6s ease-in-out infinite' }}
  >
    <Cover url={live.coverUrl} title={live.gameTitle} className="w-16" />
    <div className="min-w-0 flex-1">
      <LiveBadge />
      <div className="mt-1.5 line-clamp-2 text-[15px] leading-tight font-extrabold">
        {live.gameTitle}
      </div>
      <div className="mt-1">
        <LiveTimer since={live.since} />
      </div>
    </div>
    <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
  </Link>
);

const Tile = ({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color: string;
  hint?: string;
}): React.JSX.Element => (
  <div className="rounded-xl border border-border bg-card px-3 py-2.5">
    <div className="text-[19px] leading-none font-extrabold tabular-nums" style={{ color }}>
      {value}
    </div>
    <div className="mt-1.5 text-[9.5px] font-bold tracking-[.11em] text-muted-foreground uppercase">
      {label}
    </div>
    {hint && (
      <div className="mt-0.5 text-[9.5px] font-semibold text-muted-foreground/70 tabular-nums">
        {hint}
      </div>
    )}
  </div>
);

// El reparto por estado, en una barra apilada. Es el resumen que de verdad
// cabe en un móvil: cuánto has terminado frente a cuánto te queda, de un
// vistazo y sin leer un solo número.
const StatusBar = ({ stats }: { stats: StatsSummary }): React.JSX.Element | null => {
  const segments = [
    { key: 'completed', count: stats.beaten },
    { key: 'started', count: stats.playing },
    { key: 'dropped', count: stats.dropped },
  ] as const;

  const known = segments.reduce((sum, segment) => sum + segment.count, 0) + stats.unplayed;
  if (known === 0) return null;

  return (
    <div className="afterplay-reveal">
      <div className="flex h-2 overflow-hidden rounded-full bg-white/8">
        {segments.map(({ key, count }) => (
          <div
            key={key}
            style={{ width: `${(count / known) * 100}%`, background: statusOf(key).color }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map(({ key, count }) => {
          const meta = statusOf(key);
          return (
            <span key={key} className="flex items-center gap-1.5 text-[11px] font-bold">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
              <span className="text-muted-foreground">{meta.label}</span>
              <span className="tabular-nums">{count}</span>
            </span>
          );
        })}
        <span className="flex items-center gap-1.5 text-[11px] font-bold">
          <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
          <span className="text-muted-foreground">Unplayed</span>
          <span className="tabular-nums">{stats.unplayed}</span>
        </span>
      </div>
    </div>
  );
};

export const Home = (): React.JSX.Element => {
  const stats = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
  const recent = useQuery({ queryKey: ['sessions', 'recent'], queryFn: () => fetchSessions(6) });

  if (stats.isPending) return <Loading label="Reading your library" />;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;

  const summary = stats.data;

  return (
    <div className="flex flex-col gap-5 px-4 pt-4">
      {summary.live && <LiveCard live={summary.live} />}

      {/* Las horas del año siguen la misma regla que Stats filtrado por año:
          sesiones de ese año MÁS las horas manuales atribuidas a él. Por eso
          el subtítulo dice en cuántos juegos — es la distinción entre "GAMES
          TRACKED" y "GAMES PLAYED" del escritorio. */}
      <div className="afterplay-reveal grid grid-cols-2 gap-2.5">
        <Tile label="Hours played" value={formatHours(summary.totalHours)} color={GREEN} />
        <Tile
          label={`In ${summary.year}`}
          value={formatHours(summary.hoursThisYear)}
          color={AMBER}
          hint={`${summary.gamesThisYear} games`}
        />
        <Tile label="Games" value={String(summary.totalGames)} color={BLUE} />
        <Tile label="Sessions" value={String(summary.totalSessions)} color={VIOLET} />
      </div>

      <StatusBar stats={summary} />

      {/* Las sesiones recientes: el "qué he estado haciendo" que justifica
          abrir esto en un tren. Solo si hay alguna — una sección vacía no
          aporta nada. */}
      {recent.data && recent.data.sessions.length > 0 && (
        <section className="afterplay-reveal">
          <div className="mb-2.5 flex items-baseline justify-between">
            <h2 className="text-[10px] font-bold tracking-[.13em] text-muted-foreground uppercase">
              Recently played
            </h2>
            <Link to="/sessions" className="text-[11.5px] font-bold text-primary">
              See all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {recent.data.sessions.map((session) => (
              <Link
                key={session.id}
                to={`/game/${session.gameId}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-2"
              >
                <Cover url={session.coverUrl} title={session.gameTitle} className="w-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold">{session.gameTitle}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                    {relativeDay(session.startedAt)}
                  </div>
                </div>
                {session.durationSec !== null && (
                  <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-bold tabular-nums">
                    <Clock3 size={12} style={{ color: GREEN }} />
                    {formatHours(session.durationSec / 3600)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold text-muted-foreground">
        <Gamepad2 size={13} />
        {pluralize(summary.playedGames, 'game')} played of {summary.totalGames}
      </div>
    </div>
  );
};
