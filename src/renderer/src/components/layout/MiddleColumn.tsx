import { BarChart3, ChevronDown, LayoutGrid, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import type { GameListItem } from '../../../../shared/types';
import { useGames, usePlannedGames } from '../../hooks/games';
import { formatHours, pluralize } from '../../lib/format';
import {
  applyFilters,
  availableGenres,
  EMPTY_FILTERS,
  type FilterGroup,
  type FlagKey,
  type GameFilters,
} from '../../lib/gameFilters';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { filterByTitle } from '../../lib/search';
import { revealClass, revealStyle } from '../../lib/styles';
import { GameCover } from '../GameCover';
import { StatusIcon } from '../StatusIcon';
import { GameFilterPanel } from './GameFilterPanel';
import { NowPlayingCard } from './NowPlayingCard';
import { GREEN } from '../../lib/colors';

// Mueve la selección `delta` posiciones dentro de `items`. Sin selección
// previa (o si la actual ya no está en la lista filtrada) entra por el
// extremo que corresponda al sentido, en vez de no hacer nada.
const nextSelection = <T,>(items: T[], current: T, delta: 1 | -1): T | undefined => {
  if (items.length === 0) return undefined;
  const index = items.indexOf(current);
  if (index === -1) return delta > 0 ? items[0] : items[items.length - 1];
  return items[Math.min(items.length - 1, Math.max(0, index + delta))];
};

// Lleva la fila seleccionada a la vista, pero SOLO cuando el usuario no la
// tenía ya delante: al montar la columna (llegar desde "Open game" de
// Stats/Sessions), al cambiar el tamaño de la lista (borrar la búsqueda
// devuelve la lista completa) y al moverse con las flechas.
//
// Dos casos en los que NO debe moverse nada, ambos deliberados:
//   - Clic manual en una fila: si la estás viendo y la clicas, ya está donde
//     quieres — centrarla sería un salto gratuito bajo el cursor.
//   - Cualquier otro render (un refresco del watcher, por ejemplo): si has
//     desplazado la lista a mano, no debe devolverte de un tirón.
const useSelectedRowScroll = (
  selectedId: number | null,
  listSize: number,
): {
  attachSelectedRow: (node: HTMLDivElement | null) => void;
  onKeyboardMove: () => void;
  onManualSelect: (nextSelectedId: number | null) => void;
} => {
  const lastKeyRef = useRef<string | null>(null);
  const blockRef = useRef<ScrollLogicalPosition>('center');
  const key = `${selectedId}:${listSize}`;

  return {
    attachSelectedRow: (node): void => {
      if (!node || lastKeyRef.current === key) return;
      lastKeyRef.current = key;
      node.scrollIntoView({ block: blockRef.current });
      blockRef.current = 'center';
    },
    // Con las flechas la selección avanza de una en una, así que 'nearest'
    // desplaza lo justo para que la fila entre; 'center' daría un salto
    // brusco en cada pulsación.
    onKeyboardMove: (): void => {
      blockRef.current = 'nearest';
    },
    // Da por atendida de antemano la clave que va a resultar del clic, así
    // que cuando la fila se vuelva a montar no habrá nada que hacer. Se marca
    // la clave concreta en vez de un flag suelto: un flag se quedaría
    // colgado si el clic no llega a cambiar la selección (clicar la fila que
    // ya estaba abierta) y se comería el siguiente desplazamiento legítimo.
    onManualSelect: (nextSelectedId): void => {
      lastKeyRef.current = `${nextSelectedId}:${listSize}`;
    },
  };
};

type ShellProps = {
  label: string;
  sub: string;
  search: string;
  onSearchChange: (value: string) => void;
  // Flechas arriba/abajo con el foco en la columna (lista o buscador): mueven
  // la SELECCIÓN en vez de desplazar la lista, igual que el buscador de Add
  // Game. Se escucha en la raíz para que funcione escribiendo en el buscador
  // sin tener que salir de él.
  onArrowNavigate?: (delta: 1 | -1) => void;
  // El panel de filtros, que cada columna arma con los grupos que le sirven.
  filters?: React.ReactNode;
  children: React.ReactNode;
};

const MiddleColumnShell = ({
  label,
  sub,
  search,
  onSearchChange,
  onArrowNavigate,
  filters,
  children,
}: ShellProps): React.JSX.Element => (
  <div
    onKeyDown={(event) => {
      if (!onArrowNavigate) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      // Sin esto el contenedor scrollearía además de cambiar la selección,
      // que es justo lo que se quiere evitar.
      event.preventDefault();
      onArrowNavigate(event.key === 'ArrowDown' ? 1 : -1);
    }}
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
      {filters}
    </div>
    {/* tabIndex=0: sin él, clicar la lista no le da el foco y las flechas
        seguirían scrolleando el contenedor en vez de mover la selección. */}
    <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-2 outline-none">
      {children}
    </div>
    {/* Anclada al fondo y FUERA del área con scroll: la partida en curso no
        puede quedarse arriba del todo de una lista de 300 juegos. Al vivir en
        el shell, sale en las cuatro secciones (Library/Sessions/Stats/Plan)
        sin repetirla en cada una. */}
    <NowPlayingCard />
  </div>
);

// Tinte verde de la fila del juego que está EN MARCHA. Sustituye al badge
// "LIVE" que llevaba antes cada fila: con la tarjeta de abajo diciendo qué
// juegas, repetirlo en la fila era ruido — pero quitarlo del todo dejaba la
// lista muerta mientras juegas. La tarjeta responde "qué estoy jugando"; esto
// responde "dónde está en mi biblioteca", que es otra pregunta.
//
// Sin borde ni barra lateral: eso es el vocabulario de la fila SELECCIONADA
// (SelectedOverlay) y confundirlos haría que "abierta" y "en marcha" se
// leyeran igual.
const LiveOverlay = (): React.JSX.Element => (
  <div
    className="pointer-events-none absolute inset-0 rounded-[10px]"
    style={{ background: `${GREEN}0f` }}
  />
);

const StatusSubtitle = ({ game }: { game: GameListItem }): React.JSX.Element => {
  const status = getGameStatusMeta(game.currentState);
  return (
    <>
      <StatusIcon meta={status} size={13} />
      <span className="truncate text-xs font-medium" style={{ color: status.color }}>
        {status.label}
      </span>
    </>
  );
};

type RowProps = {
  game: GameListItem;
  selected: boolean;
  onClick: () => void;
  subtitle: React.ReactNode;
  rightLabel: string;
  // Solo la fila seleccionada lo recibe — es el ancla para llevarla a la
  // vista (ver useSelectedRowScroll).
  rowRef?: (node: HTMLDivElement | null) => void;
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
  rowRef,
}: RowProps): React.JSX.Element => {
  return (
    // content-visibility:auto, el mismo remedio que la cola del Plan: esta
    // columna monta UNA FILA POR JUEGO sin lotes ni recorte, así que con una
    // biblioteca de cientos hay otras tantas carátulas maquetadas y pintadas
    // a la vez —encima de las de la pantalla que estés mirando, que tiene las
    // suyas—. Chromium se salta el trabajo de las que no caben en la columna
    // y el alto reservado (48 de carátula + 18 de padding) evita que la barra
    // de scroll baile mientras entran. loading="lazy" ya vive en GameCover.
    <div
      ref={rowRef}
      onClick={onClick}
      className="relative mb-0.5 flex cursor-pointer items-center gap-2.75 rounded-[10px] px-2.5 py-2.25 [contain-intrinsic-size:auto_66px] [content-visibility:auto] hover:bg-white/[0.04]"
    >
      {/* En marcha DEBAJO de la selección: si el juego que juegas es además
          el que tienes abierto, manda el marco de "estás aquí". */}
      {game.isLive && <LiveOverlay />}
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

// Búsqueda + filtros de una columna. El estado vive aquí, en el componente
// de la columna, igual que ya hacía el texto de búsqueda: al cambiar de
// sección MiddleColumn monta un componente distinto y se limpia solo, que es
// lo que uno espera (no volver a Sessions y encontrarse la lista recortada
// por algo que filtró en Stats hace media hora).
type ColumnFilters = {
  filters: GameFilters;
  setFilters: (next: GameFilters) => void;
  visible: GameListItem[];
  genres: string[];
};

const useColumnFilters = (games: GameListItem[], search: string): ColumnFilters => {
  const [filters, setFilters] = useState<GameFilters>(EMPTY_FILTERS);
  return {
    filters,
    setFilters,
    visible: applyFilters(filterByTitle(games, search), filters),
    // Los géneros salen de la lista COMPLETA, no de la ya buscada: si
    // dependieran del texto del buscador, los chips bailarían con cada
    // letra que se teclea.
    genres: availableGenres(games),
  };
};

// Los grupos que dependen de haber jugado (estado, horas) más los que son
// del juego en sí (banderas, década, género). Lo usan las tres columnas de
// biblioteca; Plan to Play se queda con un subconjunto.
const PLAYED_GROUPS: FilterGroup[] = ['status', 'flags', 'playtime', 'era', 'genre'];
// Las dos banderas son propiedades del JUEGO, no de cómo lo llevas. Aun así
// 'endless' no se ofrece en Plan to Play: createPlannedGame no lo fija, así
// que un juego planeado siempre es endless=false y el chip no devolvería
// nunca nada.
const PLAYED_FLAGS: FlagKey[] = ['endless', 'emulated'];

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
  const { filters, setFilters, visible: filtered, genres } = useColumnFilters(games, search);

  // Sección especial estilo Steam: lo que estás jugando o tienes en pausa,
  // arriba y plegable. Los juegos se MUEVEN aquí, no se duplican — el
  // listado general de abajo los excluye. Playing por delante de On Hold
  // (dentro de cada estado se conserva el orden que traiga `filtered`: el
  // sort de JS es estable, así que el criterio elegido en el panel manda
  // dentro de cada grupo y esto solo decide qué grupo va antes).
  const isActive = (game: GameListItem): boolean =>
    game.currentState === 'started' || game.currentState === 'on_hold';
  const activeGames = filtered
    .filter(isActive)
    .sort((a, b) =>
      a.currentState === b.currentState ? 0 : a.currentState === 'started' ? -1 : 1,
    );
  const restGames = filtered.filter((game) => !isActive(game));

  // Lo que se ve AHORA en el orden en que se pinta — un grupo plegado no
  // debe poder recorrerse con las flechas.
  const visibleGames =
    activeGames.length > 0
      ? [...(activeOpen ? activeGames : []), ...(restOpen ? restGames : [])]
      : restGames;
  const { attachSelectedRow, onKeyboardMove, onManualSelect } = useSelectedRowScroll(
    selectedId,
    visibleGames.length,
  );

  const renderRow = (game: GameListItem): React.JSX.Element => (
    <GameRow
      key={game.id}
      game={game}
      selected={game.id === selectedId}
      rowRef={game.id === selectedId ? attachSelectedRow : undefined}
      onClick={() => {
        onManualSelect(game.id);
        navigate(`/games/${game.id}`);
      }}
      subtitle={<StatusSubtitle game={game} />}
      rightLabel={formatHours(game.totalHours)}
    />
  );

  return (
    <MiddleColumnShell
      label="LIBRARY"
      sub={pluralize(games.length, 'game')}
      search={search}
      onSearchChange={setSearch}
      filters={
        <GameFilterPanel
          filters={filters}
          onChange={setFilters}
          groups={PLAYED_GROUPS}
          flags={PLAYED_FLAGS}
          sorts={['title', 'last-played', 'hours-desc', 'hours-asc', 'added-desc', 'release-desc']}
          genres={genres}
          shown={filtered.length}
          total={games.length}
        />
      }
      onArrowNavigate={(delta) => {
        const next = nextSelection(
          visibleGames.map((game) => game.id),
          selectedId,
          delta,
        );
        if (next === undefined) return;
        onKeyboardMove();
        navigate(`/games/${next}`);
      }}
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
  const { filters, setFilters, visible: filtered, genres } = useColumnFilters(games, search);
  const { attachSelectedRow, onKeyboardMove, onManualSelect } = useSelectedRowScroll(
    selectedId,
    filtered.length,
  );

  return (
    <MiddleColumnShell
      label="PLAN TO PLAY"
      sub={pluralize(games.length, 'game')}
      search={search}
      onSearchChange={setSearch}
      // Subconjunto a propósito: un juego planeado no se ha tocado, así que
      // estado, horas y "jugando ahora" darían siempre lo mismo. Queda lo
      // que sí distingue un planeado de otro — qué es y cuándo salió — y
      // "Recently added", que en una lista de deseos es el orden natural.
      filters={
        <GameFilterPanel
          filters={filters}
          onChange={setFilters}
          groups={['genre', 'era', 'flags']}
          flags={['emulated']}
          sorts={['title', 'added-desc', 'release-desc']}
          genres={genres}
          shown={filtered.length}
          total={games.length}
        />
      }
      onArrowNavigate={(delta) => {
        const next = nextSelection(
          filtered.map((game) => game.id),
          selectedId,
          delta,
        );
        if (next === undefined) return;
        onKeyboardMove();
        navigate(`/plan/${next}`);
      }}
    >
      <div className={revealClass} style={revealStyle(0)}>
        {filtered.map((game) => (
          <GameRow
            key={game.id}
            game={game}
            selected={game.id === selectedId}
            rowRef={game.id === selectedId ? attachSelectedRow : undefined}
            onClick={() => {
              onManualSelect(game.id);
              navigate(`/plan/${game.id}`);
            }}
            subtitle={<StatusSubtitle game={game} />}
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
  const { filters, setFilters, visible: filtered, genres } = useColumnFilters(games, search);
  const totalSessions = games.reduce((sum, game) => sum + game.sessionCount, 0);
  const gameParam = searchParams.get('game');
  const selectedId = gameParam ? Number(gameParam) : null;
  const { attachSelectedRow, onKeyboardMove, onManualSelect } = useSelectedRowScroll(
    selectedId,
    filtered.length,
  );

  return (
    <MiddleColumnShell
      label="SESSIONS"
      sub={pluralize(totalSessions, 'session')}
      search={search}
      onSearchChange={setSearch}
      filters={
        <GameFilterPanel
          filters={filters}
          onChange={setFilters}
          groups={PLAYED_GROUPS}
          flags={PLAYED_FLAGS}
          // "Most sessions" primero tras el alfabético: es la columna de
          // sesiones, ordenar por cuántas hay es su pregunta propia.
          sorts={['title', 'last-played', 'sessions-desc', 'hours-desc', 'added-desc']}
          genres={genres}
          shown={filtered.length}
          total={games.length}
        />
      }
      // null = la fila "All games", que también es seleccionable: subir desde
      // el primer juego llega hasta ella.
      onArrowNavigate={(delta) => {
        const next = nextSelection<number | null>(
          [null, ...filtered.map((game) => game.id)],
          selectedId,
          delta,
        );
        if (next === undefined) return;
        onKeyboardMove();
        setSearchParams(next === null ? {} : { game: String(next) });
      }}
    >
      <div className={revealClass} style={revealStyle(0)}>
        <AllGamesRow
          Icon={LayoutGrid}
          subtitle={pluralize(totalSessions, 'session')}
          selected={selectedId === null}
          onClick={() => {
            onManualSelect(null);
            setSearchParams({});
          }}
        />
        {filtered.map((game) => (
          <GameRow
            key={game.id}
            game={game}
            selected={game.id === selectedId}
            rowRef={game.id === selectedId ? attachSelectedRow : undefined}
            onClick={() => {
              onManualSelect(game.id);
              setSearchParams({ game: String(game.id) });
            }}
            subtitle={
              <span className="text-xs text-muted-foreground">
                {pluralize(game.sessionCount, 'session')}
              </span>
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
  const { filters, setFilters, visible: filtered, genres } = useColumnFilters(games, search);
  const gameParam = searchParams.get('game');
  const selectedId = gameParam ? Number(gameParam) : null;
  const { attachSelectedRow, onKeyboardMove, onManualSelect } = useSelectedRowScroll(
    selectedId,
    filtered.length,
  );

  return (
    <MiddleColumnShell
      label="STATISTICS"
      sub={pluralize(games.length, 'game')}
      search={search}
      onSearchChange={setSearch}
      filters={
        <GameFilterPanel
          filters={filters}
          onChange={setFilters}
          groups={PLAYED_GROUPS}
          flags={PLAYED_FLAGS}
          sorts={[
            'title',
            'last-played',
            'hours-desc',
            'hours-asc',
            'sessions-desc',
            'release-desc',
          ]}
          genres={genres}
          shown={filtered.length}
          total={games.length}
        />
      }
      onArrowNavigate={(delta) => {
        const next = nextSelection<number | null>(
          [null, ...filtered.map((game) => game.id)],
          selectedId,
          delta,
        );
        if (next === undefined) return;
        onKeyboardMove();
        setSearchParams(next === null ? {} : { game: String(next) });
      }}
    >
      <div className={revealClass} style={revealStyle(0)}>
        <AllGamesRow
          Icon={BarChart3}
          subtitle="Overview & charts"
          selected={selectedId === null}
          onClick={() => {
            onManualSelect(null);
            setSearchParams({});
          }}
        />
        {filtered.map((game) => (
          <GameRow
            key={game.id}
            game={game}
            selected={game.id === selectedId}
            rowRef={game.id === selectedId ? attachSelectedRow : undefined}
            onClick={() => {
              onManualSelect(game.id);
              setSearchParams({ game: String(game.id) });
            }}
            subtitle={<StatusSubtitle game={game} />}
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
