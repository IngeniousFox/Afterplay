import { BarChart3, Gamepad2, LayoutGrid, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import type { GameListItem } from '../../../../shared/types';
import { useGames } from '../../hooks/games';
import { useImageSrc } from '../../hooks/useImageSrc';
import { formatHours, pluralize } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';

type ShellProps = {
  label: string;
  sub: string;
  search: string;
  onSearchChange: (value: string) => void;
  children: React.ReactNode;
};

const MiddleColumnShell = ({
  label,
  sub,
  search,
  onSearchChange,
  children,
}: ShellProps): React.JSX.Element => (
  <div
    className="relative z-2 flex w-78 flex-none flex-col overflow-hidden border-r border-border"
    style={{ background: 'rgba(15,17,16,.9)' }}
  >
    <div className="border-b border-border px-4.5 pt-4.5 pb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold tracking-[.13em] text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </div>
      <div className="relative mt-3">
        <Search
          size={15}
          className="pointer-events-none absolute top-1/2 left-2.75 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search games…"
          className="w-full rounded-[9px] border border-input bg-white/[0.03] py-2.25 pr-3 pl-8.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
  </div>
);

const LiveTag = (): React.JSX.Element => (
  <span className="ml-1 flex-none text-[9.5px] font-extrabold tracking-[.08em] text-primary">
    LIVE
  </span>
);

const StatusSubtitle = ({
  game,
  showLive,
}: {
  game: GameListItem;
  showLive: boolean;
}): React.JSX.Element => {
  const status = getGameStatusMeta(game.currentState);
  return (
    <>
      <status.Icon size={13} color={status.color} fill={status.filled ? status.color : 'none'} />
      <span className="truncate text-xs font-medium" style={{ color: status.color }}>
        {status.label}
      </span>
      {showLive && game.isLive && <LiveTag />}
    </>
  );
};

type RowProps = {
  game: GameListItem;
  selected: boolean;
  onClick: () => void;
  subtitle: React.ReactNode;
  rightLabel: string;
};

// Fila de juego con carátula — comparte marcado entre las 3 variantes,
// solo cambia el contenido del subtítulo (estado vs nº de sesiones) y el
// valor de la derecha, que cada columna decide.
const GameRow = ({
  game,
  selected,
  onClick,
  subtitle,
  rightLabel,
}: RowProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  return (
    <div
      onClick={onClick}
      className="relative mb-0.5 flex cursor-pointer items-center gap-2.75 rounded-[10px] px-2.5 py-2.25 hover:bg-white/[0.04]"
    >
      {selected && (
        <div
          className="absolute inset-0 rounded-[10px] border"
          style={{ background: 'rgba(255,255,255,.06)', borderColor: 'rgba(255,255,255,.12)' }}
        />
      )}
      <div className="relative z-1 h-12 w-9 flex-none overflow-hidden rounded-[6px] border border-border">
        {coverSrc ? (
          <img src={coverSrc} loading="lazy" alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Gamepad2 size={14} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="relative z-1 min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-foreground">{game.title}</div>
        <div className="mt-0.75 flex items-center gap-1.25">{subtitle}</div>
      </div>
      <div className="relative z-1 flex-none text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {rightLabel}
      </div>
    </div>
  );
};

// Fila "All games" (Sessions/Stats) — mismo hueco de carátula pero con un
// icono en vez de portada, seleccionada por defecto (nada de un juego
// concreto elegido todavía).
const AllGamesRow = ({
  Icon,
  subtitle,
  selected,
  onClick,
}: {
  Icon: typeof LayoutGrid;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element => (
  <div
    onClick={onClick}
    className="relative mb-1.5 flex cursor-pointer items-center gap-2.75 rounded-[10px] px-2.5 py-2.5 hover:bg-white/[0.04]"
  >
    {selected && (
      <div
        className="absolute inset-0 rounded-[10px] border"
        style={{ background: 'rgba(255,255,255,.06)', borderColor: 'rgba(255,255,255,.12)' }}
      />
    )}
    <div className="relative z-1 flex h-12 w-9 flex-none items-center justify-center rounded-[6px] border border-border bg-white/[0.04]">
      <Icon size={18} color="var(--muted-foreground)" />
    </div>
    <div className="relative z-1 flex-1">
      <div className="text-[13.5px] font-semibold text-foreground">All games</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
    </div>
  </div>
);

const useFilteredGames = (search: string): GameListItem[] => {
  const { data: games = [] } = useGames();
  const query = search.trim().toLowerCase();
  return query ? games.filter((game) => game.title.toLowerCase().includes(query)) : games;
};

const LibraryNavColumn = (): React.JSX.Element => {
  const navigate = useNavigate();
  const detailMatch = useMatch('/games/:id');
  const selectedId = detailMatch ? Number(detailMatch.params.id) : null;
  const { data: games = [] } = useGames();
  const [search, setSearch] = useState('');
  const filtered = useFilteredGames(search);

  return (
    <MiddleColumnShell
      label="LIBRARY"
      sub={pluralize(games.length, 'game')}
      search={search}
      onSearchChange={setSearch}
    >
      {filtered.map((game) => (
        <GameRow
          key={game.id}
          game={game}
          selected={game.id === selectedId}
          onClick={() => navigate(`/games/${game.id}`)}
          subtitle={<StatusSubtitle game={game} showLive />}
          rightLabel={formatHours(game.totalHours)}
        />
      ))}
    </MiddleColumnShell>
  );
};

// La selección aquí SÍ es navegación real (Bloque 5A): vive en el query
// param `?game=` de la propia URL de /sessions, así que Sessions.tsx (el
// panel de la derecha) lee el mismo estado sin necesitar un context ni una
// librería aparte solo para compartir un id entre dos componentes.
const SessionsNavColumn = (): React.JSX.Element => {
  const { data: games = [] } = useGames();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const filtered = useFilteredGames(search);
  const totalSessions = games.reduce((sum, game) => sum + game.sessionCount, 0);
  const gameParam = searchParams.get('game');
  const selectedId = gameParam ? Number(gameParam) : null;

  return (
    <MiddleColumnShell
      label="SESSIONS"
      sub={pluralize(totalSessions, 'session')}
      search={search}
      onSearchChange={setSearch}
    >
      <AllGamesRow
        Icon={LayoutGrid}
        subtitle={pluralize(totalSessions, 'session')}
        selected={selectedId === null}
        onClick={() => setSearchParams({})}
      />
      {filtered.map((game) => (
        <GameRow
          key={game.id}
          game={game}
          selected={game.id === selectedId}
          onClick={() => setSearchParams({ game: String(game.id) })}
          subtitle={
            <>
              <span className="text-xs text-muted-foreground">
                {pluralize(game.sessionCount, 'session')}
              </span>
              {game.isLive && <LiveTag />}
            </>
          }
          rightLabel={formatHours(game.totalHours)}
        />
      ))}
    </MiddleColumnShell>
  );
};

// La selección aquí SÍ es navegación real (Bloque 5F, mismo patrón que
// Sessions): vive en el query param `?game=` de la propia URL de /stats,
// así que Stats.tsx lee el mismo estado sin necesitar un context aparte.
const StatsNavColumn = (): React.JSX.Element => {
  const { data: games = [] } = useGames();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const filtered = useFilteredGames(search);
  const gameParam = searchParams.get('game');
  const selectedId = gameParam ? Number(gameParam) : null;

  return (
    <MiddleColumnShell
      label="STATISTICS"
      sub={pluralize(games.length, 'game')}
      search={search}
      onSearchChange={setSearch}
    >
      <AllGamesRow
        Icon={BarChart3}
        subtitle="Overview & charts"
        selected={selectedId === null}
        onClick={() => setSearchParams({})}
      />
      {filtered.map((game) => (
        <GameRow
          key={game.id}
          game={game}
          selected={game.id === selectedId}
          onClick={() => setSearchParams({ game: String(game.id) })}
          subtitle={<StatusSubtitle game={game} showLive={false} />}
          rightLabel={formatHours(game.totalHours)}
        />
      ))}
    </MiddleColumnShell>
  );
};

// Despacha por ruta activa — un solo componente montado en RootLayout junto
// al NavRail, persiste entre Games/Sessions/Stats (y el detalle de un
// juego, que vive dentro de /games).
export const MiddleColumn = (): React.JSX.Element => {
  const location = useLocation();
  if (location.pathname === '/sessions') return <SessionsNavColumn />;
  if (location.pathname === '/stats') return <StatsNavColumn />;
  return <LibraryNavColumn />;
};
