import { BarChart3, ChevronDown, LayoutGrid, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import type { GameListItem } from '../../../../shared/types';
import { useGames, usePlannedGames } from '../../hooks/games';
import { formatHours, pluralize } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { filterByTitle } from '../../lib/search';
import { revealClass, revealStyle } from '../../lib/styles';
import { GameCover } from '../GameCover';
import { StatusIcon } from '../StatusIcon';

const GREEN = '#2fdc7e';

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

// Mismo lenguaje que el badge PLAYING del HeroBanner y el de OngoingBadge:
// puntito pulsante + texto, no solo texto suelto — aquí era el único sitio
// de la app donde "LIVE" no llevaba el pulso.
const LiveTag = (): React.JSX.Element => (
  <span className="ml-1 flex flex-none items-center gap-1">
    <span
      className="h-1.25 w-1.25 rounded-full bg-primary"
      style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
    />
    <span className="text-[9.5px] font-extrabold tracking-[.08em] text-primary">LIVE</span>
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
      <StatusIcon meta={status} size={13} />
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

// El overlay de "esta es la fila abierta ahora mismo" — antes un gris
// translúcido genérico igual en las 2 variantes de fila (GameRow/
// AllGamesRow); ahora el verde de acento de la marca, con una barra a la
// izquierda a modo de "estás aquí" (mismo lenguaje que un tab activo), no
// solo un tinte de fondo que se podía confundir con un simple hover.
const SelectedOverlay = (): React.JSX.Element => (
  <div
    className="absolute inset-0 rounded-[10px] border"
    style={{
      background: `${GREEN}14`,
      borderColor: `${GREEN}40`,
      // Más fina (2.5px -> 1.5px) y ya no a tope de opacidad — a color
      // sólido se leía como un bloque pegado al borde, no como un acento.
      boxShadow: `inset 1.5px 0 0 0 ${GREEN}b3`,
    }}
  />
);

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
  return (
    <div
      onClick={onClick}
      className="relative mb-0.5 flex cursor-pointer items-center gap-2.75 rounded-[10px] px-2.5 py-2.25 hover:bg-white/[0.04]"
    >
      {selected && <SelectedOverlay />}
      <GameCover
        url={game.coverUrl}
        className="relative z-1 h-12 w-9 flex-none overflow-hidden rounded-[6px] border border-border"
        iconSize={14}
      />
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
    {selected && <SelectedOverlay />}
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
  return filterByTitle(games, search);
};

// Cabecera de grupo de la columna de biblioteca (estilo Steam) — clicable
// para plegar/desplegar cuando lleva onToggle; sin él es un rótulo fijo.
// `color` opcional: un tinte para grupos que representan algo concreto (el
// de Playing & On Hold en verde) — sin él se queda en el gris neutro de
// siempre (All Games no es "de" ningún color, es solo "el resto").
const GroupHeader = ({
  label,
  count,
  open,
  onToggle,
  color,
}: {
  label: string;
  count: number;
  open?: boolean;
  onToggle?: () => void;
  color?: string;
}): React.JSX.Element => (
  <div
    onClick={onToggle}
    className={`flex items-center gap-1.5 rounded-md px-2.5 pt-2 pb-1.5 text-[10.5px] font-bold tracking-[.11em] ${
      // hover:text-foreground se queda sin efecto cuando hay `color` (un
      // style inline SIEMPRE gana sobre una clase) — intencional: un grupo
      // ya coloreado no necesita además un cambio de color al pasar el
      // ratón, el propio color ya es la distinción.
      color ? '' : 'text-muted-foreground'
    } ${onToggle ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
    style={color ? { color } : undefined}
  >
    {onToggle && (
      <ChevronDown
        size={12}
        className="transition-transform"
        style={{ transform: open ? 'none' : 'rotate(-90deg)' }}
      />
    )}
    <span>{label}</span>
    <span
      className="font-semibold tracking-normal"
      style={color ? { color: `${color}b3` } : undefined}
    >
      ({count})
    </span>
  </div>
);

const LibraryNavColumn = (): React.JSX.Element => {
  const navigate = useNavigate();
  const detailMatch = useMatch('/games/:id');
  const selectedId = detailMatch ? Number(detailMatch.params.id) : null;
  const { data: games = [] } = useGames();
  const [search, setSearch] = useState('');
  const [activeOpen, setActiveOpen] = useState(true);
  const [restOpen, setRestOpen] = useState(true);
  const filtered = useFilteredGames(search);

  // Sección especial estilo Steam: lo que estás jugando o tienes en pausa,
  // arriba y plegable. Los juegos se MUEVEN aquí, no se duplican — el
  // listado general de abajo los excluye. Playing por delante de On Hold
  // (dentro de cada estado se conserva el alfabético de la query).
  const isActive = (game: GameListItem): boolean =>
    game.currentState === 'started' || game.currentState === 'on_hold';
  const activeGames = filtered
    .filter(isActive)
    .sort((a, b) =>
      a.currentState === b.currentState ? 0 : a.currentState === 'started' ? -1 : 1,
    );
  const restGames = filtered.filter((game) => !isActive(game));

  const renderRow = (game: GameListItem): React.JSX.Element => (
    <GameRow
      key={game.id}
      game={game}
      selected={game.id === selectedId}
      onClick={() => navigate(`/games/${game.id}`)}
      subtitle={<StatusSubtitle game={game} showLive />}
      rightLabel={formatHours(game.totalHours)}
    />
  );

  return (
    <MiddleColumnShell
      label="LIBRARY"
      sub={pluralize(games.length, 'game')}
      search={search}
      onSearchChange={setSearch}
    >
      {/* revealClass en el contenido, no en el shell (cabecera+buscador no
          deben refundirse) — y montado una vez por SECCIÓN (Games/Sessions/
          Stats/Plan son 4 componentes distintos que MiddleColumn intercambia
          al navegar, ver el dispatcher al final del archivo), no por cada
          letra que se teclea en el buscador: filtrar solo vuelve a renderizar
          este mismo componente ya montado, no lo remonta. */}
      <div className={revealClass} style={revealStyle(0)}>
        {activeGames.length > 0 ? (
          <>
            <GroupHeader
              label="PLAYING & ON HOLD"
              count={activeGames.length}
              open={activeOpen}
              onToggle={() => setActiveOpen(!activeOpen)}
              color={GREEN}
            />
            {activeOpen && activeGames.map(renderRow)}
            <GroupHeader
              label="ALL GAMES"
              count={restGames.length}
              open={restOpen}
              onToggle={() => setRestOpen(!restOpen)}
            />
            {restOpen && restGames.map(renderRow)}
          </>
        ) : (
          // Sin juegos activos no hay grupos que separar — lista plana de
          // siempre, sin cabeceras que plegar.
          restGames.map(renderRow)
        )}
      </div>
    </MiddleColumnShell>
  );
};

// Sección Plan to Play — mismo patrón que LibraryNavColumn pero sobre la
// lista de planeados (usePlannedGames): estos juegos no aparecen en ninguna
// otra columna ni pantalla de la app. Sin horas a la derecha (un juego
// planeado no tiene tiempo jugado por definición).
const PlanNavColumn = (): React.JSX.Element => {
  const navigate = useNavigate();
  const detailMatch = useMatch('/plan/:id');
  const selectedId = detailMatch ? Number(detailMatch.params.id) : null;
  const { data: games = [] } = usePlannedGames();
  const [search, setSearch] = useState('');
  const filtered = filterByTitle(games, search);

  return (
    <MiddleColumnShell
      label="PLAN TO PLAY"
      sub={pluralize(games.length, 'game')}
      search={search}
      onSearchChange={setSearch}
    >
      <div className={revealClass} style={revealStyle(0)}>
        {filtered.map((game) => (
          <GameRow
            key={game.id}
            game={game}
            selected={game.id === selectedId}
            onClick={() => navigate(`/plan/${game.id}`)}
            subtitle={<StatusSubtitle game={game} showLive={false} />}
            rightLabel=""
          />
        ))}
      </div>
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
      <div className={revealClass} style={revealStyle(0)}>
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
      </div>
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
      <div className={revealClass} style={revealStyle(0)}>
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
      </div>
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
  if (location.pathname.startsWith('/plan')) return <PlanNavColumn />;
  return <LibraryNavColumn />;
};
