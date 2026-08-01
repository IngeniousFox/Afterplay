import { BookOpen, CalendarRange, ChevronRight, Clock3, Gamepad2, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { GameListItem, GeneratedMemorySummary } from '../../../shared/types';
import { GameCover } from '../components/GameCover';
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
  // Volver el foco aquí arriba devuelve el fondo al hero de la card.
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
  // Qué carátula tiene el foco — el Home reparte con ella el fondo del modo.
  onFocusGame?: (game: GameListItem) => void;
  // La carátula que debe heredar el foco al remontar (vuelta de una ficha,
  // ver screenMemory) — null en una visita normal.
  autoFocusId?: number | null;
  trailing?: React.ReactNode;
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

// La fila desplazable de una estantería.
//
// AQUÍ VIVÍA EL BUG DE LA RUEDA: esta fila capturaba la rueda VERTICAL y la
// traducía a scroll horizontal (con preventDefault) para que un usuario de
// ratón alcanzara las carátulas de fuera del viewport. El problema es que
// casi TODO el Home son estanterías, así que el puntero siempre estaba sobre
// una — y la página entera se quedaba inmóvil: con ratón no se podía bajar.
// Se va: la rueda vertical es del scroll de la página, punto. Lo horizontal
// sigue disponible y sin código nuestro — Chromium ya mapea Shift+rueda (y
// el desplazamiento horizontal del trackpad) al contenedor horizontal que
// haya bajo el cursor.
const ShelfRow = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    className="-mx-[0.6em] flex gap-[0.85em] overflow-x-auto px-[0.6em] pt-[0.6em] pb-[0.95em]"
    style={{ scrollbarWidth: 'none' }}
  >
    {children}
  </div>
);

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
      // scroll-my: el conductor de scroll respeta scroll-margin (ver
      // glideIntoView), así que esta tarjeta nunca queda pegada al borde del
      // clip — el levantamiento del foco cabe dentro del margen en vez de
      // salirse por arriba.
      className={`relative w-full flex-none scroll-my-[0.9em] overflow-hidden rounded-[0.7em] px-[1.2em] py-[0.85em] text-left transition-[box-shadow,background-color,translate] duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${tvRevealClass}`}
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

  // La última nota de sesión del hero — "dónde lo dejé", dicho por ti.
  const heroNote = useMemo(() => {
    if (!hero) return null;
    const withNote = sessions
      .filter((session) => session.gameId === hero.id && (session.note?.trim().length ?? 0) > 0)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    return withNote?.note?.trim() ?? null;
  }, [sessions, hero]);

  const heroImage = useImageSrc(hero?.heroUrl ?? null, 'heroes');
  const heroCoverBackdrop = useImageSrc(hero?.coverUrl ?? null, 'covers');

  // EL FONDO SIGUE AL FOCO: el arte de pantalla completa es el del juego que
  // estás SEÑALANDO en las estanterías, no el del protagonista fijo — mover
  // el d-pad repinta la sala entera. La card de arriba no se mueve: sigue
  // siendo el hero (el juego vivo o el último tocado). Al volver el foco a
  // sus botones, el fondo vuelve con él (spotId a null).
  const [spotId, setSpotId] = useState<number | null>(null);
  const spotGame = useMemo(
    () => games.find((game) => game.id === spotId) ?? hero,
    [games, spotId, hero],
  );
  const spotHeroSrc = useImageSrc(spotGame?.heroUrl ?? null, 'heroes');
  const spotCoverSrc = useImageSrc(spotGame?.coverUrl ?? null, 'covers');
  useTvBackdrop(spotHeroSrc ?? spotCoverSrc);
  const liveSeconds = useLiveTimer(hero?.isLive ? (hero.liveSince ?? null) : null);

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

  const launchHero = async (): Promise<void> => {
    if (!hero?.executablePath || launching) return;
    setLaunching(true);
    const result = await window.api.games.launchExecutable(hero.executablePath);
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

  const heroStatus = hero ? getGameStatusMeta(hero.currentState) : null;

  return (
    // El -mx/px es el mismo truco que ShelfRow: este contenedor es quien
    // RECORTA (overflow-y-auto también recorta en X), y con el clip justo en
    // el borde del contenido los pilotos de las estanterías aparecían con el
    // halo CORTADO por la izquierda. Empujar el clip 1em hacia fuera les da
    // aire — el padding del layout (4vw) lo absorbe de sobra.
    <div
      ref={scrollRef}
      // El pt/-mt es el COLCHÓN del clip: sin él, la card del hero se apoya
      // en el borde exacto donde recorta el contenedor, y como el foco
      // levanta lo enfocado unos píxeles (translate) el borde de arriba
      // asomaba fuera y se veía cortado. El margen negativo devuelve el
      // colchón para que la composición no baje.
      className="-mx-[1em] -mt-[0.55em] flex h-full flex-col gap-[1.15em] overflow-y-auto px-[1em] pt-[0.55em] pb-[1.5em]"
      style={{ scrollbarWidth: 'none' }}
    >
      {hero && heroStatus && (
        <section
          className={`relative min-h-[18em] flex-none overflow-hidden rounded-[0.85em] border border-white/[0.09] ${tvRevealClass}`}
          style={{
            ...tvRevealStyle(0),
            // Solo el hairline de luz de arriba. La sombra de elevación
            // (0 1.6em 3.2em negro) se fue: es la MISMA lección que ya
            // aprendieron las carátulas — una sombra negra muy difuminada
            // sobre el backdrop no se lee como profundidad, se lee como una
            // mancha gris rodeando la card. Fuera del marco, nada.
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)',
          }}
        >
          {/* Hero art con deriva Ken Burns; sin él, la carátula ampliada y
              difuminada (el truco del modo ambiente: borrosa, la resolución
              da igual). */}
          {heroImage ? (
            <img
              src={heroImage}
              alt=""
              className="afterplay-tv-hero-art absolute inset-0 h-full w-full object-cover"
              // El arte se oscurece EN ORIGEN, no con un velo encima: un
              // negro translúcido sobre un arte claro (Pragmata, Forza) da
              // gris lavado por definición — era el "fondo gris raro" de la
              // card. Bajando el brillo de la propia imagen, el arte claro
              // se vuelve arte oscuro y el color se conserva.
              style={{ filter: 'saturate(1.28) contrast(1.08) brightness(.6)' }}
            />
          ) : heroCoverBackdrop ? (
            <img
              src={heroCoverBackdrop}
              alt=""
              className="afterplay-tv-hero-art absolute inset-0 h-full w-full object-cover blur-lg brightness-[.55]"
            />
          ) : null}
          {/* El scrim, ahora LIGERO: solo tiene que dar fondo al texto de la
              izquierda y fundir el canto derecho. El trabajo pesado lo hace
              el brightness del arte de arriba — apilar velo sobre velo era
              lo que grisaba la card entera. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(9,11,10,.94) 0%, rgba(9,11,10,.66) 42%, rgba(9,11,10,0) 70%, rgba(9,11,10,.55) 100%)',
            }}
          />
          {/* Vignette vertical suave: asienta el titular arriba y los botones
              abajo sin robarle color al arte. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(11,13,12,.32), transparent 32%, transparent 68%, rgba(11,13,12,.5))',
            }}
          />
          {/* La luz del estado, y SOLO la luz: un baño ancho del color
              respirando hacia el contenido. La barra sólida del canto se
              jubila — la card ya dice su estado tres veces (el chip, este
              baño y la franja de la carátula); una cuarta era ruido. */}
          <div
            aria-hidden
            className="afterplay-tv-glow absolute inset-y-0 left-0 w-[38%]"
            style={{ background: `linear-gradient(90deg, ${heroStatus.color}2e, transparent)` }}
          />

          <div className="relative flex h-full items-center gap-[1.8em] px-[2.2em] py-[1.6em]">
            {/* La carátula como ficha física — nace con pop, flota sobre un
                charco de luz del color del estado que se queda quieto: el
                contraste entre ambos es lo que vende la levitación. */}
            <div
              className="afterplay-tv-pop relative w-[8.5em] flex-none"
              style={{ animationDelay: '90ms' }}
            >
              <span
                aria-hidden
                className="afterplay-tv-glow absolute -bottom-[0.75em] left-1/2 h-[1.3em] w-[115%] -translate-x-1/2 rounded-[50%]"
                style={{
                  background: `radial-gradient(closest-side, ${heroStatus.color}4a, transparent 72%)`,
                  filter: 'blur(6px)',
                }}
              />
              <div
                className="afterplay-tv-float relative"
                style={{ filter: 'drop-shadow(0 1.2em 2.4em rgba(0,0,0,.6))' }}
              >
                <GameCover
                  url={hero.coverUrl}
                  className="aspect-[264/374] w-full overflow-hidden rounded-[0.5em] border border-white/20"
                  iconSize={30}
                />
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-[0.2em] rounded-b-[0.5em]"
                  style={{
                    background: heroStatus.color,
                    boxShadow: `0 0 0.9em ${heroStatus.color}aa`,
                  }}
                />
              </div>
            </div>

            {/* La columna de texto entra en su propia cascada, línea a línea:
                estado → título → cifras → nota → botones. Cine, no repintado. */}
            <div className="flex min-w-0 flex-1 flex-col gap-[0.55em]">
              {hero.isLive ? (
                <div
                  className={`flex items-center gap-[0.55em] self-start rounded-full px-[0.9em] py-[0.4em] text-[0.68em] font-extrabold tracking-[.18em] text-[#2fdc7e] ${tvRevealClass}`}
                  style={{
                    ...tvRevealStyle(1),
                    background: 'rgba(47,220,126,.12)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(47,220,126,.4), 0 0 1.6em rgba(47,220,126,.15)',
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
                        background:
                          'radial-gradient(closest-side, rgba(47,220,126,.6), transparent)',
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
                  className={`flex items-center gap-[0.5em] self-start rounded-full px-[0.85em] py-[0.4em] text-[0.68em] font-extrabold tracking-[.18em] ${tvRevealClass}`}
                  style={{
                    ...tvRevealStyle(1),
                    color: heroStatus.color,
                    background: `${heroStatus.color}14`,
                    boxShadow: `inset 0 0 0 1px ${heroStatus.color}40`,
                  }}
                >
                  <heroStatus.Icon className="h-[1.15em] w-[1.15em]" />
                  {heroStatus.label.toUpperCase()}
                </div>
              )}
              {/* El titular con gradiente de plata (clip al texto): coge luz
                  arriba y se apaga un punto abajo — tipografía de cartel, no
                  de formulario. La sombra va en filter, que sí funciona con
                  texto transparente. */}
              {/* El degradado va CLIPADO al texto, y ahí está la trampa: lo
                  que se pinta es el fondo de la CAJA recortado por los
                  glifos, así que todo lo que asome por debajo de la caja se
                  queda sin pintar — la "g" de Pragmata salía cortada. Con
                  leading apretado (1.05) el descendente caía justo fuera.
                  El pb + un pelo más de interlineado meten la caja por
                  debajo de la línea base y el rabito vuelve a existir. */}
              <h1
                className={`max-w-[80%] pb-[0.14em] text-[2.35em] leading-[1.16] font-extrabold tracking-[-.02em] ${tvRevealClass}`}
                style={{
                  ...tvRevealStyle(1),
                  backgroundImage: 'linear-gradient(180deg, #ffffff 52%, rgba(255,255,255,.66))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  filter: 'drop-shadow(0 2px 18px rgba(0,0,0,.55))',
                }}
              >
                {hero.title}
              </h1>

              <div
                className={`flex items-center gap-[1.1em] text-[0.74em] font-semibold text-white/70 ${tvRevealClass}`}
                style={tvRevealStyle(2)}
              >
                {hero.totalHours > 0 && (
                  <span className="flex items-center gap-[0.4em] tabular-nums">
                    <Clock3 className="h-[1.05em] w-[1.05em]" style={{ color: '#2fdc7e' }} />
                    {formatHours(hero.totalHours)}
                  </span>
                )}
                {hero.sessionCount > 0 && (
                  <span className="flex items-center gap-[0.4em] tabular-nums">
                    <CalendarRange className="h-[1.05em] w-[1.05em]" style={{ color: '#85a3d6' }} />
                    {hero.sessionCount} sessions
                  </span>
                )}
              </div>

              {/* La nota con el filo del color del estado: es SU recuerdo,
                  teñido de dónde está ese juego en tu vida. */}
              {heroNote && (
                <p
                  className={`max-w-[60%] border-l-2 pl-[0.85em] text-[0.85em] leading-relaxed text-white/80 italic ${tvRevealClass}`}
                  style={{ ...tvRevealStyle(2), borderColor: `${heroStatus.color}59` }}
                >
                  “{heroNote}”
                </p>
              )}

              <div
                className={`mt-[0.45em] flex items-center gap-[0.8em] ${tvRevealClass}`}
                style={tvRevealStyle(3)}
              >
                {/* Con el juego CORRIENDO no hay botón de lanzar (el pill de
                    PLAYING NOW de arriba ya cuenta la sesión en vivo): Play
                    sobre un juego abierto lo relanzaría. */}
                {hero.executablePath && !hero.isLive && (
                  <HeroButton
                    label={launching ? 'Launching…' : 'Play'}
                    icon={<Play className="h-[1em] w-[1em]" fill="currentColor" />}
                    autoFocus={!hasRestoredTile}
                    primary
                    onSelect={() => void launchHero()}
                    onFocusSpot={() => setSpotId(null)}
                  />
                )}
                <HeroButton
                  label="Details"
                  autoFocus={(!hero.executablePath || hero.isLive) && !hasRestoredTile}
                  onSelect={() => openGame(hero)}
                  onFocusSpot={() => setSpotId(null)}
                />
              </div>
            </div>
          </div>
        </section>
      )}

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
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={restoredFocusId}
        revealIndex={3}
      />
      <Shelf
        title="RECENTLY PLAYED"
        accent="#85a3d6"
        games={recent}
        onOpen={openGame}
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={restoredFocusId}
        revealIndex={4}
      />
      <Shelf
        title="RECENTLY FINISHED"
        accent="#e3b24a"
        games={finished}
        onOpen={openGame}
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={restoredFocusId}
        revealIndex={5}
      />
      <Shelf
        title="YOUR LIBRARY"
        accent="#7c86c8"
        games={shelf}
        onOpen={openGame}
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={restoredFocusId}
        revealIndex={6}
        trailing={<SeeAllTile count={games.length} onSelect={() => void navigate('/tv/library')} />}
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
  );
};
