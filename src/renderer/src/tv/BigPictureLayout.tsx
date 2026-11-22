import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { isLiveElsewhere } from '../../../shared/liveSession';
import type { SessionClosedEvent } from '../../../shared/types';
import { useDeviceContext } from '../hooks/devices';
import { useGames } from '../hooks/games';
import { queryKeys } from '../hooks/queryKeys';
import { consumeAmbientWake } from '../lib/ambientWake';
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
import type { TvPadBrand } from './inputDevice';
import {
  markRealPointerMove,
  setTvInputDevice,
  useTvInputDevice,
  useTvPadBrand,
} from './inputDevice';
import type {
  HandlersRef,
  TvContextButton,
  TvHint,
  TvHintAction,
  TvLegendRegistry,
  TvLegendSlot,
} from './tvInput';
import { TvButtonsContext, TvLegendContext } from './tvInput';
import { tvFocusVars } from './styles';
import { TvHeader } from './TvChrome';
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
//
// Y por MARCA de mando, que es la otra mitad de no mentir: el mapping del
// W3C es posicional (el botón 0 es el de abajo, se llame como se llame), así
// que el motor no distingue mandos — solo esta tabla. Fíjate en Nintendo:
// lleva A/B y X/Y cruzados respecto a Xbox, y por eso la acción 'a' (botón
// de abajo) se dibuja como B. Cruzarlo aquí es justamente lo que hace que la
// leyenda coincida con lo que el usuario tiene bajo el pulgar.
const XBOX_GLYPHS: Record<TvHintAction, string> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  lb: 'LB',
  rb: 'RB',
  lt: 'LT',
  rt: 'RT',
  view: 'VIEW',
  // Con su nombre y no con el pictograma: el "≡" del serigrafiado, metido en
  // una chapa de 1.4em, se leía como tres rayas sueltas y no como un botón.
  // Microsoft lo llama Menu — y la palabra la entiende cualquiera.
  start: 'MENU',
  lbrb: 'LB·RB',
  ltrt: 'LT·RT',
};
const PLAYSTATION_GLYPHS: Record<TvHintAction, string> = {
  a: '✕',
  b: '○',
  x: '□',
  y: '△',
  lb: 'L1',
  rb: 'R1',
  lt: 'L2',
  rt: 'R2',
  // SHARE en DualShock 4 y CREATE en DualSense: el botón es el mismo sitio y
  // la misma función, así que se dice con el nombre del mando que casi
  // seguro tiene delante quien juega en PC.
  view: 'SHARE',
  start: 'OPTIONS',
  lbrb: 'L1·R1',
  ltrt: 'L2·R2',
};
const NINTENDO_GLYPHS: Record<TvHintAction, string> = {
  a: 'B',
  b: 'A',
  x: 'Y',
  y: 'X',
  lb: 'L',
  rb: 'R',
  lt: 'ZL',
  rt: 'ZR',
  view: '−',
  start: '+',
  lbrb: 'L·R',
  ltrt: 'ZL·ZR',
};
const PAD_GLYPHS: Record<TvPadBrand, Record<TvHintAction, string>> = {
  xbox: XBOX_GLYPHS,
  playstation: PLAYSTATION_GLYPHS,
  nintendo: NINTENDO_GLYPHS,
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

// LAS MOTAS DE FÓSFORO SON TU BIBLIOTECA (README-tvpwa.md): una luz por
// juego, del color de su LED de estado — ámbar la mayoría (playing y on hold),
// verde los terminados, cian lo pendiente, violeta los que descansan y gris
// los abandonados. Detrás de todo y sin competir con el texto: 2-6 px, halo
// corto y opacidad entre .25 y .7 (FireflyCanvas). Geometría determinista por
// índice (el compilador de React prohíbe Math.random en render, y así cada
// arranque enseña el mismo cielo).
const MOTE_STATE_COLORS: Record<string, string> = {
  started: '#ffb347',
  on_hold: '#ffb347',
  completed: '#9bd67a',
  dropped: '#8a9496',
  resting: '#b9a6ff',
  plan_to_play: '#5fd3e0',
  unplayed: '#5fd3e0',
};

// Módulos distintos (100 y 97) a propósito: con los dos a 100, la pareja
// (i, i+100) caía SIEMPRE en el mismo punto. El tamaño, en px (2-6).
const buildMote = (index: number, color: string): FireflySpec => ({
  left: (index * 37 + 13) % 100,
  top: (index * 53 + 7) % 97,
  size: 2 + ((index * 7) % 9) / 2,
  color,
});

// La chapa de un botón del mando en la leyenda: círculo para los de una
// letra, píldora para LB/RB y las teclas. A va en Phosphor, como en el mando.
const PadGlyph = ({ label, primary }: { label: string; primary?: boolean }): React.JSX.Element => (
  <span
    className={cn(
      'flex h-[1.45em] min-w-[1.45em] items-center justify-center rounded-full border-[0.09em] px-[0.35em] text-[0.92em] leading-none font-semibold',
      primary ? 'border-phosphor text-phosphor' : 'border-dust text-bone',
    )}
  >
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
  // Qué mando habló último (Xbox / DualShock / Pro Controller): la leyenda
  // del pie se redibuja sola al cambiar de mando, sin reiniciar nada.
  const padBrand = useTvPadBrand();
  const clock = useClock();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: games = [], isFetched: gamesFetched } = useGames();

  // El cielo derivado de la biblioteca (ver MOTE_STATE_COLORS): un juego =
  // una luciérnaga con la brasa suave de su estado. Tal cual, sin tope ni
  // relleno: el cielo es un censo honesto.
  const orbs = useMemo(
    () =>
      games.map((game, index) =>
        buildMote(index, MOTE_STATE_COLORS[game.currentState ?? 'unplayed'] ?? '#ffb347'),
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
  //
  // De HUECOS estables, no de arrays sueltos: cambiar de pistas ya no es
  // salir y volver a entrar por arriba. Con el array a pelo, la leyenda de
  // TvLibrary (que depende del dispositivo) se re-registraba al soltar el
  // ratón con el OSK abierto y aterrizaba ENCIMA de la del teclado — el pie
  // anunciaba botones que el velo del OSK se come. Ahora el contenido muta
  // dentro del mismo hueco (refresh) y la posición en la pila solo la mueven
  // montar y desmontar. El spread al pintar no es manía: el array del hueco
  // se muta en sitio, y sin identidad nueva React no re-renderizaría.
  const hintsStackRef = useRef<TvLegendSlot[]>([]);
  const legendRegistry = useMemo<TvLegendRegistry>(
    () => ({
      register: (slot) => {
        hintsStackRef.current.push(slot);
        setExtraHints([...slot.hints]);
        return () => {
          hintsStackRef.current = hintsStackRef.current.filter((entry) => entry !== slot);
          const top = hintsStackRef.current[hintsStackRef.current.length - 1];
          setExtraHints(top ? [...top.hints] : []);
        };
      },
      refresh: (slot) => {
        const top = hintsStackRef.current[hintsStackRef.current.length - 1];
        if (top === slot) setExtraHints([...slot.hints]);
      },
    }),
    [],
  );

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
      // El sello es el respaldo del atributo: React puede colar su commit
      // (y borrar el atributo) en el microtask entre el bump de useIdle y
      // este listener — ver lib/ambientWake.
      if (document.querySelector('[data-afterplay-ambient]') !== null) return;
      if (consumeAmbientWake()) return;
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
  // watcher (data:changed → useDataChangedSync invalida ['games'] en la raíz).
  // Sin datos aún (arranque frío directo al modo TV) no se decide nada: el
  // primer commit con caché vacía diría "no hay juego" y desharía la
  // atenuación que sound.ts recuerda justo para ese caso.
  // Solo el que corre en ESTE PC: uno que se juega en otro no suena aquí.
  const { thisDeviceId } = useDeviceContext();
  const gameRunning = games.some((game) => game.isLive && !isLiveElsewhere(game, thisDeviceId));
  useEffect(() => {
    if (gamesFetched) tvSound.duckAmbience(gameRunning);
  }, [gamesFetched, gameRunning]);

  // El cierre de sesión, versión sofá (§5.4): el listener de escritorio vive
  // en RootLayout, que aquí no está montado — este es su gemelo TV. La piel es
  // un panel a escala en vez de un toast; el refresco de datos lo hace
  // 'data:changed' en la raíz.
  useEffect(() => {
    return window.api.sessions.onSessionClosed((event) => {
      if ('openGame' in event && event.openGame) {
        void navigate(`/tv/game/${event.gameId}`);
        return;
      }
      setSessionEvent(event);
    });
  }, [navigate]);

  // Los recaps siguen generándose con el modo TV puesto, y el Journey TV los
  // pinta: alguien tiene que invalidar (el hook de escritorio que lo hacía
  // vive en RootLayout, desmontado aquí — y su toast queda suprimido en TV
  // precisamente por eso, ver BIG-PICTURE.md §5.4).
  useEffect(() => {
    return window.api.memories.onActivity(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
    });
  }, [queryClient]);

  const glyphs = device === 'gamepad' ? PAD_GLYPHS[padBrand] : KEY_GLYPHS;
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
      <TvLegendContext.Provider value={legendRegistry}>
        <TvBackdropContext.Provider value={setBackdrop}>
          <div
            className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-cabinet text-bone"
            // La escala 10-foot entera cuelga de esta base (§6): proporcional
            // al alto del display que negocie Moonlight — ni enana en 4K ni
            // gigante en 720p. Todo lo interno va en em. Aquí también se
            // publican la escala y los tiempos del foco (styles.ts).
            style={{ fontSize: 'clamp(18px, 2.2vh, 30px)', ...tvFocusVars }}
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
            {/* EL FONDO, en Fósforo: Cabinet con el arte de lo que estés
              mirando muy apagado y difuminado (crossfade con doble búfer),
              un velo ámbar muy suave arriba a la izquierda y las motas de
              fósforo de la biblioteca. Nada compite con el texto. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              {backdrop.previous && (
                <img
                  src={backdrop.previous}
                  alt=""
                  className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl saturate-[.8]"
                />
              )}
              {backdrop.current && (
                <img
                  key={backdrop.current}
                  src={backdrop.current}
                  alt=""
                  className="absolute inset-0 h-full w-full scale-110 animate-[fade-in_900ms_var(--ease-out)_both] object-cover opacity-25 blur-2xl saturate-[.8]"
                />
              )}
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(16_20_22/0.55)_0%,rgb(16_20_22/0.35)_40%,rgb(16_20_22/0.8)_100%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(60%_55%_at_0%_0%,rgb(255_179_71/0.08),transparent_70%)]" />
              <FireflyCanvas orbs={orbs} />
            </div>

            <TvHeader pathname={location.pathname} clock={clock} />

            <div className="relative min-h-0 flex-1 overflow-hidden px-[4vw] pt-[0.6em]">
              {/* Cada ruta entra con el screen-in del sistema. */}
              <div key={location.pathname} className="h-full min-h-0 animate-screen-in">
                <Outlet />
              </div>
            </div>

            {/* La leyenda: el manual permanente, en el idioma del dispositivo
              que hablara último. "Start menu" es un BOTÓN de verdad — el
              ratón también merece su puerta al menú. */}
            <div className="relative flex h-[2.9em] flex-none items-center gap-[1.6em] border-t border-line bg-cabinet/70 px-[4vw] text-[0.92em] text-dust">
              {mergedHints.map((hint) => (
                <span
                  key={`${hint.action}-${hint.label}`}
                  className="flex items-center gap-[0.5em]"
                >
                  <PadGlyph label={glyphs[hint.action]} primary={hint.action === 'a'} />
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
                className="ml-auto flex items-center gap-[0.5em] rounded-sm outline-hidden transition-colors duration-150 hover:text-bone focus-visible:outline-[0.12em] focus-visible:outline-offset-[0.12em] focus-visible:outline-phosphor"
              >
                <PadGlyph label={glyphs.start} />
                Start menu
              </button>
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
