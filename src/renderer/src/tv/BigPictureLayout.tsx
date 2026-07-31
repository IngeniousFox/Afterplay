import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { SessionClosedEvent } from '../../../shared/types';
import { useGames } from '../hooks/games';
import { queryKeys } from '../hooks/queryKeys';
import { BLUE, GREEN, TEAL, VIOLET } from '../lib/colors';
import { extractArtGlow } from './artGlow';
import { useTimeFormat } from '../hooks/settings';
import { TvFocusProvider } from './focus';
import { useTvFocusActions } from './focusContext';
import type { FireflySpec } from './FireflyCanvas';
import { FireflyCanvas } from './FireflyCanvas';
import { forgetAllTvMemory } from './screenMemory';
import { tvSound } from './sound';
import type { TvInputAction } from './gamepad';
import { startGamepadLoop } from './gamepad';
import { TvBackdropContext } from './backdropContext';
import { markRealPointerMove, setTvInputDevice, useTvInputDevice } from './inputDevice';
import type { HandlersRef, TvContextButton, TvHint, TvHintAction } from './tvInput';
import { TvButtonsContext, TvLegendContext } from './tvInput';
import { TvSessionPanel } from './TvSessionPanel';
import { TvStartMenu } from './TvStartMenu';

// El shell del modo TV (BIG-PICTURE.md §3-§6): pantalla completa, escala
// 10-foot, y TODO el cableado de entrada — el bucle del mando vive aquí y
// muere aquí (en escritorio no corre ni un frame). RootLayout ni se monta en
// este árbol: fuera rail, columnas y chrome de ratón.
//
// La vida del modo también nace aquí: las auroras del fondo (dos luces de la
// casa derivando despacio detrás de todo), y la leyenda del pie que habla el
// idioma del dispositivo que la esté usando (Ⓐ/Ⓑ con mando, Enter/Esc con
// teclado — ver inputDevice.ts) con el reloj de salón al otro lado.

// Qué tecla/glifo enseña la leyenda para cada acción, por dispositivo. Las
// mismas teclas que mapea el espejo de teclado de abajo — si esto y aquello
// divergen, la leyenda miente.
const PAD_GLYPHS: Record<TvHintAction, string> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  lb: 'LB',
  rb: 'RB',
  lt: 'LT',
  rt: 'RT',
  view: 'VIEW',
  start: '≡',
  lbrb: 'LB·RB',
  ltrt: 'LT·RT',
};
const KEY_GLYPHS: Record<TvHintAction, string> = {
  a: 'Enter',
  b: 'Esc',
  x: 'X',
  y: 'F',
  lb: 'Q',
  rb: 'E',
  lt: 'PgUp',
  rt: 'PgDn',
  view: 'Home',
  start: 'M',
  lbrb: 'Q·E',
  ltrt: 'PgUp·PgDn',
};

// LAS LUCIÉRNAGAS SON TU BIBLIOTECA: cada luz del cielo es UN JUEGO, con el
// color de su estado rebajado a tono de brasa — los terminados brillan
// champán dorado, los playing verde menta, los dropped un rosa apagado que
// no chilla, los aparcados gris azulado, los resting lavanda, los unplayed
// perla. Nadie te lo cuenta en ningún sitio: es de esas cosas que un día
// notas ("¿por qué hay tantas doradas?") y ya no puedes dejar de ver.
// Geometría/ritmo deterministas por índice (el compilador de React prohíbe
// Math.random en render, y así cada arranque enseña el mismo cielo).
const ORB_COLORS = ['#f5d98a', '#e8c97a', '#fbe7b2', '#e3b24a'] as const;
// La tabla de brasas por estado — SIEMPRE versiones suaves, nunca el color
// de UI puro (un enjambre de #e85d72 puros sería una alarma, no un cielo).
const ORB_STATE_COLORS: Record<string, string> = {
  started: '#8be8b6',
  completed: '#edd39a',
  dropped: '#d998a5',
  on_hold: '#aab2be',
  resting: '#adb3e2',
  plan_to_play: '#9fb8dc',
  unplayed: '#c2c8c2',
};
// Sin tope ni mínimo, a propósito: el cielo enseña EXACTAMENTE tu
// biblioteca — un juego, una luz. La ley de conservación de energía de
// FireflyCanvas (intensidad ∝ 1/√n, auroras fijas en ~13) hace que
// cualquier tamaño se vea bien y cueste casi lo mismo, así que un cap
// sería mentirle al cielo sin ganar nada.

// La geometría base de una luciérnaga por su índice. Módulos distintos (100
// y 97) a propósito: con los dos a 100, la pareja (i, i+100) caía SIEMPRE
// en el mismo punto — luces apiladas invisibles. Con periodos coprimos no
// hay dos iguales. Cada décima es un brillo GRANDE de aurora. La DERIVA ya
// no vive aquí: la calcula FireflyCanvas por índice, frame a frame.
const buildOrb = (index: number, color: string, sizeBonus: number): FireflySpec => ({
  left: (index * 37 + 13) % 100,
  top: (index * 53 + 7) % 97,
  size: 0.45 + ((index * 7) % 12) / 8.2 + sizeBonus,
  color,
  big: index % 10 === 0,
});

// LA LUZ DE IDENTIDAD POR PANTALLA: cada ruta del modo tiñe el ambiente con
// su color de la casa — Home verde, Library azul, Journey violeta, la ficha
// de juego teal (los mismos acentos que llevan sus entradas en el menú
// Start). Es lo que hacen las consolas de verdad: no cambias de pantalla,
// cambias de HABITACIÓN, y cada habitación tiene su propia luz. El orden
// importa: el prefijo más específico se comprueba primero.
const routeAccent = (pathname: string): string => {
  if (pathname.startsWith('/tv/library')) return BLUE;
  if (pathname.startsWith('/tv/journey')) return VIOLET;
  if (pathname.startsWith('/tv/game')) return TEAL;
  return GREEN;
};
// La forma de la luz ambiental: baño cenital + eco en la esquina opuesta.
// La usan las DOS capas del doble búfer de luz (previous/current) — ver el
// estado `glow` del shell: el color vivo sale del ARTE en pantalla (artGlow)
// y solo cae al acento de ruta cuando no hay arte que escuchar.
const glowWash = (color: string): string =>
  `radial-gradient(85% 62% at 50% -8%, ${color}47, transparent 62%), radial-gradient(58% 44% at 88% 108%, ${color}29, transparent 70%)`;

const PadGlyph = ({ label }: { label: string }): React.JSX.Element => (
  <span className="flex h-[1.4em] min-w-[1.4em] items-center justify-center rounded-full border border-white/20 bg-white/[0.05] px-[0.35em] text-[0.6em] font-extrabold tracking-[.04em] text-foreground/90">
    {label}
  </span>
);

// El reloj del salón: una tele sin hora es una tele a medias. Se refresca
// cada medio minuto — de sobra para un reloj sin segundos.
const useClock = (): string => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return now.toLocaleTimeString('en-US', {
    hour: timeFormat === '12h' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12: timeFormat === '12h',
  });
};

// ── El shell interior (necesita estar DENTRO del TvFocusProvider) ─────────
const TvShell = (): React.JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { move, select, isRootActive } = useTvFocusActions();
  const device = useTvInputDevice();
  const clock = useClock();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: games = [], isFetched: gamesFetched } = useGames();

  // El cielo derivado de la biblioteca (ver ORB_STATE_COLORS): un juego =
  // una luciérnaga con la brasa suave de su estado. Tal cual, sin tope ni
  // relleno: el cielo es un censo honesto.
  const orbs = useMemo(
    () =>
      games.map((game, index) =>
        buildOrb(
          index,
          ORB_STATE_COLORS[game.currentState ?? 'unplayed'] ??
            ORB_COLORS[index % ORB_COLORS.length],
          game.currentState === 'completed' ? 0.2 : 0,
        ),
      ),
    [games],
  );
  const [sessionEvent, setSessionEvent] = useState<SessionClosedEvent | null>(null);
  const [extraHints, setExtraHints] = useState<TvHint[]>([]);
  const buttonStackRef = useRef<HandlersRef[]>([]);
  // El fondo ambiental (backdropContext): doble búfer para el crossfade —
  // el arte anterior se queda debajo mientras el nuevo entra fundiéndose.
  const [backdrop, setBackdropState] = useState<{
    current: string | null;
    previous: string | null;
  }>({ current: null, previous: null });
  const setBackdrop = useCallback((src: string | null): void => {
    setBackdropState((state) =>
      state.current === src ? state : { current: src, previous: state.current },
    );
  }, []);

  // Ref fresco para el manejador del mando (una sola suscripción). Se asienta
  // en efecto, no durante el render: el mando dispara post-commit siempre.
  const stateRef = useRef({ menuOpen, pathname: location.pathname });
  useEffect(() => {
    stateRef.current = { menuOpen, pathname: location.pathname };
  });

  const registerButtons = useCallback((ref: HandlersRef): (() => void) => {
    buttonStackRef.current.push(ref);
    return () => {
      buttonStackRef.current = buttonStackRef.current.filter((entry) => entry !== ref);
    };
  }, []);

  // PILA, como los botones: el OSK machaca los hints de la pantalla mientras
  // está abierto, y al cerrarse se RESTAURAN los de debajo (un slot único los
  // perdía para siempre — la pantalla nunca re-registra los suyos porque su
  // efecto no re-ejecuta).
  const hintsStackRef = useRef<TvHint[][]>([]);
  const registerHints = useCallback((hints: TvHint[]): (() => void) => {
    hintsStackRef.current.push(hints);
    setExtraHints(hints);
    return () => {
      hintsStackRef.current = hintsStackRef.current.filter((entry) => entry !== hints);
      setExtraHints(hintsStackRef.current[hintsStackRef.current.length - 1] ?? []);
    };
  }, []);

  useEffect(() => {
    const dispatchContextButton = (button: TvContextButton): boolean => {
      for (let index = buttonStackRef.current.length - 1; index >= 0; index--) {
        const handler = buttonStackRef.current[index].current[button];
        if (handler) {
          handler();
          return true;
        }
      }
      return false;
    };

    const goBack = (): void => {
      const { menuOpen: menu, pathname } = stateRef.current;
      if (menu) {
        setMenuOpen(false);
        return;
      }
      // Los paneles abiertos (selector de estado, OSK...) registran su
      // propia B en la pila y la consumen antes de llegar aquí.
      if (dispatchContextButton('b')) return;
      // La regla del documento (§7.3): ficha → atrás; resto → Home; en Home,
      // el menú Start — B/Esc siempre hace ALGO, y "no hay más atrás" es
      // justo el momento de ofrecer salir. navigate(-1) desde la ficha es
      // seguro porque a una ficha TV solo se llega desde otra pantalla TV.
      // Sonido: solo en las ramas que NAVEGAN — cerrar menú/panel ya suena
      // solo (popLayer en focus.tsx), y abrir el menú suena por pushLayer.
      if (pathname.startsWith('/tv/game')) {
        tvSound.back();
        void navigate(-1);
      } else if (pathname !== '/tv') {
        tvSound.back();
        void navigate('/tv');
      } else setMenuOpen(true);
    };

    const handleAction = (action: TvInputAction): void => {
      if (action.type === 'move') {
        const moved = move(action.dir, action.repeat === true);
        // El tick de foco suena solo cuando el foco SE MOVIÓ: contra el
        // borde, silencio — la pared no suena. (El hover del ratón hace su
        // propio tick en focusContext.)
        if (moved) tvSound.move();
        // El gesto de consola: seguir empujando a la IZQUIERDA con el foco ya
        // contra el borde abre el menú — el menú vive a la izquierda, y el
        // pulgar lo encuentra sin saberse ningún botón. Solo a pantalla
        // abierta (capa raíz): dentro de un panel, el borde es el borde.
        if (!moved && action.dir === 'left' && isRootActive() && !stateRef.current.menuOpen) {
          setMenuOpen(true);
        }
        return;
      }
      switch (action.button) {
        case 'a':
          select();
          break;
        case 'b':
          goBack();
          break;
        case 'start':
          setMenuOpen((open) => !open);
          break;
        case 'view':
          if (!dispatchContextButton('view')) {
            if (stateRef.current.pathname !== '/tv') tvSound.back();
            void navigate('/tv');
          }
          break;
        default:
          dispatchContextButton(action.button);
      }
    };

    const stopLoop = startGamepadLoop(handleAction);

    // Espejo de teclado (§3.6): desarrollar sin mando, y usar el modo en
    // escritorio si apetece. Las teclas de aquí son EXACTAMENTE las que
    // anuncia KEY_GLYPHS — si se toca una, se toca la otra.
    const onKeyDown = (event: KeyboardEvent): void => {
      const map: Record<string, TvInputAction | undefined> = {
        ArrowUp: { type: 'move', dir: 'up' },
        ArrowDown: { type: 'move', dir: 'down' },
        ArrowLeft: { type: 'move', dir: 'left' },
        ArrowRight: { type: 'move', dir: 'right' },
        Enter: { type: 'button', button: 'a' },
        // Espacio = A también: sin mapear, su activación nativa disparaba un
        // click sobre el botón con foco DOM (el último clicado — que puede
        // no ser el enfocado del motor) con confirmar fantasma incluido. El
        // preventDefault de abajo suprime ese click nativo, como con Enter.
        Space: { type: 'button', button: 'a' },
        Escape: { type: 'button', button: 'b' },
        KeyQ: { type: 'button', button: 'lb' },
        KeyE: { type: 'button', button: 'rb' },
        PageUp: { type: 'button', button: 'lt' },
        PageDown: { type: 'button', button: 'rt' },
        KeyF: { type: 'button', button: 'y' },
        KeyX: { type: 'button', button: 'x' },
        KeyM: { type: 'button', button: 'start' },
        Home: { type: 'button', button: 'view' },
      };
      // Por código físico para las letras (KeyQ funciona igual en QWERTY y
      // AZERTY) y por key para el resto.
      const action = map[event.code] ?? map[event.key];
      if (!action) return;
      event.preventDefault();
      setTvInputDevice('kbm');
      // Los BOTONES son de flanco también en teclado (el mando lo es por
      // construcción, gamepad.ts): sin este filtro, el autorepeat del SO
      // convertía mantener Enter en una cadena de select() — navegar a la
      // ficha Y lanzar el juego con la misma tecla sujeta. Las direcciones
      // sí quieren repetir.
      if (event.repeat && action.type === 'button') return;
      // La misma regla del salvapantallas que el mando (gamepad.ts): la
      // tecla que despierta el modo ambiente se CONSUME — el keydown ya lo
      // desvaneció vía useIdle, y la acción no debe llegar a lo de debajo.
      if (document.querySelector('[data-afterplay-ambient]') !== null) return;
      // El autorepeat del SO marca los ecos igual que el mando: scroll
      // instantáneo mientras la flecha se mantiene pulsada.
      handleAction(action.type === 'move' && event.repeat ? { ...action, repeat: true } : action);
    };
    window.addEventListener('keydown', onKeyDown);

    // El puntero también declara dispositivo — y deja marca de movimiento
    // REAL: el hover-mueve-foco solo obedece a punteros que se movieron de
    // verdad (ver inputDevice.ts), no a los enter fantasma post-scroll.
    const onPointer = (): void => {
      setTvInputDevice('kbm');
      markRealPointerMove();
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('wheel', onPointer, { passive: true });

    return () => {
      stopLoop();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('wheel', onPointer);
    };
  }, [move, select, isRootActive, navigate]);

  // El hilo musical del salón (la referencia: Steam Big Picture): el pad
  // generativo de sound.ts arranca con el modo y se funde al salir. Electron
  // permite audio sin gesto, así que suena desde la cortina de entrada.
  useEffect(() => {
    tvSound.startAmbience();
    return () => {
      tvSound.stopAmbience();
      // Las memorias de "vuelve donde estabas" (screenMemory) son de la
      // sesión de sofá: salir del modo las entierra — re-entrar mañana no
      // debe aterrizar en la búsqueda de anteayer.
      forgetAllTvMemory();
    };
  }, []);

  // Y se RETIRA mientras hay un juego corriendo: el pad debajo del audio del
  // juego que acabas de lanzar sería ruido, no ambiente. isLive viene del
  // watcher (games:changed → useWatcherSync invalida ['games'] en la raíz).
  // Sin datos aún (arranque frío directo al modo TV) no se decide nada: el
  // primer commit con caché vacía diría "no hay juego" y desharía la
  // atenuación que sound.ts recuerda justo para ese caso.
  const gameRunning = games.some((game) => game.isLive);
  useEffect(() => {
    if (gamesFetched) tvSound.duckAmbience(gameRunning);
  }, [gamesFetched, gameRunning]);

  // El cierre de sesión, versión sofá (§5.4): el listener de escritorio vive
  // en RootLayout, que aquí no está montado — este es su gemelo TV. La
  // invalidación es la misma; la piel, un panel a escala en vez de un toast.
  useEffect(() => {
    return window.api.sessions.onSessionClosed((event) => {
      if ('openGame' in event && event.openGame) {
        void navigate(`/tv/game/${event.gameId}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.games.all });
      setSessionEvent(event);
    });
  }, [navigate, queryClient]);

  // Los recaps siguen generándose con el modo TV puesto, y el Journey TV los
  // pinta: alguien tiene que invalidar (el hook de escritorio que lo hacía
  // vive en RootLayout, desmontado aquí — y su toast queda suprimido en TV
  // precisamente por eso, ver BIG-PICTURE.md §5.4).
  useEffect(() => {
    return window.api.memories.onActivity(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
    });
  }, [queryClient]);

  // La luz de la habitación actual (ver routeAccent arriba) — es el
  // FALLBACK: cuando hay arte en el fondo, la luz la pone el arte (artGlow).
  const accent = routeAccent(location.pathname);

  // EL COLOR DEL JUEGO (artGlow): la luz ambiental sale del arte que está en
  // pantalla. Doble búfer como el propio backdrop — los gradientes no saben
  // interpolar color, así que el anterior aguanta debajo mientras el nuevo
  // entra en fundido. `alive` porque la extracción es async y el arte puede
  // haber cambiado otra vez antes de que este resuelva.
  const [glow, setGlow] = useState<{ previous: string | null; current: string }>({
    previous: null,
    current: GREEN,
  });
  const glowTarget = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    const settle = (color: string): void => {
      if (!alive || glowTarget.current === color) return;
      glowTarget.current = color;
      setGlow((state) =>
        state.current === color ? state : { previous: state.current, current: color },
      );
    };
    if (!backdrop.current) {
      settle(accent);
      return;
    }
    void extractArtGlow(backdrop.current).then((color) => settle(color ?? accent));
    return () => {
      alive = false;
    };
  }, [backdrop, accent]);

  const glyphs = device === 'gamepad' ? PAD_GLYPHS : KEY_GLYPHS;
  const baseHints: TvHint[] = [
    { action: 'a', label: 'Select' },
    { action: 'b', label: 'Back' },
  ];
  // Deduplicado por ACCIÓN, y el extra gana: con el OSK abierto, B es
  // "Delete" — enseñar a la vez "Esc Back" y "Esc Delete" era una leyenda
  // contradiciéndose a sí misma.
  const mergedHints = ((): TvHint[] => {
    const byAction = new Map<TvHint['action'], TvHint>();
    for (const hint of baseHints) byAction.set(hint.action, hint);
    for (const hint of extraHints) byAction.set(hint.action, hint);
    return [...byAction.values()];
  })();

  return (
    <TvButtonsContext.Provider value={registerButtons}>
      <TvLegendContext.Provider value={registerHints}>
        <TvBackdropContext.Provider value={setBackdrop}>
          <div
            // Base #070908 y no el #0b0d0c del escritorio: la tele arranca
            // desde un negro más hondo — la viñeta muere ahí y los paneles
            // de cristal tienen algo oscuro de verdad detrás.
            className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#070908] text-foreground"
            // La escala 10-foot entera cuelga de esta base (§6): proporcional
            // al alto del display que negocie Moonlight — ni enana en 4K ni
            // gigante en 720p. Todo lo interno va en em/rem.
            style={{ fontSize: 'clamp(18px, 2.2vh, 30px)' }}
            // El confirmar para el RATÓN, en un solo sitio: el select() del
            // mando no despacha click DOM y el Enter del espejo hace
            // preventDefault, así que aquí solo llegan clicks de puntero de
            // verdad. El mismo reparto data-tv-sound que focus.tsx.
            onClickCapture={(event) => {
              const button = (event.target as HTMLElement).closest?.('button');
              if (!button || button.dataset.tvSound === 'none') return;
              tvSound.select();
            }}
          >
            {/* EL FONDO VIVO: el arte de lo que estés mirando, difuminado a
              pantalla completa y derivando despacio, con crossfade al
              cambiar (doble búfer: el anterior aguanta debajo mientras el
              nuevo entra). Encima, los velos que devuelven el contraste y
              las auroras de la casa. Es lo que separa "modo TV" de
              "rectángulo negro con botones". */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              {/* EL JUEGO ES LA PANTALLA: el arte casi nítido (blur 8, no 24
                — solo lo justo para alisar el reescalado) y con luz de
                verdad. Ya no es "ambiente detrás de la UI": es el sujeto. La
                legibilidad no se la roba un velo global al arte entero — la
                ponen los SCRIMS direccionales de abajo, que oscurecen donde
                vive el texto y dejan al arte el resto de la sala. */}
              {backdrop.previous && (
                <img
                  src={backdrop.previous}
                  alt=""
                  // Sin arte nuevo encima (la pantalla DESPEJÓ el fondo para
                  // el cielo, useTvSkyBackdrop) el búfer viejo se funde a
                  // negro — quedarse clavado debajo taparía la noche.
                  className={`absolute inset-0 h-full w-full object-cover ${backdrop.current ? '' : 'afterplay-tv-backdrop-out'}`}
                  style={{
                    filter: 'blur(8px) saturate(1.4) brightness(.6) contrast(1.06)',
                    transform: 'scale(1.06)',
                  }}
                />
              )}
              {backdrop.current && (
                <img
                  key={backdrop.current}
                  src={backdrop.current}
                  alt=""
                  className="afterplay-tv-backdrop absolute inset-0 h-full w-full object-cover"
                  style={{ filter: 'blur(8px) saturate(1.4) brightness(.6) contrast(1.06)' }}
                />
              )}
              {/* Scrim vertical: ancla títulos arriba y leyenda abajo. */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(6,8,7,.5) 0%, rgba(6,8,7,.16) 32%, rgba(6,8,7,.2) 60%, rgba(6,8,7,.68) 100%)',
                }}
              />
              {/* Scrim lateral: el texto del modo vive a la izquierda (titular
                del Home, cabeceras, fichas) — esta cuña le da fondo sin
                apagar el arte del centro-derecha. */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(90deg, rgba(6,8,7,.6) 0%, rgba(6,8,7,.26) 36%, transparent 64%)',
                }}
              />
              {/* La luz del JUEGO (artGlow, doble búfer como el arte): baño
                cenital + eco de esquina del color vivo del arte en pantalla.
                El anterior aguanta debajo; el nuevo entra en fundido. */}
              {glow.previous && (
                <div className="absolute inset-0" style={{ background: glowWash(glow.previous) }} />
              )}
              <div
                key={glow.current}
                className="animate-in fade-in-0 absolute inset-0 duration-1000"
                style={{ background: glowWash(glow.current) }}
              />
              {/* Degradado radial en vez de círculo sólido + blur: el blur
                  se recortaba de golpe contra el overflow-hidden del
                  viewport y las luces de esquina se veían CORTADAS. El
                  radial muere a transparente antes de su propio borde, así
                  que da igual dónde lo recorte la pantalla. */}
              <div
                className="afterplay-tv-aurora-a absolute -top-[30%] -left-[22%] h-[95vh] w-[70vw]"
                style={{
                  background:
                    'radial-gradient(closest-side, rgba(47,220,126,.14), rgba(47,220,126,.055) 55%, transparent 78%)',
                }}
              />
              <div
                className="afterplay-tv-aurora-b absolute -right-[20%] -bottom-[34%] h-[100vh] w-[66vw]"
                style={{
                  background:
                    'radial-gradient(closest-side, rgba(124,134,200,.15), rgba(124,134,200,.06) 55%, transparent 78%)',
                }}
              />
              {/* Las luciérnagas y los brillos-aurora — tu biblioteca,
                  contada en brasas de colores, pintada entera en UN canvas
                  (ver FireflyCanvas). YA NO son empapelado: con arte en
                  pantalla se apagan del todo (el juego manda, y 331 puntos
                  encima del arte eran ruido), y solo en las pantallas-cielo
                  (la cubierta del Journey, los estados vacíos) salen a
                  escena a plena luz — la escasez es lo que las hace mágicas. */}
              <div
                className="absolute inset-0 transition-opacity duration-700"
                style={{ opacity: backdrop.current ? 0 : 1 }}
              >
                <FireflyCanvas orbs={orbs} active={!backdrop.current} />
              </div>
              {/* LA VIÑETA DE CINE: los bordes mueren en negro casi puro,
                pero el centro queda más limpio que antes — el arte es el
                sujeto y la viñeta es su marco, no su mordaza. */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 42%, transparent 42%, rgba(4,5,4,.42) 70%, rgba(2,3,2,.86) 100%)',
                }}
              />
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden px-[4vw] pt-[3.2vh]">
              {/* Cada ruta entra con su propio fundido+subida: navegar es
                moverse por un sitio, no repintar un formulario. */}
              <div key={location.pathname} className="afterplay-tv-screen h-full min-h-0">
                <Outlet />
              </div>
            </div>

            {/* La leyenda: el manual permanente, en el idioma del dispositivo
              que hablara último. El item de menú es un BOTÓN de verdad — el
              ratón también merece su puerta al menú. */}
            <div className="relative flex h-[2.7em] flex-none items-center gap-[1.5em] bg-black/45 px-[4vw] text-[0.72em] font-bold text-muted-foreground backdrop-blur-[10px]">
              {/* Filete de luz en vez de un border plano — y del COLOR del
                juego en pantalla (artGlow): la luz del arte llega hasta el
                pie. Cambia seco al fundir, pero un pelo de luz de 1px bajo
                el crossfade del fondo entero no se ve saltar. */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-px"
                style={{
                  background: `linear-gradient(90deg, transparent, ${glow.current}59 30%, ${glow.current}59 70%, transparent)`,
                }}
              />
              {mergedHints.map((hint) => (
                <span
                  key={`${hint.action}-${hint.label}`}
                  className="flex items-center gap-[0.5em] transition-opacity duration-300"
                >
                  <PadGlyph label={glyphs[hint.action]} />
                  {hint.label}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                // Su única consecuencia es abrir/cerrar el menú, y eso ya
                // suena por el ciclo de capa (pushLayer/popLayer) — sin esto
                // el click apilaba confirmar + apertura.
                data-tv-sound="none"
                className="flex items-center gap-[0.5em] transition-colors duration-150 hover:text-foreground"
              >
                <PadGlyph label={glyphs.start} />
                Menu
              </button>
              <span className="ml-auto flex items-center gap-[0.9em]">
                <span className="text-[0.85em] font-extrabold tracking-[.24em] text-muted-foreground/45">
                  AFTERPLAY
                </span>
                <span className="text-[1em] font-bold text-foreground/70 tabular-nums">
                  {clock}
                </span>
              </span>
            </div>

            {menuOpen && <TvStartMenu onClose={() => setMenuOpen(false)} />}
            {sessionEvent && (
              <TvSessionPanel event={sessionEvent} onClose={() => setSessionEvent(null)} />
            )}
          </div>
        </TvBackdropContext.Provider>
      </TvLegendContext.Provider>
    </TvButtonsContext.Provider>
  );
};

export const BigPictureLayout = (): React.JSX.Element => (
  <TvFocusProvider>
    <TvShell />
  </TvFocusProvider>
);
