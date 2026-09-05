import { Search, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameListItem } from '../../../shared/types';
import { useGames } from '../hooks/games';
import { useImageSrc } from '../hooks/useImageSrc';
import { consumeAmbientWake } from '../lib/ambientWake';
import { BLUE } from '../lib/colors';
import { formatHours } from '../lib/format';
import { useTvBackdrop } from './backdropContext';
import { useTvFocusable, useTvLayerIsActive } from './focusContext';
import { forgetLibrary, recallLibrary, rememberLibrary } from './screenMemory';
import { tvRevealClass, tvRevealStyle } from './styles';
import { TvGameTile } from './TvGameTile';
import { TvScreenTitle } from './TvScreenTitle';
import { TvKeyboard } from './TvKeyboard';
import { useTvInputDevice } from './inputDevice';
import { useTvButtons, useTvLegend } from './tvInput';

// La biblioteca entera a escala TV (BIG-PICTURE.md §5.2): parrilla de
// carátulas, filtros que son BOTONES de verdad (pulsables con A, con clic, y
// ciclables con LB/RB), y la búsqueda como chip visible — que exista un
// atajo (Y) no exime de que la puerta se VEA.

type FilterKey = 'all' | 'playing' | 'unplayed' | 'beaten' | 'endless';

const FILTERS: { key: FilterKey; label: string; match: (game: GameListItem) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'playing', label: 'Playing', match: (game) => game.currentState === 'started' },
  { key: 'unplayed', label: 'Unplayed', match: (game) => game.currentState === null },
  { key: 'beaten', label: 'Beaten', match: (game) => game.currentState === 'completed' },
  { key: 'endless', label: 'Endless', match: (game) => game.endless },
];

// Sin acentos y sin mayúsculas: "pokemon" tiene que encontrar a "Pokémon".
// (El filterByTitle de lib/search.ts no normaliza diacríticos; aquí, con un
// OSK sin tildes a propósito, la normalización no es opcional.)
const normalize = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// QUEDARSE UNA TECLA CUESTA DOS COSAS, y las dos van juntas siempre:
//
//  · preventDefault además de parar la propagación: frenar a los otros
//    listeners no frena la activación NATIVA (un Espacio con el foco DOM en
//    un botón lo clicaría en el keyup).
//  · avisar de la actividad a mano. stopImmediatePropagation en fase de
//    CAPTURA sobre window mata el evento en el PRIMER nodo del recorrido:
//    ningún listener de BURBUJA de window vuelve a verlo, y uno de ellos es
//    el bump de useIdle ('keydown' está en sus ACTIVITY_EVENTS, registrado
//    sin capture). Sin esta línea, teclear la búsqueda dejaba de contar como
//    tocar la app: entrabas con las flechas, escribías un rato mirando la
//    parrilla y el modo ambiente se te echaba encima a media palabra. Es el
//    mismo canal sintético que usa el mando (tv/gamepad.ts), que tampoco
//    genera eventos DOM.
const swallowKey = (event: KeyboardEvent): void => {
  event.preventDefault();
  event.stopImmediatePropagation();
  window.dispatchEvent(new CustomEvent('afterplay:activity'));
};

// Cuántas celdas VISIBLES a cada lado de la enfocada se registran siempre en
// el motor de foco, pase lo que pase con el observador de la ventana (ver
// dentro del componente). Son tres filas de seis a cada lado: el foco se
// mueve de fila en fila, así que con este colchón la pulsación contra el
// borde SIEMPRE tiene destino aunque el scroll venga todavía en camino. Sin
// él se perdían pulsaciones — medido: 23 de cada 40 flechas abajo no movían
// nada, porque el observador mide contra el scroll de AHORA y el conductor de
// scroll llega más tarde a propósito (es un muelle).
const FOCUS_NEIGHBOURS = 18;

const FilterPill = ({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      // El foco se dice como en las carátulas: luz DENTRO (anillo interior
      // que respira + barrido), y fuera solo una sombra suave. La elevación,
      // con translate — nunca scale (lección Chromium).
      className="relative overflow-hidden rounded-full px-[0.85em] py-[0.32em] text-[0.68em] font-bold transition-[background-color,color,box-shadow,translate] duration-200"
      style={{
        ...(active
          ? {
              background: 'linear-gradient(180deg, rgba(47,220,126,.22), rgba(47,220,126,.1))',
              color: '#2fdc7e',
              boxShadow: 'inset 0 0 0 1px rgba(47,220,126,.35)',
            }
          : {
              color: 'var(--muted-foreground)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
            }),
        ...(focused
          ? {
              background: 'rgba(47,220,126,.14)',
              color: '#2fdc7e',
              translate: '0 -0.1em',
              boxShadow: '0 0.2em 1em rgba(47,220,126,.25), 0 0.3em 0.8em rgba(0,0,0,.3)',
            }
          : {}),
      }}
    >
      {focused && (
        <>
          <span
            aria-hidden
            className="afterplay-tv-ring animate-[afterplay-tv-ring-breathe_2.2s_ease-in-out_infinite] pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: 'inset 0 0 0 2px rgba(47,220,126,.8)' }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
          >
            <span
              className="afterplay-tv-sheen animate-[afterplay-tv-sheen_850ms_cubic-bezier(0.3,0.6,0.3,1)_80ms_both] absolute inset-y-0 left-0 w-[45%]"
              style={{
                background:
                  'linear-gradient(105deg, transparent, rgba(255,255,255,.25), transparent)',
              }}
            />
          </span>
        </>
      )}
      <span className="relative">{label}</span>
    </button>
  );
};

// La puerta VISIBLE de la búsqueda (además del atajo Y/F): un chip que
// enseña la lupa, el texto activo y cuántos van quedando.
const SearchChip = ({
  query,
  count,
  onOpen,
  onClear,
}: {
  query: string;
  count: number;
  onOpen: () => void;
  onClear: () => void;
}): React.JSX.Element => {
  // UNA sola condicion para mando y raton: con la query en blanco (aunque
  // fueran espacios) el chip abre; con texto, limpia. Divergian y el primer
  // A sobre un chip "inactivo" parecia no hacer nada.
  const active = query.trim().length > 0;
  const { ref, focused } = useTvFocusable({ onSelect: active ? onClear : onOpen });
  return (
    <button
      ref={ref}
      type="button"
      onClick={active ? onClear : onOpen}
      // Con la query vacía el gesto ABRE el OSK, y esa apertura ya suena por
      // pushLayer — el confirmar encima era doble. Limpiar sí es una acción
      // propia y conserva su confirmar.
      data-tv-sound={active ? undefined : 'none'}
      // Mismo lenguaje de foco que los pills pero en el violeta de la
      // búsqueda: anillo interior respirando + barrido + sombra exterior.
      className="relative flex items-center gap-[0.45em] overflow-hidden rounded-full px-[0.85em] py-[0.32em] text-[0.68em] font-bold transition-[background-color,color,box-shadow,translate] duration-200"
      style={{
        ...(active
          ? {
              background: 'linear-gradient(180deg, rgba(124,134,200,.22), rgba(124,134,200,.11))',
              color: '#a9b3e8',
              boxShadow: 'inset 0 0 0 1px rgba(124,134,200,.35)',
            }
          : {
              background: 'rgba(255,255,255,.05)',
              color: 'var(--muted-foreground)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
            }),
        ...(focused
          ? {
              background: 'rgba(124,134,200,.16)',
              color: '#c3cbf2',
              translate: '0 -0.1em',
              boxShadow: '0 0.2em 1em rgba(124,134,200,.28), 0 0.3em 0.8em rgba(0,0,0,.3)',
            }
          : {}),
      }}
    >
      {focused && (
        <>
          <span
            aria-hidden
            className="afterplay-tv-ring animate-[afterplay-tv-ring-breathe_2.2s_ease-in-out_infinite] pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: 'inset 0 0 0 2px rgba(124,134,200,.75)' }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
          >
            <span
              className="afterplay-tv-sheen animate-[afterplay-tv-sheen_850ms_cubic-bezier(0.3,0.6,0.3,1)_80ms_both] absolute inset-y-0 left-0 w-[45%]"
              style={{
                background:
                  'linear-gradient(105deg, transparent, rgba(255,255,255,.22), transparent)',
              }}
            />
          </span>
        </>
      )}
      <Search
        className="relative h-[1.05em] w-[1.05em] flex-none"
        style={active || focused ? { filter: 'drop-shadow(0 0 0.35em rgba(124,134,200,.6))' } : {}}
      />
      <span className="relative flex items-center gap-[0.45em]">
        {active ? (
          <>
            “{query.trim()}” · {count}
            <X className="h-[1.05em] w-[1.05em] opacity-70" />
          </>
        ) : (
          'Search'
        )}
      </span>
    </button>
  );
};

export const TvLibrary = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [] } = useGames();
  // La vuelta de una ficha aterriza DONDE ESTABAS (screenMemory): mismo
  // filtro, misma búsqueda, mismo scroll y el foco en la carátula que
  // abriste. recall es lectura pura (StrictMode-safe); el forget de más
  // abajo hace que solo la PRIMERA remontada tras la ficha lo herede.
  const [snapshot] = useState(recallLibrary);
  useEffect(() => {
    forgetLibrary();
  }, []);
  const [filterIndex, setFilterIndex] = useState(snapshot?.filterIndex ?? 0);
  const [query, setQuery] = useState(snapshot?.query ?? '');
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const filter = FILTERS[filterIndex];
  // La aguja vive fuera del memo: además de filtrar, es la KEY que gobierna
  // el fundido de la parrilla al refiltrar (ver abajo).
  const needle = normalize(query.trim());
  const visible = useMemo(() => {
    const byFilter = games.filter(filter.match);
    return needle ? byFilter.filter((game) => normalize(game.title).includes(needle)) : byFilter;
  }, [games, filter, needle]);

  const totalHours = useMemo(
    () => visible.reduce((sum, game) => sum + game.totalHours, 0),
    [visible],
  );

  // El fondo respira con el primer juego visible: estable dentro de un
  // filtro, y cambia con intención al cambiar de filtro o buscar.
  const backdropSrc = useImageSrc(visible[0]?.heroUrl ?? null, 'heroes');
  useTvBackdrop(backdropSrc);

  const cycleFilter = (step: number): void => {
    setFilterIndex((index) => (index + step + FILTERS.length) % FILTERS.length);
  };

  // LB/RB ciclan el filtro; Y abre la búsqueda; con filtro de texto activo y
  // el OSK cerrado, B primero LIMPIA la búsqueda y solo el siguiente B sale
  // de la pantalla (el OSK, cuando está abierto, registra su propia B encima
  // de esta).
  useTvButtons({
    lb: () => cycleFilter(-1),
    rb: () => cycleFilter(1),
    y: () => setKeyboardOpen(true),
    ...(query.length > 0 && !keyboardOpen ? { b: () => setQuery('') } : {}),
  });
  // LA LEYENDA NO PUEDE ANUNCIAR LO QUE ESTA PANTALLA SE TRAGA. Con teclado
  // el pie pinta los glifos de KEY_GLYPHS (BigPictureLayout): LB/RB serían
  // "Q·E" e Y sería "F"... y aquí abajo el capture se queda esas tres letras
  // para escribirlas en la búsqueda, antes de que el espejo del shell pudiera
  // traducirlas a botones. Anunciarlas sería vender tres atajos muertos, así
  // que con teclado esta pantalla no promete nada extra: la búsqueda se abre
  // TECLEANDO (y el chip de arriba está ahí para verse), y el filtro son
  // pills que son botones de verdad, a un par de flechas. Mismo reparto y
  // mismo motivo que el OSK (TvKeyboard).
  //
  // Lo que la leyenda NO dice, y es a sabiendas: mientras hay texto escrito,
  // B limpia en vez de salir, pero el pie sigue anunciando "Back". Una pista
  // que dependa de la query sería otra fuente de parpadeo en el pie por un
  // matiz que se descubre solo al usarlo.
  //
  // Cambiar de pistas aquí (esto depende del dispositivo) ya NO recoloca la
  // leyenda: la pila de BigPictureLayout es de huecos estables y un cambio de
  // contenido se queda en su capa (ver TvLegendSlot en tvInput.ts). El caso
  // que obligó a arreglarla fue exactamente esta línea — coger el mando con
  // el OSK abierto re-registraba esta leyenda ENCIMA de la del teclado y el
  // pie anunciaba "Filter"/"Search" bajo un velo que se come esos botones.
  const device = useTvInputDevice();
  useTvLegend(
    device === 'gamepad'
      ? [
          { action: 'lbrb', label: 'Filter' },
          { action: 'y', label: 'Search' },
        ]
      : [],
  );

  // TECLEAR FILTRA (§5.2, el caso literal de Moonlight: teclado físico
  // reenviado a la tele). Sin esto las letras caían en el espejo de teclado
  // del shell (BigPictureLayout), que las lee como BOTONES: escribir "quest"
  // no buscaba nada y encima movía cosas — la 'q' saltaba al filtro anterior,
  // la 'e' al siguiente, la 'f' abría el OSK, la 'x' disparaba la acción
  // secundaria y la 'm' el menú Start. Se acababa con otro filtro y sin
  // búsqueda.
  //
  // Mismo embudo que el OSK (TvKeyboard) y por el mismo motivo en CAPTURA:
  // ese espejo escucha en burbuja sobre window, así que hay que llegar antes
  // que él y cortarle el paso (con las dos deudas que paga swallowKey).
  //
  // El texto se acumula con el updater funcional, no leyendo `query` del
  // closure: así lo escrito no depende de que React vacíe la actualización de
  // un keydown antes de que llegue el siguiente, y el efecto puede declarar
  // dependencias en vez de re-suscribirse en CADA render. De la query solo
  // hace falta saber si está vacía (`searching`), que es lo único que cambia
  // el comportamiento de Backspace y del Espacio.
  //
  // El precio, asumido (es la misma renuncia que ya hace el OSK mientras está
  // abierto): en ESTA pantalla las letras del espejo dejan de ser atajos —
  // por eso la leyenda de arriba no las anuncia con teclado. El filtro se
  // cicla con LB/RB (mando) y todo lo demás sigue en teclas que no son letras
  // — flechas, Enter, Escape (que además limpia la búsqueda antes de salir).
  const layerActive = useTvLayerIsActive();
  const searching = query.length > 0;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Solo cuando manda ESTA pantalla: con el OSK o el menú Start apilados
      // encima, las teclas son suyas. Y con el salvapantallas puesto la tecla
      // solo despierta — misma regla que el mando (gamepad.ts); por eso estas
      // salidas se van SIN tragarse nada: el evento tiene que seguir su
      // camino hasta el bump de useIdle.
      if (!layerActive || keyboardOpen) return;
      // El sello de lib/ambientWake es el respaldo del atributo — misma
      // carrera de commit que en BigPictureLayout.
      if (document.querySelector('[data-afterplay-ambient]') !== null) return;
      if (consumeAmbientWake()) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Backspace') {
        if (!searching) return;
        swallowKey(event);
        setQuery((previous) => previous.slice(0, -1));
        return;
      }
      // El Espacio sigue siendo A (confirmar) mientras no haya nada escrito:
      // solo CONTINÚA una búsqueda ya empezada, para poder teclear "final
      // fantasy" entero. Un espacio suelto sobre la parrilla abre la ficha
      // enfocada, como siempre.
      if (event.key === ' ' && !searching) return;
      if (event.key.length !== 1) return;
      swallowKey(event);
      setQuery((previous) => previous + event.key);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [layerActive, keyboardOpen, searching]);

  // El conjunto visible para decidir POR CELDA si está desplegada — la
  // parrilla monta SIEMPRE todos los juegos y solo anima anchura/opacidad
  // (ver abajo): filtrar es plegar y desplegar, no desmontar.
  //
  // Y con el PUESTO que ocupa cada una en la parrilla desplegada (0, 1, 2…),
  // no solo la pertenencia: la ventana de foco de más abajo se cuenta en
  // celdas VISIBLES, que son las que ocupan sitio. Contarla por índice de
  // biblioteca era un bug real: con un filtro que deja 1 de cada 7, ±18 de
  // índice son dos celdas y media de parrilla — media fila — y el foco se
  // quedaba sin vecinos registrados hacia abajo.
  const visibleRank = useMemo(
    () => new Map(visible.map((game, rank) => [game.id, rank])),
    [visible],
  );
  // El foco inicial: la carátula desde la que te fuiste a la ficha (si
  // sigue visible con el filtro restaurado) — si no, la primera del match.
  const firstMatchId =
    snapshot && visibleRank.has(snapshot.focusGameId)
      ? snapshot.focusGameId
      : (visible[0]?.id ?? null);

  // El acento del estado vacío cuenta el PORQUÉ está vacío: violeta si fue la
  // búsqueda, verde si fue el filtro.
  const emptyAccent = needle ? '#7c86c8' : '#2fdc7e';

  // SOLO SE REGISTRA EN EL MOTOR DE FOCO LO QUE ESTÁ CERCA DEL VIEWPORT, y
  // esto arregla el peor parón medido de todo el modo TV: 600 ms.
  //
  // El motor de foco (focus.tsx) decide el destino de cada pulsación por
  // GEOMETRÍA: en cada move() mide el rect de TODOS los registrados de la
  // capa. Con la parrilla entera montada eso eran 1001 getBoundingClientRect
  // — y ahí choca con el content-visibility de las celdas: consultar la
  // geometría de una celda SALTADA la obliga a maquetarse, y como maquetarla
  // cambia su alto, ensucia la parrilla entera para la siguiente. Medido con
  // los 994 juegos reales: la PRIMERA pulsación de mando al entrar en Library
  // costaba 619 ms (y 694 ms al volver a entrar, porque la pantalla remonta y
  // Chromium vuelve a saltarse lo de fuera del viewport) — medio segundo de
  // pantalla congelada, que en una tele por Moonlight son 40 frames perdidos.
  // El desglose deja claro dónde estaba: los 48 primeros botones (los que ya
  // están maquetados porque caen dentro o cerca del viewport) 0,9 ms; los 52
  // siguientes 31 ms; los 800 restantes 526 ms.
  //
  // Con la ventana, el motor solo ve las celdas que Chromium ya tiene
  // maquetadas de todas formas: esa primera pulsación baja a 4,4 ms y las de
  // después de 7,0 ms a 4,4 ms (el escaneo de rects pasa de 3,3 ms a
  // décimas). Nada más cambia: las celdas siguen TODAS montadas (el FLIP las
  // necesita), se pintan igual, el montaje de la pantalla cuesta lo mismo
  // (126 ms) y el ratón sigue pudiendo clicar lo que ve.
  //
  // La ventana son DOS cosas sumadas, y hacen falta las dos:
  //
  //  · Lo que el observador ve cerca del viewport (un viewport de margen
  //    arriba y abajo). Es lo que el RATÓN puede señalar: el hover mueve el
  //    foco, y solo puede hacerlo sobre algo registrado.
  //  · Las FOCUS_NEIGHBOURS celdas a cada lado de la enfocada. El observador
  //    mide contra el scroll de ahora mismo y el conductor de scroll llega
  //    tarde a propósito (es un muelle): sin este colchón, bajar deprisa
  //    dejaba al foco sin destino registrado justo debajo — 23 de cada 40
  //    flechas se perdían.
  //
  // Mientras el observador no ha hablado — el primer commit — el ancla es el
  // foco inicial: sin eso la pantalla nacería sin nada que enfocar.
  const [nearIds, setNearIds] = useState<Set<number> | null>(null);
  const [focusedGameId, setFocusedGameId] = useState<number | null>(null);
  const focusAnchor =
    (focusedGameId !== null ? visibleRank.get(focusedGameId) : undefined) ??
    (firstMatchId !== null ? (visibleRank.get(firstMatchId) ?? 0) : 0);
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const near = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = Number((entry.target as HTMLElement).dataset.cellId);
          if (entry.isIntersecting) {
            if (!near.has(id)) {
              near.add(id);
              changed = true;
            }
          } else if (near.delete(id)) changed = true;
        }
        if (changed) setNearIds(new Set(near));
      },
      { root: grid, rootMargin: '100% 0px' },
    );
    for (const cell of grid.querySelectorAll('[data-cell-id]')) observer.observe(cell);
    return () => observer.disconnect();
    // Se rearma cuando cambia el CENSO de celdas (la biblioteca crece o
    // encoge), no cuando cambia el filtro: filtrar no monta ni desmonta nada.
    // Un juego que se sustituye por otro sin cambiar el total dejaría su celda
    // nueva sin observar hasta el siguiente rearme, y da igual: la ventana de
    // vecinos del foco no depende del observador, así que el mando nunca se
    // queda sin destino — como mucho el ratón no puede robarle el foco a esa
    // carátula concreta hasta que la lista cambie de tamaño.
  }, [games.length]);

  // EL FLIP de la parrilla: React asienta el layout nuevo de golpe (un solo
  // reflow) y aquí, ANTES del paint, cada celda superviviente que cambió de
  // sitio se clava en su posición vieja con un transform y se suelta hacia
  // cero — el deslizamiento entero corre en el compositor, sin tocar layout
  // ni repintar carátulas por frame. Las posiciones se miden con
  // offsetLeft/Top (inmunes a scroll y a los propios transforms). Las que
  // APARECEN entran con un pop de opacidad+escala en su sitio final; las que
  // se van desaparecen al instante — su hueco ya se está cerrando con el
  // deslizamiento de las demás, y ese gesto es el que se lee.
  //
  // El scroll vuelve a su sitio ANTES del primer paint (layout effect): la
  // parrilla remonta ya colocada, sin fogonazo del principio de la lista. El
  // foco restaurado no lo pelea: su scrollIntoView es 'nearest' y la
  // carátula ya está a la vista.
  useLayoutEffect(() => {
    if (snapshot && gridRef.current) gridRef.current.scrollTop = snapshot.scrollTop;
  }, [snapshot]);
  const cellSpotsRef = useRef(new Map<number, { left: number; top: number; visible: boolean }>());
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const stored = cellSpotsRef.current;
    const cells = grid.querySelectorAll<HTMLElement>('[data-cell-id]');
    const moves: { el: HTMLElement; dx: number; dy: number }[] = [];
    const enters: HTMLElement[] = [];
    const next = new Map<number, { left: number; top: number; visible: boolean }>();
    for (const el of cells) {
      const id = Number(el.dataset.cellId);
      const isVisible = el.dataset.cellVisible === 'true';
      const spot = { left: el.offsetLeft, top: el.offsetTop, visible: isVisible };
      next.set(id, spot);
      if (!isVisible) continue;
      const prev = stored.get(id);
      if (!prev || !prev.visible) {
        // En el primer montaje no hay "antes": la cascada de reveal ya pone
        // la entrada — el pop es solo para las que vuelven al refiltrar.
        if (stored.size > 0) enters.push(el);
        continue;
      }
      // Si la celda sigue deslizándose de un FLIP anterior (tecleo rápido),
      // el punto de partida es su posición VISUAL: layout viejo + transform
      // en vuelo. offsetLeft ignora transforms, así que el desplazamiento en
      // curso se lee del computed style — sin esto, cada letra daría un
      // micro-salto al reiniciar el deslizamiento desde el sitio equivocado.
      let inFlightX = 0;
      let inFlightY = 0;
      const currentTransform = getComputedStyle(el).transform;
      if (currentTransform && currentTransform !== 'none') {
        const matrix = currentTransform.match(/matrix\(([^)]+)\)/);
        if (matrix) {
          const parts = matrix[1].split(',');
          inFlightX = parseFloat(parts[4]) || 0;
          inFlightY = parseFloat(parts[5]) || 0;
        }
      }
      const dx = prev.left + inFlightX - spot.left;
      const dy = prev.top + inFlightY - spot.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moves.push({ el, dx, dy });
    }
    cellSpotsRef.current = next;
    if (moves.length === 0 && enters.length === 0) return;
    for (const { el, dx, dy } of moves) {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    for (const el of enters) {
      el.style.transition = 'none';
      el.style.transform = 'scale(.92)';
      el.style.opacity = '0';
    }
    // Forzar el layout con la inversión puesta: la transición parte de ahí.
    void grid.offsetHeight;
    for (const { el } of moves) {
      el.style.transition = 'transform 300ms cubic-bezier(.22,1,.36,1)';
      el.style.transform = '';
    }
    for (const el of enters) {
      el.style.transition = 'transform 240ms cubic-bezier(.22,1,.36,1), opacity 200ms ease';
      el.style.transform = '';
      // A '' — vuelve al 1 que pinta React; el inline solo vive un frame.
      el.style.opacity = '';
    }
    // visibleRank y NO sin array: sin dependencias esto forzaba un reflow
    // completo (querySelectorAll + offsetLeft/Top de CADA celda montada, la
    // biblioteca entera) en CUALQUIER re-render — una sync de logros de
    // fondo, el watcher, cualquier mutation ajena — no solo al filtrar o
    // buscar, que es lo único que de verdad puede haber movido algo.
  }, [visibleRank]);

  // El billete de vuelta (screenMemory): al abrir una ficha se guarda el
  // sitio exacto — filtro, query, scroll y qué carátula era. Solo este
  // viaje lo guarda: salir a Home u otra pantalla no deja migas.
  const openGame = (id: number): void => {
    rememberLibrary({
      filterIndex,
      query,
      scrollTop: gridRef.current?.scrollTop ?? 0,
      focusGameId: id,
    });
    void navigate(`/tv/game/${id}`);
  };

  return (
    <div className="flex h-full flex-col">
      <div
        className={`mb-[0.8em] flex flex-none flex-wrap items-center gap-x-[0.9em] gap-y-[0.4em] ${tvRevealClass}`}
        style={tvRevealStyle(0)}
      >
        <TvScreenTitle label="Library" accent={BLUE} />
        <div className="flex items-center gap-[0.3em]">
          {FILTERS.map((entry, index) => (
            <FilterPill
              key={entry.key}
              label={entry.label}
              active={index === filterIndex}
              onSelect={() => setFilterIndex(index)}
            />
          ))}
        </div>
        <SearchChip
          query={query}
          count={visible.length}
          onOpen={() => setKeyboardOpen(true)}
          onClear={() => setQuery('')}
        />
        <span className="ml-auto text-[0.68em] font-semibold text-muted-foreground tabular-nums">
          {/* key=length: el contador no salta de número, se FUNDE al nuevo —
              el mismo lenguaje líquido que la parrilla al refiltrar. */}
          <span key={visible.length} className="animate-in fade-in-0 inline-block duration-300">
            {visible.length} {visible.length === 1 ? 'game' : 'games'}
            {totalHours > 0 && (
              <span className="text-muted-foreground/60"> · {formatHours(totalHours)}</span>
            )}
          </span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* LA PARRILLA LÍQUIDA, versión FLIP: montan SIEMPRE todos los
            juegos, en el mismo orden, y al refiltrar la parrilla SALTA a su
            estado final en UN solo layout (anchuras 16.6% ↔ 0 sin
            transición). El deslizamiento lo pone el efecto de abajo: mide
            dónde estaba cada celda, la clava en su posición vieja con un
            transform y suelta la transición hacia cero — transform puro,
            compositor, CERO reflow por frame. La primera versión animaba la
            ANCHURA y eso reflowaba (y re-rasterizaba) la parrilla entera en
            cada frame: el lag que se notaba al filtrar y al escribir. */}
        <div
          ref={gridRef}
          // scroll-py: el conductor de scroll respeta scroll-padding, así que
          // la fila que entra a la vista aterriza SEPARADA del borde donde
          // recorta este contenedor. Sin ese colchón, el foco levanta la
          // carátula unos píxeles (translate) y el canto superior asomaba
          // fuera del clip: la primera fila se veía cortada. Mismo arreglo
          // que ya lleva el Home, aquí arriba y abajo porque la parrilla se
          // recorre en las dos direcciones.
          className="-mx-[0.6em] flex h-full scroll-py-[0.7em] flex-wrap content-start gap-y-[1.1em] overflow-y-auto px-[0.6em] pt-[0.7em] pb-[1.5em]"
          style={{ scrollbarWidth: 'none' }}
        >
          {games.map((game, index) => {
            const rank = visibleRank.get(game.id);
            const match = rank !== undefined;
            // Ver la ventana de foco arriba: fuera de ella la celda sigue
            // montada y visible, pero no entra en el motor de foco.
            const near =
              (match && Math.abs(rank - focusAnchor) <= FOCUS_NEIGHBOURS) ||
              (nearIds?.has(game.id) ?? false);
            return (
              <div
                key={game.id}
                aria-hidden={!match}
                data-cell-id={game.id}
                data-cell-visible={match ? 'true' : 'false'}
                data-cell-near={near ? 'true' : 'false'}
                className="min-w-0"
                style={{
                  width: match ? 'calc(100%/6)' : '0%',
                  opacity: match ? 1 : 0,
                  // Sin transición aquí: el movimiento es del FLIP (transform
                  // imperativo). content-visibility deja el contenido de las
                  // celdas fuera del viewport sin maquetar ni pintar.
                  contentVisibility: 'auto',
                  containIntrinsicSize: 'auto 16em',
                }}
              >
                {/* El respiro entre columnas vive DENTRO de la celda (pr en
                    vez de gap del contenedor): una celda plegada pliega
                    también su hueco. disabled saca a las ocultas del motor
                    de foco — sin fantasmas navegables ni A sobre invisibles. */}
                <div className="pr-[0.9em]">
                  <TvGameTile
                    game={game}
                    fill
                    disabled={!match || !near}
                    autoFocus={game.id === firstMatchId}
                    revealIndex={index}
                    onOpen={() => openGame(game.id)}
                    // El ancla de la ventana de foco: la parrilla necesita
                    // saber DÓNDE está el foco para registrar a sus vecinos.
                    onFocusSpot={() => setFocusedGameId(game.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {visible.length === 0 && (
          // El vacío también es un sitio: la lupa flota en un disco de
          // cristal con su halo respirando. Superpuesto a la parrilla (que
          // queda toda plegada debajo) para no desmontarla jamás.
          <div className="animate-in fade-in-0 zoom-in-95 pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center duration-300">
            <div
              className="afterplay-tv-float animate-[afterplay-tv-float_5.5s_ease-in-out_infinite] relative mb-[0.9em] flex h-[3.4em] w-[3.4em] items-center justify-center rounded-full"
              style={{
                background: 'rgba(255,255,255,.04)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)',
              }}
            >
              <span
                aria-hidden
                className="afterplay-tv-glow animate-[afterplay-tv-glow-breathe_2.6s_ease-in-out_infinite] absolute inset-0 rounded-full"
                style={{ boxShadow: `0 0 1.8em ${emptyAccent}45` }}
              />
              <Search
                className="h-[1.4em] w-[1.4em]"
                style={{ color: emptyAccent, filter: `drop-shadow(0 0 0.5em ${emptyAccent}80)` }}
              />
            </div>
            <div className="text-[0.95em] font-bold">Nothing here</div>
            <div className="mt-[0.3em] text-[0.72em] text-muted-foreground">
              {query ? 'No titles match that search.' : 'No games under this filter.'}
            </div>
          </div>
        )}
      </div>

      {keyboardOpen && (
        <TvKeyboard
          value={query}
          onChange={setQuery}
          onClose={() => setKeyboardOpen(false)}
          placeholder="Search your library"
          hint={`${visible.length} ${visible.length === 1 ? 'match' : 'matches'}`}
          // Los primeros resultados como atajo: elegir uno abre su ficha
          // directamente — para eso se busca. Solo con aguja: sin escribir,
          // "sugerir" sería enseñar la parrilla que ya se ve detrás.
          suggestions={
            needle
              ? visible
                  .slice(0, 5)
                  .map((game) => ({ id: game.id, label: game.title, coverUrl: game.coverUrl }))
              : []
          }
          onSuggestion={openGame}
        />
      )}
    </div>
  );
};
