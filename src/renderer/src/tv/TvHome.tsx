import { BookOpen, ChevronRight, Gamepad2, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { isLiveElsewhere } from '../../../shared/liveSession';
import type { GameListItem, GeneratedMemorySummary } from '../../../shared/types';
import { useDeviceContext } from '../hooks/devices';
import { useGames } from '../hooks/games';
import { useMemories } from '../hooks/memories';
import { useGameSessions, useSessionsInRange } from '../hooks/sessions';
import { useStateEvents } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { useLiveTimer } from '../hooks/useLiveTimer';
import { formatElapsed, formatHours } from '../lib/format';
import { statusKeyOf } from '../lib/gameFilters';
import { STATUS_META } from '../lib/gameStatus';
import { hasMeasuredDuration } from '../../../shared/domain/sessionMeasure';
import { useTvBackdrop } from './backdropContext';
import { useTvFocusable } from './focusContext';
import { forgetHome, recallHome, rememberHome } from './screenMemory';
import { tvFocusHalo, tvFocusMotion, tvFocusScale, tvRevealClass, tvRevealStyle } from './styles';
import { TvButton, TvCoverArt, TvFigure, TvLed } from './tvUi';
import { TvGameTile } from './TvGameTile';
import type { GameId } from '../../../shared/entityIds';

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

const Shelf = ({
  title,
  subtitle,
  games,
  onOpen,
  revealIndex,
  autoFocusId = null,
  trailing,
  onFocusGame,
}: {
  title: string;
  subtitle?: string;
  games: GameListItem[];
  onOpen: (game: GameListItem) => void;
  revealIndex: number;
  // Qué carátula tiene el foco — el Home reparte con ella el fondo del modo.
  onFocusGame?: (game: GameListItem) => void;
  // La carátula que debe heredar el foco al remontar (vuelta de una ficha,
  // ver screenMemory) — null en una visita normal.
  autoFocusId?: GameId | null;
  trailing?: React.ReactNode;
}): React.JSX.Element | null => {
  if (games.length === 0 && !trailing) return null;
  return (
    <section className={cn('min-w-0', tvRevealClass)} style={tvRevealStyle(revealIndex)}>
      {/* Cabecera de estantería como en tv.png: título en Barlow semibold y
          un apunte en Dust; el recuento, en cifra. */}
      <div className="flex items-baseline gap-[0.6em]">
        <h2 className="text-[1.15em] font-semibold text-bone">{title}</h2>
        {subtitle && <span className="text-[0.92em] text-dust">{subtitle}</span>}
        {games.length > 0 && (
          <span className="font-display text-[1.05em] font-bold text-dust tabular-nums">
            {games.length}
          </span>
        )}
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
//
// El colchón de 1.2em alrededor deja sitio al foco (escala 1.06 + halo) sin
// que el clip del scroll lo corte.
const ShelfRow = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    className="-mx-[1.2em] flex items-start gap-[0.9em] overflow-x-auto px-[1.2em] pt-[1em] pb-[0.6em]"
    style={{ scrollbarWidth: 'none' }}
  >
    {children}
  </div>
);

// "See all" al final de la estantería de biblioteca: la puerta a la parrilla
// completa sin robarle el sitio a una carátula. Placa Raised del tamaño de una
// portada, con el mismo foco.
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
      className={cn(
        'flex aspect-3/4 w-[7.2em] flex-none flex-col items-center justify-center gap-[0.4em] rounded-sm border border-line-strong bg-raised text-bone',
        tvFocusMotion,
        focused && ['border-phosphor', tvFocusHalo, tvFocusScale],
      )}
    >
      <ChevronRight className={cn('size-[1.6em]', focused ? 'text-phosphor' : 'text-dust')} />
      <span className="text-[1em] font-semibold">See all</span>
      <span className="text-[0.88em] text-dust tabular-nums">
        {count} {count === 1 ? 'game' : 'games'}
      </span>
    </button>
  );
};

// El cronómetro de PLAYING NOW en su propio componente: useLiveTimer vivía
// en la raíz de TvHome y su tick de 1s re-renderizaba el árbol entero — 49
// componentes POR SEGUNDO con el hero en vivo (medido con el harness de 994
// juegos contando fibers que trabajaron en cada commit). Aquí el tick
// re-renderiza SOLO este span: 1 componente. Mismo texto, misma clase —
// cero cambio visual.
const HeroLiveClock = ({ since }: { since: Date | null }): React.JSX.Element => {
  const seconds = useLiveTimer(since);
  return <span className="tabular-nums">{formatElapsed(seconds)}</span>;
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
      // clip — el halo del foco cabe dentro del margen.
      className={cn(
        'w-full flex-none scroll-my-[1.2em] rounded-md border border-l-[0.12em] border-line border-l-phosphor bg-panel px-[1.2em] py-[0.9em] text-left',
        tvFocusMotion,
        tvRevealClass,
        focused && ['bg-raised', tvFocusHalo],
      )}
      style={tvRevealStyle(6)}
    >
      <div className="flex items-center gap-[0.45em] text-[0.92em] font-semibold text-dust">
        <BookOpen className="size-[1.1em] text-phosphor" />
        Your story · {label}
      </div>
      <div className="mt-[0.3em] flex items-baseline gap-[1em]">
        <div className="min-w-0">
          <div className="font-display text-[1.6em] leading-tight font-bold text-bone">
            {recap.payload.headline}
          </div>
          <p className="mt-[0.25em] max-w-[52em] text-[0.95em] leading-relaxed text-dust">
            {recap.payload.narrative}
          </p>
        </div>
        <span
          className={cn(
            'ml-auto flex flex-none items-center gap-[0.3em] text-[0.92em] font-semibold whitespace-nowrap',
            focused ? 'text-phosphor' : 'text-dust',
          )}
        >
          Open journey
          <ChevronRight className="size-[1.1em]" />
        </span>
      </div>
    </button>
  );
};

export const TvHome = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [] } = useGames();
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

  // La última nota de sesión del hero — "dónde lo dejé", dicho por ti. Solo
  // hacen falta las sesiones de ESE juego (F-41).
  const { data: heroSessions = [] } = useGameSessions(hero?.id ?? null);
  const heroNote = useMemo(() => {
    if (!hero) return null;
    const withNote = heroSessions
      .filter((session) => session.gameId === hero.id && (session.note?.trim().length ?? 0) > 0)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    return withNote?.note?.trim() ?? null;
  }, [heroSessions, hero]);

  // §10.8: el protagonista puede estar en vivo en OTRO PC. Entonces el pill dice
  // dónde, y Play sigue ahí (una sesión por PC, §10.4): solo se esconde cuando
  // el juego corre en ESTE.
  const { thisDeviceId, nameOf } = useDeviceContext();
  const heroElsewhere = hero ? isLiveElsewhere(hero, thisDeviceId) : false;
  const heroOwnLive = hero !== undefined && hero.isLive && !heroElsewhere;
  const heroImage = useImageSrc(hero?.heroUrl ?? null, 'heroes');
  const heroCoverBackdrop = useImageSrc(hero?.coverUrl ?? null, 'covers');

  // EL FONDO SIGUE AL FOCO: el arte de pantalla completa es el del juego que
  // estás SEÑALANDO en las estanterías, no el del protagonista fijo — mover
  // el d-pad repinta la sala entera. La card de arriba no se mueve: sigue
  // siendo el hero (el juego vivo o el último tocado). Al volver el foco a
  // sus botones, el fondo vuelve con él (spotId a null).
  const [spotId, setSpotId] = useState<GameId | null>(null);
  const spotGame = useMemo(
    () => games.find((game) => game.id === spotId) ?? hero,
    [games, spotId, hero],
  );
  const spotHeroSrc = useImageSrc(spotGame?.heroUrl ?? null, 'heroes');
  const spotCoverSrc = useImageSrc(spotGame?.coverUrl ?? null, 'covers');
  useTvBackdrop(spotHeroSrc ?? spotCoverSrc);

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
    const lastCompleted = new Map<GameId, number>();
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
  //
  // hasMeasuredDuration y no "endedAt !== null" a secas: el predicado de la
  // casa descarta además las sesiones manuales del modelo antiguo, que pueden
  // llevar precisión de solo mes o año (ver lib/sessionStats). Sin él, una
  // fila heredada de 60 h fechada el día 1 hacía que el salón anunciara
  // "AUGUST SO FAR: 60h" mientras la barra de agosto de Hours per month, en
  // Stats, seguía a cero — dos pantallas de la misma app dando cifras
  // distintas del mismo mes.
  //
  // Solo las del mes en curso (F-41): el rango se fija al montar el salón.
  const [monthRange] = useState(() => {
    const today = new Date();
    return {
      from: new Date(today.getFullYear(), today.getMonth(), 1),
      to: new Date(today.getFullYear(), today.getMonth() + 1, 1),
    };
  });
  const { data: monthSessions = [] } = useSessionsInRange(monthRange);
  const monthStats = useMemo(() => {
    const now = new Date();
    const rows = monthSessions.filter(
      (session) =>
        hasMeasuredDuration(session) &&
        session.startedAt.getMonth() === now.getMonth() &&
        session.startedAt.getFullYear() === now.getFullYear(),
    );
    const seconds = rows.reduce((sum, session) => sum + (session.durationSec ?? 0), 0);
    return {
      hours: seconds / 3600,
      count: rows.length,
      games: new Set(rows.map((session) => session.gameId)).size,
      label: now.toLocaleDateString('en-US', { month: 'long' }),
    };
  }, [monthSessions]);

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
    return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }, [latestRecap]);

  const hasRestoredTile =
    restoredFocusId !== null &&
    [playing, recent, finished, shelf].some((list) =>
      list.some((game) => game.id === restoredFocusId),
    );

  // Sin hero (un backlog recién estrenado: nada vivo, nada jugado) los botones
  // del hero no se renderizan, así que su autoFocus nunca corre; y las baldas
  // solo autoenfocan el tile restaurado, que aquí es null. Resultado: una
  // pantalla de 3 metros sin NADA resaltado hasta la primera pulsación de
  // mando. Se cae al primer tile de la primera balda no vacía (mismo orden
  // visual que abajo). Solo cuando no hay hero ni tile restaurado: si el hero
  // existe, es él quien reclama el foco inicial y no hay que competir.
  const fallbackFocusId = useMemo(() => {
    if (hero || hasRestoredTile) return null;
    for (const list of [playing, recent, finished, shelf]) {
      if (list.length > 0) return list[0].id;
    }
    return null;
  }, [hero, hasRestoredTile, playing, recent, finished, shelf]);

  const shelfAutoFocusId = restoredFocusId ?? fallbackFocusId;

  // El billete de vuelta: solo el viaje a la ficha guarda el sitio.
  //
  // `focusOnReturn` NO es "el juego que abres", es DÓNDE debe caer el foco al
  // volver, y desde el hero tiene que ser null: el hero también sale abajo en
  // YOUR LIBRARY y en RECENTLY FINISHED (`shelf` y `finished` no lo filtran,
  // a diferencia de `playing` y `recent`). Guardando su id, hasRestoredTile
  // salía true al volver, los botones del hero perdían su autoFocus y se lo
  // llevaba esa carátula de abajo — y el glideIntoView del foco arrastraba el
  // scroll hasta la estantería, pisando el scrollTop que el useLayoutEffect
  // acababa de restaurar. Volvías a un sitio en el que nunca estuviste.
  //
  // El "sin pasar nada = el propio juego" se resuelve DENTRO del cuerpo, no
  // con un valor por defecto en la firma: `focusOnReturn = game.id` (default
  // que lee otro parámetro) es una MemberExpression no reordenable para el
  // React Compiler y le hacía saltarse TvHome ENTERO. Con la raíz sin
  // memoizar, cada cambio de spotId (cada movimiento de foco por las
  // estanterías) re-renderizaba el árbol otra vez: 50 componentes en ese
  // commit, 91 por pulsación sumando sus 3 commits. Compilado, la pulsación
  // baja a 41 — y 39 de esos son el fanout del contexto de foco, que vive en
  // focusContext.ts (medido con el harness de 994 juegos).
  const openGame = (game: GameListItem, focusOnReturn?: GameId | null): void => {
    rememberHome({
      scrollTop: scrollRef.current?.scrollTop ?? 0,
      focusGameId: focusOnReturn === undefined ? game.id : focusOnReturn,
    });
    void navigate(`/tv/game/${game.id}`);
  };

  const launchHero = async (): Promise<void> => {
    if (!hero?.executablePath || launching) return;
    setLaunching(true);
    const result = await window.api.games.launchExecutable(hero.id);
    if (!result.ok) {
      toast.error(
        result.reason === 'missing'
          ? 'That executable is gone — set it again from your desk.'
          : result.reason === 'not_installed'
            ? 'Not installed on this PC.'
            : 'Could not launch the game.',
      );
      // Al fallo, YA: el toast dice que no arrancó en el mismo instante, y
      // antes el botón seguía "Launching…" 2.5s más — una contradicción
      // visible entre lo que el aviso acaba de decir y lo que el botón sigue
      // afirmando, y de paso tragándose una segunda pulsación durante ese
      // rato. El retardo solo tiene sentido cuando SÍ arrancó.
      setLaunching(false);
      return;
    }
    // El overlay se disuelve solo: si el juego arrancó, ya está delante.
    setTimeout(() => setLaunching(false), 2_500);
  };

  if (games.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div
          className={cn(
            'mb-[1em] flex size-[3.6em] items-center justify-center rounded-md border border-line bg-panel bg-(image:--scan)',
            tvRevealClass,
          )}
          style={tvRevealStyle(0)}
        >
          <Gamepad2 className="size-[1.7em] text-phosphor" />
        </div>
        <div
          className={cn('font-display text-[2em] font-bold text-bone', tvRevealClass)}
          style={tvRevealStyle(1)}
        >
          Your shelves are waiting
        </div>
        <div
          className={cn('mt-[0.4em] max-w-[26em] text-[1em] text-dust', tvRevealClass)}
          style={tvRevealStyle(2)}
        >
          Add games from the desktop app — press F11 to switch back.
        </div>
      </div>
    );
  }

  const heroStatusKey = hero ? statusKeyOf(hero) : null;

  return (
    // El -mx/px es el mismo truco que ShelfRow: este contenedor es quien
    // RECORTA (overflow-y-auto también recorta en X), y con el clip justo en
    // el borde del contenido el halo del foco salía cortado. Empujar el clip
    // hacia fuera le da aire — el padding del layout (4vw) lo absorbe.
    <div
      ref={scrollRef}
      className="-mx-[1.2em] -mt-[0.6em] flex h-full flex-col gap-[1.3em] overflow-y-auto px-[1.2em] pt-[0.6em] pb-[1.5em]"
      style={{ scrollbarWidth: 'none' }}
    >
      {hero && heroStatusKey && (
        // El héroe de tv.png: banner con el arte a la derecha (protección
        // lateral y escaneo), el estado o "Playing now", el título enorme en
        // Big Shoulders, las cifras y las acciones.
        <section
          className={cn(
            'relative min-h-[13em] flex-none overflow-hidden rounded-md border border-line bg-panel',
            tvRevealClass,
          )}
          style={tvRevealStyle(0)}
        >
          {heroImage ? (
            <img
              src={heroImage}
              alt=""
              className="absolute inset-y-0 right-0 h-full w-[70%] object-cover opacity-80"
            />
          ) : heroCoverBackdrop ? (
            <img
              src={heroCoverBackdrop}
              alt=""
              className="absolute inset-y-0 right-0 h-full w-[70%] object-cover opacity-50 blur-lg"
            />
          ) : null}
          <div aria-hidden className="absolute inset-0 bg-(image:--scan)" />
          <div
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-panel)_30%,rgb(23_29_32/0.75)_55%,transparent_85%)]"
          />
          {hero.isLive && (
            <div aria-hidden className="absolute inset-0 bg-(image:--glow-ambient)" />
          )}

          <div className="relative flex h-full items-center gap-[1.8em] px-[1.8em] py-[1.4em]">
            <TvCoverArt game={hero} className="w-[7.4em] flex-none border border-line-strong" />

            <div className="flex min-w-0 flex-1 flex-col gap-[0.45em]">
              {hero.isLive ? (
                <div
                  className={cn(
                    'flex items-center gap-[0.5em] text-[1em] text-bone',
                    tvRevealClass,
                  )}
                  style={tvRevealStyle(1)}
                >
                  <span className="relative flex size-[0.55em] flex-none">
                    <span className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden" />
                    <span className="relative size-[0.55em] rounded-full bg-live" />
                  </span>
                  {heroElsewhere && hero.liveDeviceId
                    ? `Playing now on ${nameOf(hero.liveDeviceId)}`
                    : 'Playing now'}
                </div>
              ) : (
                <div
                  className={cn(
                    'flex items-center gap-[0.5em] text-[1em] text-bone',
                    tvRevealClass,
                  )}
                  style={tvRevealStyle(1)}
                >
                  <TvLed status={heroStatusKey} />
                  {STATUS_META[heroStatusKey].label}
                </div>
              )}
              <h1
                className={cn(
                  'max-w-[85%] font-display text-[3.6em] leading-[0.95] font-bold text-bone',
                  tvRevealClass,
                )}
                style={tvRevealStyle(1)}
              >
                {hero.title}
              </h1>

              <div
                className={cn('mt-[0.2em] flex items-baseline gap-[1.1em]', tvRevealClass)}
                style={tvRevealStyle(2)}
              >
                {hero.isLive && (
                  <span className="font-display text-[2.6em] leading-none font-bold text-phosphor [text-shadow:0_0_18px_rgb(255_179_71/0.35)]">
                    <HeroLiveClock since={hero.liveSince ?? null} />
                  </span>
                )}
                <span className="text-[1em] text-dust tabular-nums">
                  {[
                    hero.totalHours > 0 ? `${formatHours(hero.totalHours)} played` : null,
                    hero.sessionCount > 0
                      ? `${hero.sessionCount} ${hero.sessionCount === 1 ? 'session' : 'sessions'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>

              {/* La última nota de sesión: "dónde lo dejé", dicho por ti. */}
              {heroNote && (
                <p
                  className={cn(
                    'max-w-[42em] border-l-[0.12em] border-phosphor pl-[0.8em] text-[1em] leading-relaxed text-bone',
                    tvRevealClass,
                  )}
                  style={tvRevealStyle(2)}
                >
                  {heroNote}
                </p>
              )}

              <div
                className={cn('mt-[0.5em] flex items-center gap-[1em]', tvRevealClass)}
                style={tvRevealStyle(3)}
              >
                {/* Con el juego CORRIENDO aquí no hay botón de lanzar: Play
                    sobre un juego abierto lo relanzaría. El scroll-mt
                    desmedido es a propósito: estos botones viven al PIE del
                    hero, y "enséñame el botón" debe ser "enséñame el hero
                    entero" (el navegador clampa el scroll a 0). */}
                {hero.executablePath && !heroOwnLive && (
                  <TvButton
                    label={launching ? 'Launching…' : 'Play'}
                    icon={<Play className="size-[0.9em]" fill="currentColor" />}
                    variant="primary"
                    className="scroll-mt-[60em]"
                    autoFocus={!hasRestoredTile}
                    onSelect={() => void launchHero()}
                    onFocusSpot={() => setSpotId(null)}
                  />
                )}
                <TvButton
                  label={hero.isLive ? 'Open game' : 'Details'}
                  variant={hero.executablePath && !heroOwnLive ? 'secondary' : 'primary'}
                  className="scroll-mt-[60em]"
                  autoFocus={(!hero.executablePath || heroOwnLive) && !hasRestoredTile}
                  // Saliste DEL HERO: al volver, el foco es de estos botones
                  // (HomeSnapshot.focusGameId = null), no de la carátula del
                  // hero repetida en las baldas de abajo.
                  onSelect={() => openGame(hero, null)}
                  onFocusSpot={() => setSpotId(null)}
                />
              </div>
            </div>

            {/* Los números del mes, a la derecha del héroe: solo aparecen
                cuando el mes ya cuenta algo. */}
            {monthStats.count > 0 && (
              <div
                className={cn(
                  'ml-auto flex flex-none flex-col items-end gap-[0.5em] self-end',
                  tvRevealClass,
                )}
                style={tvRevealStyle(3)}
              >
                <span className="text-[0.92em] text-dust">{monthStats.label} so far</span>
                <div className="flex items-end gap-[1.1em]">
                  {[
                    { value: formatHours(monthStats.hours), label: 'played', hot: true },
                    {
                      value: String(monthStats.count),
                      label: monthStats.count === 1 ? 'session' : 'sessions',
                      hot: false,
                    },
                    {
                      value: String(monthStats.games),
                      label: monthStats.games === 1 ? 'game' : 'games',
                      hot: false,
                    },
                  ].map((stat) => (
                    <div key={stat.label} className="flex flex-col items-end">
                      <TvFigure
                        value={stat.value}
                        className={cn('text-[1.9em]', stat.hot ? 'text-phosphor' : 'text-bone')}
                      />
                      <span className="text-[0.88em] text-dust">{stat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <Shelf
        title="Playing"
        subtitle="games in progress"
        games={playing}
        onOpen={openGame}
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={shelfAutoFocusId}
        revealIndex={3}
      />
      <Shelf
        title="Recently played"
        games={recent}
        onOpen={openGame}
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={shelfAutoFocusId}
        revealIndex={4}
      />
      <Shelf
        title="Recently finished"
        games={finished}
        onOpen={openGame}
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={shelfAutoFocusId}
        revealIndex={5}
      />
      <Shelf
        title="Your library"
        subtitle="most played"
        games={shelf}
        onOpen={openGame}
        onFocusGame={(game) => setSpotId(game.id)}
        autoFocusId={shelfAutoFocusId}
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
