import { BookOpen, CalendarRange, ChevronRight, Clock3, Gamepad2, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { GameListItem, GeneratedMemorySummary } from '../../../shared/types';
import { useGames } from '../hooks/games';
import { useMemories } from '../hooks/memories';
import { useSessions } from '../hooks/sessions';
import { useStateEvents } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { useLiveTimer } from '../hooks/useLiveTimer';
import { formatElapsed, formatHours } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { useTvBackdrop } from './backdropContext';
import { useTvFocusable } from './focusContext';
import { forgetHome, recallHome, rememberHome } from './screenMemory';
import { tvRevealClass, tvRevealStyle } from './styles';
import { TvGameTile } from './TvGameTile';

// La pantalla de aterrizaje del modo TV (BIG-PICTURE.md §5.1): el juego
// "actual" como hero — el vivo si lo hay, si no el último jugado — con SU
// ÚLTIMA NOTA DE SESIÓN bien visible (el dato estrella para retomar), y
// estanterías debajo. Arriba/abajo cambia de fila, izquierda/derecha dentro
// de la fila: el estándar de las teles, sin inventos.
//
// La vida: el arte del hero deriva en Ken Burns lento, la luz del estado
// respira desde el canto izquierdo, la carátula flota como ficha física
// sobre su propio charco de luz, y el contenido entra en dos cascadas
// encadenadas (la sección primero, sus líneas después).

const HeroButton = ({
  label,
  icon,
  autoFocus = false,
  primary = false,
  onSelect,
  onFocusSpot,
}: {
  label: string;
  icon?: React.ReactNode;
  autoFocus?: boolean;
  // El botón protagonista (Play) lleva tinte verde en reposo: el ojo debe
  // aterrizar ahí antes incluso de que el foco lo encienda.
  primary?: boolean;
  onSelect: () => void;
  // Volver el foco a los botones devuelve el protagonismo al hero — el Home
  // avisa por aquí (misma pareja que TvGameTile.onFocusSpot).
  onFocusSpot?: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect, autoFocus });
  const onFocusSpotRef = useRef(onFocusSpot);
  useEffect(() => {
    onFocusSpotRef.current = onFocusSpot;
  });
  useEffect(() => {
    if (focused) onFocusSpotRef.current?.();
  }, [focused]);
  return (
    // scroll-mt desmedido a propósito: estos botones viven al PIE del hero,
    // y el scrollIntoView 'nearest' del motor de foco paraba en cuanto el
    // botón asomaba — el arte de arriba quedaba decapitado al volver de las
    // estanterías. Con el margen gigante, "enséñame el botón" significa
    // "enséñame el hero entero": el navegador clampa el scroll a 0.
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className="relative flex scroll-mt-[60em] items-center gap-[0.55em] rounded-full px-[1.6em] py-[0.65em] text-[0.95em] font-extrabold transition-[background-color,box-shadow,translate,color] duration-200 ease-[cubic-bezier(.22,1,.36,1)]"
      style={
        focused
          ? {
              background: '#2fdc7e',
              color: '#08240f',
              // El hairline interior superior es lo que hace el botón "mojado"
              // — cristal encendido, no plástico plano.
              boxShadow:
                '0 0.6em 2em rgba(47,220,126,.45), 0 0 0 3px rgba(47,220,126,.35), inset 0 1px 0 rgba(255,255,255,.4)',
              translate: '0 -0.18em',
            }
          : primary
            ? {
                // Base oscura bajo el tinte (sin blur — la fila entra con la
                // cascada de reveal y el blur no muestrea hasta el final).
                background:
                  'linear-gradient(180deg, rgba(47,220,126,.16), rgba(47,220,126,.1)), rgba(8,14,11,.6)',
                color: '#a7f3c9',
                boxShadow: 'inset 0 0 0 1px rgba(47,220,126,.4)',
              }
            : {
                background: 'rgba(12,16,14,.6)',
                color: 'var(--foreground)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)',
              }
      }
    >
      {icon}
      {label}
      {focused && (
        <>
          {/* Barrido de luz al recibir el foco, en su propio clip redondo:
              el botón no lleva overflow-hidden para que el halo exterior
              (que es sombra, no caja) respire libre. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
          >
            <span
              className="afterplay-tv-sheen absolute inset-y-0 left-0 w-[45%]"
              style={{
                background:
                  'linear-gradient(105deg, transparent, rgba(255,255,255,.5), transparent)',
              }}
            />
          </span>
          <span
            aria-hidden
            className="afterplay-tv-ring pointer-events-none absolute -inset-[2px] rounded-full"
            style={{ boxShadow: '0 0 1.6em rgba(47,220,126,.5)' }}
          />
        </>
      )}
    </button>
  );
};

const Shelf = ({
  title,
  accent,
  games,
  onOpen,
  revealIndex,
  live = false,
  autoFocusId = null,
  trailing,
  onFocusGame,
}: {
  title: string;
  accent: string;
  games: GameListItem[];
  onOpen: (game: GameListItem) => void;
  revealIndex: number;
  live?: boolean;
  // La carátula que debe heredar el foco al remontar (vuelta de una ficha,
  // ver screenMemory) — null en una visita normal.
  autoFocusId?: number | null;
  trailing?: React.ReactNode;
  // "El juego es la pantalla": el Home escucha qué carátula tiene el foco
  // para repintar el fondo y el titular con ELLA.
  onFocusGame?: (game: GameListItem) => void;
}): React.JSX.Element | null => {
  if (games.length === 0 && !trailing) return null;
  return (
    <section className={`min-w-0 ${tvRevealClass}`} style={tvRevealStyle(revealIndex)}>
      <div className="mb-[0.55em] flex items-center gap-[0.7em]">
        {/* El piloto de la estantería: en la fila viva late (anillo) y además
            respira un halo — dos ritmos distintos, como un LED de verdad. */}
        <span className="relative h-[0.45em] w-[0.45em] flex-none">
          {live && (
            <span
              aria-hidden
              className="afterplay-tv-glow absolute -inset-[0.35em] rounded-full"
              style={{ background: `radial-gradient(closest-side, ${accent}59, transparent)` }}
            />
          )}
          <span
            className={`absolute inset-0 rounded-full ${live ? 'afterplay-tv-ring' : ''}`}
            style={{ background: accent, boxShadow: `0 0 0.6em ${accent}99` }}
          />
        </span>
        <h2 className="text-[0.82em] font-extrabold tracking-[.16em] text-foreground/85">
          {title}
        </h2>
        {/* El recuento como chapa del color de la estantería: la cabecera
            dice cuánto hay antes de que empieces a desplazarte. */}
        {games.length > 0 && (
          <span
            className="rounded-full px-[0.55em] py-[0.1em] text-[0.6em] font-extrabold tabular-nums"
            style={{
              color: accent,
              background: `${accent}14`,
              boxShadow: `inset 0 0 0 1px ${accent}33`,
            }}
          >
            {games.length}
          </span>
        )}
        {/* La línea de luz arranca encendida y se apaga hacia la derecha —
            más viva que un hairline plano y sigue sin competir con el arte. */}
        <span
          className="h-px flex-1"
          style={{
            background: `linear-gradient(90deg, ${accent}66, ${accent}1a 45%, transparent)`,
          }}
        />
      </div>
      <ShelfRow>
        {games.map((game, index) => (
          <TvGameTile
            key={game.id}
            game={game}
            autoFocus={game.id === autoFocusId}
            revealIndex={index}
            onOpen={() => onOpen(game)}
            onFocusSpot={onFocusGame ? () => onFocusGame(game) : undefined}
          />
        ))}
        {trailing}
      </ShelfRow>
    </section>
  );
};

// La fila desplazable de una estantería. La rueda VERTICAL del ratón se
// traduce a scroll horizontal: Chromium no desplaza un contenedor
// solo-horizontal con la rueda, y sin esto un usuario de solo ratón no
// llegaba a las carátulas de fuera del viewport (ni al "See all" del final).
// Listener manual con passive:false — React registra wheel pasivo y el
// preventDefault (que evita que la página entera se desplace) no funcionaría.
const ShelfRow = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rowRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      // Un trackpad con desplazamiento horizontal de verdad ya funciona; solo
      // se traduce la rueda vertical, y solo si hay recorrido que hacer.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (element.scrollWidth <= element.clientWidth) return;
      element.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={rowRef}
      className="-mx-[0.6em] flex gap-[0.85em] overflow-x-auto px-[0.6em] pt-[0.6em] pb-[0.95em]"
      style={{ scrollbarWidth: 'none' }}
    >
      {children}
    </div>
  );
};

// "See all →" al final de la estantería de biblioteca: la puerta a la
// parrilla completa sin robarle el sitio a una carátula. Vestida como una
// invitación — moneda de luz con la flecha, recuento total debajo y barrido
// al enfocar — para que cruzar la puerta apetezca de verdad.
const SeeAllTile = ({
  onSelect,
  count,
}: {
  onSelect: () => void;
  count: number;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className="relative flex aspect-[264/374] w-[7.2em] flex-none flex-col items-center justify-center gap-[0.5em] overflow-hidden rounded-[0.55em] text-[0.75em] font-bold transition-[box-shadow,background-color,translate,color] duration-200 ease-[cubic-bezier(.22,1,.36,1)]"
      style={
        focused
          ? {
              background: 'rgba(47,220,126,.1)',
              color: '#2fdc7e',
              // Nada fuera del marco — como las carátulas vecinas: ni halo
              // de color ni sombra de elevación (mancha gris en el backdrop).
              boxShadow: 'inset 0 0 0 3px rgba(47,220,126,.8)',
              // La misma elevación que las carátulas vecinas: la fila entera
              // habla el mismo idioma al recibir el foco.
              translate: '0 -0.22em',
            }
          : {
              background: 'linear-gradient(160deg, rgba(255,255,255,.05), rgba(255,255,255,.02))',
              color: 'var(--muted-foreground)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1)',
            }
      }
    >
      {/* La flecha en su moneda: al enfocar se tiñe de verde y empuja un
          pelín hacia la derecha — el gesto de "por aquí". */}
      <span
        className="flex h-[2.3em] w-[2.3em] items-center justify-center rounded-full transition-[background-color,box-shadow,translate] duration-200"
        style={
          focused
            ? {
                background: 'rgba(47,220,126,.16)',
                boxShadow: 'inset 0 0 0 1px rgba(47,220,126,.5)',
                translate: '0.18em 0',
              }
            : {
                background: 'rgba(255,255,255,.06)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.12)',
              }
        }
      >
        <ChevronRight className="h-[1.25em] w-[1.25em]" />
      </span>
      See all
      <span
        className="text-[0.72em] font-semibold tabular-nums transition-colors duration-200"
        style={{ color: focused ? 'rgba(47,220,126,.8)' : 'rgba(136,143,138,.7)' }}
      >
        {count} {count === 1 ? 'game' : 'games'}
      </span>
      {/* El barrido vive directamente en el botón: su overflow-hidden ya
          hace de clip. */}
      {focused && (
        <span
          aria-hidden
          className="afterplay-tv-sheen pointer-events-none absolute inset-y-0 left-0 w-[45%]"
          style={{
            background: 'linear-gradient(105deg, transparent, rgba(255,255,255,.14), transparent)',
          }}
        />
      )}
    </button>
  );
};

// La puerta al Journey al pie del Home: el recap más reciente del Loop en
// una tarjeta violeta (violeta = memoria, como en toda la casa) que con A
// abre el libro entero. La historia generada deja de vivir escondida en su
// pantalla: te sale al paso.
const RecapDoor = ({
  recap,
  label,
  onSelect,
}: {
  recap: GeneratedMemorySummary;
  label: string;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      className={`relative w-full flex-none overflow-hidden rounded-[0.7em] px-[1.2em] py-[0.85em] text-left transition-[box-shadow,background-color,translate] duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${tvRevealClass}`}
      style={{
        ...tvRevealStyle(7),
        background: focused
          ? 'linear-gradient(125deg, rgba(124,134,200,.22), rgba(124,134,200,.08) 55%, rgba(11,13,12,.85))'
          : 'linear-gradient(125deg, rgba(124,134,200,.12), rgba(124,134,200,.04) 55%, rgba(11,13,12,.8))',
        boxShadow: focused
          ? 'inset 0 0 0 2px rgba(124,134,200,.7), 0 0.5em 1.6em rgba(0,0,0,.4)'
          : 'inset 0 0 0 1px rgba(255,255,255,.08)',
        translate: focused ? '0 -0.15em' : undefined,
      }}
    >
      {focused && (
        <>
          <span
            aria-hidden
            className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-[0.7em]"
            style={{ boxShadow: 'inset 0 0 0 2px rgba(124,134,200,.85)' }}
          />
          <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <span
              className="afterplay-tv-sheen absolute inset-y-0 left-0 w-[40%]"
              style={{
                background:
                  'linear-gradient(105deg, transparent, rgba(255,255,255,.1), transparent)',
              }}
            />
          </span>
        </>
      )}
      <div className="relative flex items-center gap-[0.45em] text-[0.55em] font-extrabold tracking-[.2em] text-[#a3abd8]/90">
        <BookOpen className="h-[1.2em] w-[1.2em]" />
        YOUR STORY · {label}
      </div>
      <div className="relative mt-[0.3em] flex items-baseline gap-[1em]">
        <div className="min-w-0">
          <div className="truncate text-[0.95em] font-extrabold tracking-[-.01em]">
            {recap.payload.headline}
          </div>
          <p className="mt-[0.2em] line-clamp-2 max-w-[85%] text-[0.68em] leading-relaxed text-muted-foreground">
            {recap.payload.narrative}
          </p>
        </div>
        <span
          className="ml-auto flex flex-none items-center gap-[0.3em] text-[0.62em] font-bold whitespace-nowrap transition-colors duration-200"
          style={{ color: focused ? '#c3cbf2' : 'rgba(163,171,216,.5)' }}
        >
          Open journey
          <ChevronRight className="h-[1.1em] w-[1.1em]" />
        </span>
      </div>
    </button>
  );
};

export const TvHome = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [] } = useGames();
  const { data: sessions = [] } = useSessions();
  const [launching, setLaunching] = useState(false);
  // La vuelta de una ficha aterriza donde estabas (screenMemory): scroll
  // restaurado antes del primer paint y el foco en la carátula que abriste
  // (si vive en alguna estantería; desde el hero, el Play de siempre).
  const [snapshot] = useState(recallHome);
  useEffect(() => {
    forgetHome();
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (snapshot && scrollRef.current) scrollRef.current.scrollTop = snapshot.scrollTop;
  }, [snapshot]);
  // ¿La carátula restaurada vive en alguna estantería? Si sí, ELLA hereda el
  // foco y los botones del hero no deben reclamarlo antes (se registran
  // primero en el árbol y ganarían la carrera del autoFocus).
  const restoredFocusId = snapshot?.focusGameId ?? null;

  // El protagonista: el juego vivo ahora mismo, o el último tocado.
  const hero = useMemo(() => {
    const live = games.find((game) => game.isLive);
    if (live) return live;
    return games
      .filter((game) => game.lastPlayedAt !== null)
      .sort((a, b) => (b.lastPlayedAt?.getTime() ?? 0) - (a.lastPlayedAt?.getTime() ?? 0))[0];
  }, [games]);

  // EL FOCO PINTA LA PANTALLA: el protagonista ya no es fijo — es el juego
  // bajo el foco de las estanterías (via onFocusSpot), y el hero de siempre
  // cuando el foco está en los botones o acabas de entrar. Mover el d-pad
  // repinta el fondo ENTERO, el titular y la nota: la sala es el juego que
  // estás mirando, como en una consola de verdad.
  const [spotId, setSpotId] = useState<number | null>(null);
  const spot = useMemo(
    () => games.find((game) => game.id === spotId) ?? hero,
    [games, spotId, hero],
  );

  // La última nota de sesión del protagonista — "dónde lo dejé", dicho por ti.
  const spotNote = useMemo(() => {
    if (!spot) return null;
    const withNote = sessions
      .filter((session) => session.gameId === spot.id && (session.note?.trim().length ?? 0) > 0)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    return withNote?.note?.trim() ?? null;
  }, [sessions, spot]);

  const spotImage = useImageSrc(spot?.heroUrl ?? null, 'heroes');
  const spotCoverBackdrop = useImageSrc(spot?.coverUrl ?? null, 'covers');
  // El fondo del modo entero ES el arte del protagonista.
  useTvBackdrop(spotImage ?? spotCoverBackdrop);
  const liveSeconds = useLiveTimer(spot?.isLive ? (spot.liveSince ?? null) : null);

  const playing = useMemo(
    () =>
      games
        .filter((game) => game.currentState === 'started' && game.id !== hero?.id)
        .sort((a, b) => (b.lastPlayedAt?.getTime() ?? 0) - (a.lastPlayedAt?.getTime() ?? 0))
        .slice(0, 12),
    [games, hero],
  );
  const recent = useMemo(
    () =>
      games
        .filter(
          (game) =>
            game.lastPlayedAt !== null && game.id !== hero?.id && game.currentState !== 'started',
        )
        .sort((a, b) => (b.lastPlayedAt?.getTime() ?? 0) - (a.lastPlayedAt?.getTime() ?? 0))
        .slice(0, 12),
    [games, hero],
  );
  const shelf = useMemo(
    () =>
      games
        .slice()
        .sort((a, b) => b.totalHours - a.totalHours)
        .slice(0, 10),
    [games],
  );

  // TERMINADOS hace poco: la fecha sale del último evento 'completed' de
  // cada juego — currentState solo dice "está completado", no cuándo.
  const { data: stateEvents = [] } = useStateEvents();
  const finished = useMemo(() => {
    const lastCompleted = new Map<number, number>();
    for (const event of stateEvents) {
      if (event.type !== 'completed') continue;
      const time = event.occurredAt.getTime();
      if (time > (lastCompleted.get(event.gameId) ?? 0)) lastCompleted.set(event.gameId, time);
    }
    return games
      .filter((game) => game.currentState === 'completed' && lastCompleted.has(game.id))
      .sort((a, b) => (lastCompleted.get(b.id) ?? 0) - (lastCompleted.get(a.id) ?? 0))
      .slice(0, 12);
  }, [games, stateEvents]);

  // Los números DEL MES en curso: la sala también cuenta lo que llevas.
  const monthStats = useMemo(() => {
    const now = new Date();
    const rows = sessions.filter(
      (session) =>
        session.endedAt !== null &&
        session.startedAt.getMonth() === now.getMonth() &&
        session.startedAt.getFullYear() === now.getFullYear(),
    );
    const seconds = rows.reduce((sum, session) => sum + (session.durationSec ?? 0), 0);
    return {
      hours: seconds / 3600,
      count: rows.length,
      games: new Set(rows.map((session) => session.gameId)).size,
      label: now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase(),
    };
  }, [sessions]);

  // El último recap del Loop como puerta al Journey: la historia que la IA
  // ya escribió, asomando en el salón.
  const { data: memories = [] } = useMemories();
  const latestRecap = useMemo(() => {
    const months = memories.filter((memory) => memory.scopeType === 'month');
    return months.sort((a, b) => b.scopeKey.localeCompare(a.scopeKey))[0] ?? null;
  }, [memories]);
  const recapLabel = useMemo(() => {
    if (!latestRecap) return null;
    const [year, month] = latestRecap.scopeKey.split('-').map(Number);
    if (!year || !month) return null;
    return new Date(year, month - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      .toUpperCase();
  }, [latestRecap]);

  const hasRestoredTile =
    restoredFocusId !== null &&
    [playing, recent, finished, shelf].some((list) =>
      list.some((game) => game.id === restoredFocusId),
    );

  const openGame = (game: GameListItem): void => {
    // El billete de vuelta: solo el viaje a la ficha guarda el sitio.
    rememberHome({
      scrollTop: scrollRef.current?.scrollTop ?? 0,
      focusGameId: game.id,
    });
    void navigate(`/tv/game/${game.id}`);
  };

  const launchSpot = async (): Promise<void> => {
    if (!spot?.executablePath || launching) return;
    setLaunching(true);
    const result = await window.api.games.launchExecutable(spot.executablePath);
    if (!result.ok) {
      toast.error(
        result.reason === 'missing'
          ? 'That executable is gone — set it again from your desk.'
          : 'Could not launch the game.',
      );
    }
    // El overlay se disuelve solo: si el juego arrancó, ya está delante.
    setTimeout(() => setLaunching(false), 2_500);
  };

  if (games.length === 0) {
    // El vacío también tiene alma: un mando flotando sobre su charco de luz,
    // como esperando a que alguien lo recoja, y el texto entrando en cascada.
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className={`relative mb-[1.3em] ${tvRevealClass}`} style={tvRevealStyle(0)}>
          {/* El charco se queda quieto mientras el mando flota: es el
              contraste entre ambos lo que vende la levitación. */}
          <span
            aria-hidden
            className="afterplay-tv-glow absolute -bottom-[0.8em] left-1/2 h-[1.1em] w-[5em] -translate-x-1/2 rounded-[50%]"
            style={{
              background: 'radial-gradient(closest-side, rgba(47,220,126,.35), transparent 72%)',
              filter: 'blur(5px)',
            }}
          />
          <div
            className="afterplay-tv-float flex h-[3.8em] w-[3.8em] items-center justify-center rounded-full"
            style={{
              background: 'rgba(255,255,255,.05)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.12), 0 0.9em 2em rgba(0,0,0,.45)',
            }}
          >
            <Gamepad2 className="h-[1.7em] w-[1.7em] text-[#2fdc7e]" />
          </div>
        </div>
        <div className={`text-[1.15em] font-extrabold ${tvRevealClass}`} style={tvRevealStyle(1)}>
          Your shelves are waiting
        </div>
        <div
          className={`mt-[0.45em] max-w-[26em] text-[0.8em] leading-relaxed text-muted-foreground ${tvRevealClass}`}
          style={tvRevealStyle(2)}
        >
          Add games from the desktop app — press F11 to switch back.
        </div>
      </div>
    );
  }

  const spotStatus = spot ? getGameStatusMeta(spot.currentState) : null;

  return (
    // Dos pisos: el TITULAR va clavado (el nombre del juego que es la
    // pantalla no se va con el scroll — al bajar a la segunda estantería se
    // decapitaba el chip) y solo las ESTANTERÍAS scrollean debajo.
    <div className="flex h-full flex-col">
      {spot && spotStatus && (
        // EL TITULAR FLOTANTE: sin caja, sin marco, sin carátula al lado —
        // el arte del protagonista ya ES la pantalla entera (lo pinta el
        // backdrop del layout) y aquí solo flota su nombre a tamaño de
        // cartel, con su estado y sus botones. Legibilidad: el scrim lateral
        // del layout + las sombras del propio texto.
        <section
          className={`flex min-h-[13.5em] flex-none flex-col justify-center gap-[0.55em] pt-[0.5em] ${tvRevealClass}`}
          style={tvRevealStyle(0)}
        >
          {/* El contenido cambia con el foco: cada juego entra con un fundido
              corto (key), no con la cascada entera — repintar no es re-entrar. */}
          <div
            key={spot.id}
            className="animate-in fade-in-0 flex flex-col gap-[0.55em] duration-400"
          >
            {spot.isLive ? (
              <div
                className="flex items-center gap-[0.55em] self-start rounded-full px-[0.9em] py-[0.4em] text-[0.68em] font-extrabold tracking-[.18em] text-[#2fdc7e]"
                style={{
                  background: 'rgba(47,220,126,.12)',
                  boxShadow: 'inset 0 0 0 1px rgba(47,220,126,.4), 0 0 1.6em rgba(47,220,126,.15)',
                }}
              >
                {/* El punto late con DOS ritmos: el anillo (2.2s) y un halo
                      que respira (2.6s) — desincronizados a propósito, como
                      un pulso de verdad. */}
                <span className="relative h-[0.6em] w-[0.6em] flex-none">
                  <span
                    aria-hidden
                    className="afterplay-tv-glow absolute -inset-[0.4em] rounded-full"
                    style={{
                      background: 'radial-gradient(closest-side, rgba(47,220,126,.6), transparent)',
                    }}
                  />
                  <span className="afterplay-tv-ring absolute inset-0 rounded-full bg-[#2fdc7e] shadow-[0_0_0.7em_#2fdc7e]" />
                </span>
                PLAYING NOW
                <span aria-hidden className="h-[0.9em] w-px bg-[#2fdc7e]/30" />
                <span className="tabular-nums">{formatElapsed(liveSeconds)}</span>
              </div>
            ) : (
              <div
                className="flex items-center gap-[0.5em] self-start rounded-full px-[0.85em] py-[0.4em] text-[0.68em] font-extrabold tracking-[.18em]"
                style={{
                  color: spotStatus.color,
                  background: `${spotStatus.color}1f`,
                  boxShadow: `inset 0 0 0 1px ${spotStatus.color}4d`,
                }}
              >
                <spotStatus.Icon className="h-[1.15em] w-[1.15em]" />
                {spotStatus.label.toUpperCase()}
              </div>
            )}
            {/* El titular a tamaño de CARTEL — la tipografía más grande de
                toda la casa, porque este nombre es la pantalla entera. Plata
                degradada con clip al texto; la sombra va en filter, que sí
                funciona con texto transparente. */}
            <h1
              className="max-w-[12em] text-[3em] leading-[1.02] font-extrabold tracking-[-.02em]"
              style={{
                backgroundImage: 'linear-gradient(180deg, #ffffff 52%, rgba(255,255,255,.66))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 2px 20px rgba(0,0,0,.65))',
              }}
            >
              {spot.title}
            </h1>

            <div className="flex items-center gap-[1.1em] text-[0.78em] font-semibold text-white/75">
              {spot.totalHours > 0 && (
                <span className="flex items-center gap-[0.4em] tabular-nums">
                  <Clock3 className="h-[1.05em] w-[1.05em]" style={{ color: '#2fdc7e' }} />
                  {formatHours(spot.totalHours)}
                </span>
              )}
              {spot.sessionCount > 0 && (
                <span className="flex items-center gap-[0.4em] tabular-nums">
                  <CalendarRange className="h-[1.05em] w-[1.05em]" style={{ color: '#85a3d6' }} />
                  {spot.sessionCount} sessions
                </span>
              )}
            </div>

            {/* La nota con el filo del color del estado: es SU recuerdo,
                teñido de dónde está ese juego en tu vida. */}
            {spotNote && (
              <p
                className="max-w-[46%] border-l-2 pl-[0.85em] text-[0.85em] leading-relaxed text-white/85 italic"
                style={{
                  borderColor: `${spotStatus.color}66`,
                  textShadow: '0 1px 12px rgba(0,0,0,.6)',
                }}
              >
                “{spotNote}”
              </p>
            )}
          </div>

          {/* Los botones viven FUERA del bloque keyed: persisten entre
              cambios de protagonista (remontarlos a cada golpe de d-pad
              haría parpadear el foco) y actúan siempre sobre `spot`. */}
          <div
            className={`mt-[0.45em] flex items-center gap-[0.8em] ${tvRevealClass}`}
            style={tvRevealStyle(2)}
          >
            {/* Con el juego CORRIENDO no hay botón de lanzar (el pill de
                PLAYING NOW de arriba ya cuenta la sesión en vivo): Play
                sobre un juego abierto lo relanzaría. */}
            {spot.executablePath && !spot.isLive && (
              <HeroButton
                label={launching ? 'Launching…' : 'Play'}
                icon={<Play className="h-[1em] w-[1em]" fill="currentColor" />}
                autoFocus={!hasRestoredTile}
                primary
                onSelect={() => void launchSpot()}
                onFocusSpot={() => setSpotId(null)}
              />
            )}
            <HeroButton
              label="Details"
              autoFocus={(!spot.executablePath || spot.isLive) && !hasRestoredTile}
              onSelect={() => openGame(spot)}
              onFocusSpot={() => setSpotId(null)}
            />
          </div>
        </section>
      )}

      {/* El piso de las estanterías — el único que scrollea. El -mx/px es el
          mismo truco que ShelfRow: este contenedor es quien RECORTA
          (overflow-y-auto también recorta en X), y con el clip justo en el
          borde los pilotos de las estanterías aparecían con el halo cortado
          por la izquierda. */}
      <div
        ref={scrollRef}
        className="-mx-[1em] flex min-h-0 flex-1 flex-col gap-[1.15em] overflow-y-auto px-[1em] pb-[1.5em]"
        style={{ scrollbarWidth: 'none' }}
      >
        {/* Los números del mes: una línea de sala, no un panel de contables —
          solo aparece cuando el mes ya cuenta algo. */}
        {monthStats.count > 0 && (
          <div
            className={`flex flex-none flex-wrap items-baseline gap-x-[0.9em] gap-y-[0.2em] px-[0.2em] text-[0.7em] font-semibold text-white/45 ${tvRevealClass}`}
            style={tvRevealStyle(2)}
          >
            <span className="font-extrabold tracking-[.2em] text-white/35">
              {monthStats.label} SO FAR
            </span>
            <span>
              <span className="font-extrabold text-[#2fdc7e]">{formatHours(monthStats.hours)}</span>{' '}
              played
            </span>
            <span className="text-white/25">·</span>
            <span>
              <span className="font-extrabold text-[#85a3d6] tabular-nums">{monthStats.count}</span>{' '}
              {monthStats.count === 1 ? 'session' : 'sessions'}
            </span>
            <span className="text-white/25">·</span>
            <span>
              <span className="font-extrabold text-[#7c86c8] tabular-nums">{monthStats.games}</span>{' '}
              {monthStats.games === 1 ? 'game' : 'games'}
            </span>
          </div>
        )}

        <Shelf
          title="PLAYING NOW"
          accent="#2fdc7e"
          live
          games={playing}
          onOpen={openGame}
          autoFocusId={restoredFocusId}
          revealIndex={3}
          onFocusGame={(game) => setSpotId(game.id)}
        />
        <Shelf
          title="RECENTLY PLAYED"
          accent="#85a3d6"
          games={recent}
          onOpen={openGame}
          autoFocusId={restoredFocusId}
          revealIndex={4}
          onFocusGame={(game) => setSpotId(game.id)}
        />
        <Shelf
          title="RECENTLY FINISHED"
          accent="#e3b24a"
          games={finished}
          onOpen={openGame}
          autoFocusId={restoredFocusId}
          revealIndex={5}
          onFocusGame={(game) => setSpotId(game.id)}
        />
        <Shelf
          title="YOUR LIBRARY"
          accent="#7c86c8"
          games={shelf}
          onOpen={openGame}
          autoFocusId={restoredFocusId}
          revealIndex={6}
          onFocusGame={(game) => setSpotId(game.id)}
          trailing={
            <SeeAllTile count={games.length} onSelect={() => void navigate('/tv/library')} />
          }
        />

        {/* La puerta al Journey: el último recap del Loop asomando en el
          salón — la historia YA escrita invita a hojear el libro entero. */}
        {latestRecap && recapLabel && (
          <RecapDoor
            recap={latestRecap}
            label={recapLabel}
            onSelect={() => void navigate('/tv/journey')}
          />
        )}
      </div>
    </div>
  );
};
