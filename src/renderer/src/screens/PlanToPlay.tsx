import { Bookmark, CalendarClock, Gamepad2, ListOrdered, Pin, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AddGameModal } from '../components/library/AddGameModal';
import type { IgdbSearchResult } from '../../../shared/types';
import { PlanDebtHeader } from '../components/plan/PlanDebtHeader';
import { PlanLensChips } from '../components/plan/PlanLensChips';
import { PlanRow } from '../components/plan/PlanRow';
import { FlipList } from '../components/plan/FlipList';
import { PlanSectionHeading } from '../components/plan/PlanSectionHeading';
import { RadarRow } from '../components/plan/RadarRow';
import { UpNextList } from '../components/plan/UpNextList';
import { WhereToAddDialog } from '../components/library/WhereToAddDialog';
import {
  useExternalRefreshProgress,
  useIsExternalRefreshRunning,
  useRefreshPlanData,
} from '../hooks/external';
import { usePlannedGames, useSetPlanPinned } from '../hooks/games';
import { useDismissRadarGame, useRadarGames } from '../hooks/radar';
import { getStoredScroll, useScrollMemory } from '../hooks/useScrollMemory';
import { AMBER, GRAY, GREEN, TEAL, VIOLET } from '../lib/colors';
import { STATUS_META } from '../lib/gameStatus';
import type { PlanLens } from '../lib/plan';
import { computePlanDebt, splitPlanSections } from '../lib/plan';
import { countdownLabel, releaseCountdown, releaseSortKey } from '../lib/releaseDate';
import {
  accentGradientStyle,
  expandClass,
  outlineButtonClass,
  revealClass,
  revealStyle,
} from '../lib/styles';

const PLAN_COLOR = STATUS_META.plan.color;

// El montaje POR TANDAS de la cola — el arreglo del lag de 1-2s al entrar.
//
// El coste real de abrir el Plan no era la query (cacheada, staleTime
// Infinity): era montar de golpe cientos de PlanRow —cada una con carátula,
// chips, medición de clamp y su resolución de imagen— ANTES del primer
// pintado. El clic se quedaba congelado pagando todo ese trabajo por filas
// que ni siquiera caben en pantalla.
//
// Ahora el primer render monta solo lo que llena el primer pantallazo, y el
// resto entra en tandas en el TIEMPO SOBRANTE de los frames siguientes — para
// cuando el ojo termina de leer la cabecera, la lista está completa.
//
// Volver de una ficha con scroll guardado necesita más filas de salida
// (useScrollMemory restaura scrollTop al enganchar el contenedor, y si el
// contenido es más corto el navegador recorta el salto y aterrizas donde no
// estabas). Pero "más" NO es "todas": la primera versión montaba la cola
// entera en ese caso, y eso era justo el 1-2s de congelación al pulsar "Back
// to plan" — con viewTransition, la pantalla se queda en la foto CONGELADA de
// la ficha mientras React monta, así que el retraso se veía entero como un
// botón que no responde. Ahora se calcula cuántas filas hacen falta para que
// el scroll guardado quepa, y el resto sigue entrando por tandas como
// siempre.
//
// requestIdleCallback y NO requestAnimationFrame, y esta es la diferencia
// entre "entra rápido" y "entra rápido Y suave": rAF dispara justo ANTES de
// pintar cada frame, así que la tanda se montaba dentro del presupuesto del
// mismo frame que tenía que estar dibujando la animación de entrada — el
// trabajo se comía los 16ms y la animación daba tirones. El idle callback
// corre en el tiempo QUE SOBRA después de pintar, y si no sobra ninguno se
// aplaza solo: la animación cobra primero siempre, y las filas se cuelan por
// los huecos. El `timeout` es la red de seguridad para que una pantalla que
// nunca se queda quieta no deje la cola a medias.
//
// Tandas más pequeñas por el mismo motivo: 80 filas no caben en ningún hueco
// de tiempo real, así que la tanda se pasaba de largo igual y volvía a
// bloquear. 24 es lo que cabe holgado en un respiro de frame.
const INITIAL_QUEUE_ROWS = 14;
const QUEUE_ROWS_PER_BATCH = 24;
const QUEUE_BATCH_TIMEOUT_MS = 120;
const PLAN_SCROLL_KEY = 'plan';

// Alto de fila para la cuenta del scroll restaurado. A propósito por DEBAJO
// del mínimo real (una fila pelada mide ~156px: carátula de 128 + padding):
// quedarse corto en el alto significa pasarse en el número de filas, que es
// el error inofensivo — sobran unas pocas. Al revés, el scroll aterrizaría
// más arriba de donde estabas.
const ESTIMATED_ROW_HEIGHT = 150;
const SCROLL_RESTORE_BUFFER_ROWS = 8;

// Cuántas filas montar en el PRIMER render. Sin scroll guardado, lo que llena
// el primer pantallazo; con él, lo justo para que el punto guardado exista.
const initialQueueRows = (): number => {
  const scroll = getStoredScroll(PLAN_SCROLL_KEY);
  if (scroll <= 0) return INITIAL_QUEUE_ROWS;
  // El scrollTop incluye todo lo de arriba (cabecera, deuda, horizonte, Up
  // next), así que dividirlo entero entre el alto de fila se pasa de largo —
  // otra vez el error que sobra en vez del que falta.
  return (
    Math.ceil((scroll + window.innerHeight) / ESTIMATED_ROW_HEIGHT) + SCROLL_RESTORE_BUFFER_ROWS
  );
};

// requestIdleCallback existe en Chromium (y por tanto en Electron), pero se
// deja el respaldo a rAF por si el runtime de turno no lo trae: peor cadencia,
// nunca una cola sin terminar.
const scheduleIdle = (run: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: QUEUE_BATCH_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const handle = requestAnimationFrame(run);
  return () => cancelAnimationFrame(handle);
};

// Sección Plan to Play — pantalla PROPIA desde PLAN-TO-PLAY.md §1.
//
// Nació reutilizando GameListScreen, la misma pantalla que Library, cuyo
// propio comentario presumía de que las dos eran "~90% idénticas". Razonable
// para nacer, pero heredó el diseño de OTRA pregunta:
//
//   Library → "¿qué tengo y qué estoy jugando?" → reconocimiento → parrilla
//   Plan    → "¿qué juego a continuación?"      → DECISIÓN      → datos
//
// Una parrilla de 262 carátulas iguales esconde justo lo que la decisión
// necesita. El orden vertical:
//
//   deuda honesta → horizonte (plegado) → Up next → la cola con sus lentes
//
// El horizonte arriba pero PLEGADO es el equilibrio: cerrada es un renglón
// que no compite con lo jugable, y aún así sus noticias ("Out today!", lo
// que el radar encontró) quedan a un clic de la entrada, no enterradas bajo
// doscientas filas.
//
// Lo que NO cambia (§1.1): la búsqueda, el modal de alta en modo 'plan', la
// ficha del planeado y toda la fontanería. La divergencia es de PRESENTACIÓN.
export const PlanToPlay = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [], isLoading, isError, refetch } = usePlannedGames();
  const { attachRef, onScroll } = useScrollMemory<HTMLDivElement>(PLAN_SCROLL_KEY);
  const [queueLimit, setQueueLimit] = useState(initialQueueRows);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [lens, setLens] = useState<PlanLens>('oldest');
  // Plegado por defecto: lo que aún no ha salido no compite con lo jugable.
  const [horizonOpen, setHorizonOpen] = useState(false);
  // Up next arranca ABIERTA, al revés que el horizonte: es la sección
  // accionable de la pantalla, y esconder por defecto aquello a lo que te has
  // comprometido sería esconder la respuesta. Se pliega porque con la
  // estantería llena hay que hacer scroll por encima de ocho compromisos cada
  // vez que lo que quieres es rebuscar en la cola.
  const [upNextOpen, setUpNextOpen] = useState(true);

  const { data: radarGames = [] } = useRadarGames();
  const dismissRadar = useDismissRadarGame();
  // Un descubrimiento del radar que quieres: no está en ninguna parte
  // todavía, así que hay que preguntar dónde va (el mismo intermedio que el
  // carrusel de la saga, §3.4).
  const [pendingAdd, setPendingAdd] = useState<IgdbSearchResult | null>(null);
  const [addTo, setAddTo] = useState<{ where: 'plan' | 'library'; game: IgdbSearchResult } | null>(
    null,
  );

  const setPinned = useSetPlanPinned();
  const refresh = useRefreshPlanData();
  // El "ocupado" viene del MAIN, no de la mutation: la pasada sobrevive a
  // salir de esta pantalla (y el aviso de que termino llega estes donde
  // estes, desde la suscripcion unica de Afterplay.tsx). Sin esto, volver al
  // Plan a mitad de refresco encontraba el boton como si no pasara nada — y
  // un segundo clic habria arrancado una pasada duplicada.
  const refreshing = useIsExternalRefreshRunning();
  const progress = useExternalRefreshProgress();

  // Memoizados porque el montaje por tandas repinta esta pantalla decenas de
  // veces seguidas, y sin esto cada repintado rehacía tres filtrados y dos
  // ordenaciones sobre la lista entera para devolver exactamente lo mismo —
  // con un Plan de cientos, eso es basura que generar y recoger en el mismo
  // hueco de frame en el que se está montando la siguiente tanda.
  const { upNext, queue, horizon } = useMemo(() => splitPlanSections(games, lens), [games, lens]);
  const debt = useMemo(() => computePlanDebt(games), [games]);

  // La siguiente tanda, en el primer hueco de tiempo libre tras pintar la
  // anterior (ver scheduleIdle). El cleanup cancela la pendiente si la
  // pantalla se desmonta a mitad.
  useEffect(() => {
    if (queueLimit >= queue.length) return;
    return scheduleIdle(() => setQueueLimit((limit) => limit + QUEUE_ROWS_PER_BATCH));
  }, [queueLimit, queue.length]);
  const visibleQueue = queueLimit >= queue.length ? queue : queue.slice(0, queueLimit);

  // El horizonte junta las DOS fuentes de §2.5 y las ordena por cercanía: da
  // igual quién lo apuntara, lo que se pregunta es qué llega antes.
  const horizonItems = [
    ...horizon.map((game) => ({ kind: 'plan' as const, game, at: releaseSortKey(game) })),
    ...radarGames.map((game) => ({ kind: 'radar' as const, game, at: releaseSortKey(game) })),
  ].sort((a, b) => a.at - b.at);

  // La noticia más urgente del horizonte, para susurrarla en la cabecera
  // MIENTRAS está plegado: una sección cerrada no puede ser una caja negra
  // justo la semana en que algo sale. "Iron Nest · Out today!" en la propia
  // cabecera es lo que hace que plegarla por defecto no esconda nada — la
  // lista está ordenada por cercanía, así que el primero con cuenta atrás
  // urgente ES el titular.
  const horizonHeadline = ((): { title: string; label: string; color: string } | null => {
    for (const item of horizonItems) {
      const countdown = releaseCountdown(item.game);
      if (!countdown) continue;
      const urgent = countdown.kind !== 'soon' || countdown.imminent ? countdown : null;
      if (!urgent) break;
      return {
        title: item.game.title,
        label: countdownLabel(urgent),
        color: urgent.kind === 'out-now' ? GREEN : AMBER,
      };
    }
    return null;
  })();

  // Vacío es vacío del PLAN: un radar con descubrimientos no convierte una
  // lista vacía en una lista — son juegos que ni tienes ni has apuntado.
  const isEmpty = games.length === 0;

  const openGame = (id: number): void => {
    void navigate(`/plan/${id}`);
  };

  // El juego que ACABA de cambiar de estantería por un pin/unpin, Y HACIA
  // DÓNDE. El destino no es un adorno del estado: es lo que impide que la
  // animación se dispare en el sitio equivocado.
  //
  // El bug que arregla (parpadeo real al fijar): la marca era solo el id, así
  // que en cuanto se pulsaba el pin, la fila —que en ese instante SIGUE en la
  // cola, porque la mutation aún no ha vuelto— se pintaba con la animación de
  // llegada puesta. Como el keyframe arranca casi transparente, la fila se
  // apagaba y volvía EN SU SITIO VIEJO… y después, al montarse arriba,
  // animaba otra vez. Dos animaciones, la primera donde no tocaba.
  //
  // Con el destino guardado, solo la sección a la que el juego LLEGA enciende
  // la animación; la que lo pierde no hace nada.
  const [justMoved, setJustMoved] = useState<{ id: number; toUpNext: boolean } | null>(null);
  const justMovedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(justMovedTimer.current ?? undefined), []);

  // Marcas de llegada por sección: cada fila solo anima si ESTA es su destino.
  const landingInUpNext = justMoved?.toUpNext === true ? justMoved.id : null;
  const landingInQueue = justMoved?.toUpNext === false ? justMoved.id : null;

  const togglePin = (id: number, pinned: boolean): void => {
    setJustMoved({ id, toUpNext: pinned });
    clearTimeout(justMovedTimer.current ?? undefined);
    // Ventana holgada sobre los 750ms de la animación: cubre el viaje por
    // IPC sin arriesgarse a que una segunda pasada la re-dispare.
    justMovedTimer.current = setTimeout(() => setJustMoved(null), 1200);
    setPinned.mutate(
      { id, pinned },
      {
        onError: () => toast.error("Couldn't update Up next."),
      },
    );
  };

  const runRefresh = (): void => {
    refresh.mutate(undefined, {
      // Solo el fallo de ARRANCAR la pasada (leer la lista de planeados). El
      // de la pasada en si llega por evento, con su propio toast.
      onError: () => toast.error("Couldn't start the refresh."),
    });
  };

  // Mientras corre, el botón cuenta por dónde va. Solo la fase de Steam
  // avanza juego a juego (IGDB entero son 1-2 peticiones que vuelan), así que
  // es la única a la que se le puede poner un porcentaje sin inventárselo: en
  // las otras dos el botón lo dice con palabras y su barra late en vez de
  // avanzar. Con un Plan grande esa fase son minutos.
  const measurable = refreshing && progress?.phase === 'steam' && progress.total > 0;
  const refreshPercent = measurable && progress ? (progress.done / progress.total) * 100 : 0;
  const refreshLabel = !refreshing
    ? 'Refresh data'
    : measurable && progress
      ? `${progress.done}/${progress.total}`
      : progress?.phase === 'saving'
        ? 'Saving…'
        : 'Refreshing…';

  return (
    <div ref={attachRef} onScroll={onScroll} className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div
        className={`mb-5 flex items-start justify-between gap-4 ${revealClass}`}
        style={revealStyle(0)}
      >
        <div>
          {/* items-baseline y no items-center: mismo motivo que en Library —
              con el H1 tan grande junto a una píldora pequeña, centrar por
              CAJA deja la píldora flotando en vez de asentada. */}
          <div className="flex items-baseline gap-2.75">
            <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
              Plan to play
            </h1>
            {!isLoading && !isError && games.length > 0 && (
              <span className="flex-none rounded-full border border-input bg-white/[0.03] px-2.5 py-0.75 text-[12px] font-bold text-foreground tabular-nums">
                {games.length}
                <span className="ml-1 font-semibold text-muted-foreground">
                  {games.length === 1 ? 'game' : 'games'}
                </span>
              </span>
            )}
          </div>
          <p className="mt-1.25 text-[13.5px] text-muted-foreground">
            Everything you want to play, with what it takes to decide — how long it is, how long
            it&apos;s waited and what people say about it.
          </p>
        </div>

        <div className="flex flex-none items-center gap-2">
          {/* Puerta 1 de las dos del refresco (§5.1): la del día a día, solo
              sobre los planeados. Notas, sinopsis, fecha de salida y
              etiquetas de Steam — justo los datos que esta pantalla usa para
              decidir, y los que más se mueven por debajo (un juego sin salir
              gana fecha, uno recién salido gana reseñas cada semana). */}
          {!isEmpty && (
            <button
              type="button"
              onClick={runRefresh}
              disabled={refreshing}
              title="Re-fetch ratings, summaries, release dates and Steam tags for your plan"
              className={`${outlineButtonClass} relative overflow-hidden border-input bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-100`}
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />
              <span className="tabular-nums">{refreshLabel}</span>
              {/* La barra DENTRO del propio botón, pegada a su borde inferior:
                  es donde el ojo ya está mirando (acaba de pulsarlo) y no le
                  roba sitio a nada de la cabecera. Un contador suelto dice
                  "42/260" y hay que hacer la división de cabeza; la barra dice
                  cuánto queda de un vistazo. En las fases sin porcentaje
                  medible late a lo ancho en vez de mentir con un avance. */}
              {refreshing && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.07]">
                  <span
                    className={`block h-full transition-[width] duration-500 ease-out ${
                      measurable ? '' : 'animate-pulse'
                    }`}
                    style={{
                      width: measurable ? `${refreshPercent}%` : '100%',
                      background: TEAL,
                    }}
                  />
                </span>
              )}
            </button>
          )}
          <Button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="flex flex-none items-center gap-2 rounded-[10px] px-4.5 py-4.5 text-sm font-bold text-[#08120c] shadow-[0_4px_14px_rgba(47,220,126,0.22)]"
            style={{ background: accentGradientStyle.background }}
          >
            <Plus size={16} />
            Plan a game
          </Button>
        </div>
      </div>

      {/* onCreated abre la ficha del recién añadido — mismo comportamiento
          que tenía la pantalla vieja. */}
      <AddGameModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        mode="plan"
        onCreated={openGame}
        onOpenExisting={openGame}
      />

      {isLoading ? (
        <p className={`text-sm text-muted-foreground ${revealClass}`} style={revealStyle(1)}>
          Loading your plan…
        </p>
      ) : isError ? (
        <div className={`flex flex-col items-start gap-2.5 ${revealClass}`} style={revealStyle(1)}>
          <p className="text-sm text-destructive">
            Something went wrong loading your plan. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className={`${outlineButtonClass} border-input bg-white/[0.03] text-foreground hover:bg-white/[0.06]`}
          >
            <RefreshCw size={14} />
            <span>Try again</span>
          </button>
        </div>
      ) : isEmpty ? (
        <div
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-24 text-center ${revealClass}`}
          style={revealStyle(1)}
        >
          <div className="flex h-13 w-13 items-center justify-center rounded-full bg-white/[0.04]">
            <Gamepad2 size={24} strokeWidth={1.5} className="text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Nothing planned yet</p>
            <p className="mt-0.75 text-xs text-muted-foreground">
              Add a game you want to play someday — it won&apos;t clutter your library.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className={revealClass} style={revealStyle(1)}>
            <PlanDebtHeader
              debt={debt}
              upNextCount={upNext.length}
              queueCount={queue.length}
              horizonCount={horizon.length}
            />
          </div>

          {/* ── Las tres secciones, dentro de un FLIP de SECCIONES ──────
              Cada bloque de aquí abajo puede aparecer o desaparecer entero
              (fijar el primer juego monta Up next; soltar el último la
              desmonta), y eso desplaza TODO lo que tiene debajo. Sin este
              FLIP externo, la cabecera de la cola saltaba de golpe mientras
              sus filas planeaban con el FLIP interno — dos mitades de la
              misma sección moviéndose a velocidades distintas. Con él, la
              sección entera (rótulo + filas) se desliza como una unidad, y
              el FLIP interior no se entera porque mide relativo a su propio
              contenedor, que viaja con ella.

              Las secciones entran con expandClass (corta, sin retraso) y no
              con el reveal escalonado de la carga: un retraso con fill
              backwards deja 200ms de hueco invisible ya reservado — en la
              carga inicial nadie lo nota, pero al aparecer en mitad de una
              interacción se veía como un agujero que luego se rellenaba. */}
          <FlipList
            items={[
              ...(horizonItems.length > 0
                ? [
                    {
                      key: 'horizon',
                      node: (
                        /* ── En el horizonte (§2.5) ──────────────────────
                           Lo que aún no ha salido no compite con lo jugable
                           — es ESPERA, no decisión. Arriba pero PLEGADO:
                           cerrada ocupa un renglón y su titular ("Out
                           today!") queda a la vista sin competir con la
                           cola. DOS fuentes mezcladas por fecha: tus
                           planeados sin salir y lo que el radar (§4)
                           descubrió — las tuyas con borde sólido, las del
                           radar punteadas. */
                        <section className={`mt-5 ${expandClass}`}>
                          <PlanSectionHeading
                            Icon={CalendarClock}
                            color={VIOLET}
                            label="ON THE HORIZON"
                            count={horizonItems.length}
                            hint={
                              horizonOpen ? undefined : horizonHeadline ? (
                                <span className="font-semibold">
                                  <span className="text-foreground/80">
                                    {horizonHeadline.title}
                                  </span>
                                  <span className="mx-1 text-muted-foreground/40">·</span>
                                  <span style={{ color: horizonHeadline.color }}>
                                    {horizonHeadline.label}
                                  </span>
                                </span>
                              ) : radarGames.length > 0 ? (
                                `not out yet · ${radarGames.length} found by radar`
                              ) : (
                                'not out yet'
                              )
                            }
                            collapsible={{
                              open: horizonOpen,
                              onToggle: () => setHorizonOpen((it) => !it),
                            }}
                          />
                          {horizonOpen && (
                            <div className={`flex flex-col gap-2 ${expandClass}`}>
                              {horizonItems.map((item) =>
                                item.kind === 'plan' ? (
                                  /* Un planeado sin salir vive aquí ESTÉ O NO
                                     fijado (ver splitPlanSections), así que su
                                     pin refleja el estado real y alterna en
                                     los dos sentidos. Sin animación de
                                     llegada: esta fila no se mueve de sitio al
                                     fijarla — la que aterriza es su copia de
                                     Up next, y animar las dos contaría dos
                                     viajes donde solo hay uno. */
                                  <PlanRow
                                    key={`plan-${item.game.id}`}
                                    game={item.game}
                                    pinned={item.game.planPinnedAt !== null}
                                    landing={false}
                                    onSelect={() => openGame(item.game.id)}
                                    onTogglePin={() =>
                                      togglePin(item.game.id, item.game.planPinnedAt === null)
                                    }
                                  />
                                ) : (
                                  <RadarRow
                                    key={`radar-${item.game.id}`}
                                    game={item.game}
                                    onAdd={setPendingAdd}
                                    onDismiss={() => dismissRadar.mutate(item.game.igdbId)}
                                  />
                                ),
                              )}
                            </div>
                          )}
                        </section>
                      ),
                    },
                  ]
                : []),
              ...(upNext.length > 0
                ? [
                    {
                      key: 'upnext',
                      node: (
                        /* ── Up next (§2.2) — máxima prioridad, siempre
                           manual: se entra por un gesto tuyo, nunca lo
                           deriva la app. */
                        <section className={`mt-7 ${expandClass}`}>
                          <PlanSectionHeading
                            Icon={Pin}
                            color={PLAN_COLOR}
                            label="UP NEXT"
                            count={upNext.length}
                            /* Plegada, el rótulo dice a QUIÉN le toca: es la
                               única pregunta que Up next contesta, y sería
                               absurdo tener que abrirla para leerla. */
                            hint={
                              !upNextOpen ? (
                                <span className="font-semibold">
                                  <span className="text-muted-foreground/40">first · </span>
                                  <span className="text-foreground/80">{upNext[0].title}</span>
                                </span>
                              ) : upNext.length >= 8 ? (
                                'if everything is a priority, nothing is'
                              ) : (
                                'the ones you actually committed to'
                              )
                            }
                            collapsible={{
                              open: upNextOpen,
                              onToggle: () => setUpNextOpen((it) => !it),
                            }}
                          />
                          {/* Lista propia porque las filas se REORDENAN
                              arrastrando por el asa — la cola no la
                              necesita: ahí ordenan las lentes.

                              El pliegue ANIMA la altura en los dos sentidos
                              (interpolate-size permite transicionar hasta
                              auto/0 sin medir nada), y por eso la lista se
                              queda MONTADA en vez del montar/desmontar del
                              horizonte: desmontar es instantáneo por
                              definición y el cierre aparecía de golpe. Son
                              tus fijados (un puñado), tenerlos vivos
                              plegados no cuesta nada — el horizonte sí se
                              desmonta porque arranca cerrado y puede cargar
                              decenas de filas que quizá nunca abras. */}
                          {/* Curvas DISTINTAS por dirección, a propósito: la
                              de la casa (.22,1,.36,1) mete casi todo el
                              recorrido en el primer tercio — cerrando lee
                              como un chasquido que se asienta, pero abriendo
                              soltaba la lista entera de golpe y arrastraba
                              la cola: un pop, no un despliegue. Abrir va con
                              un ease-in-out clásico y un pelín más de
                              tiempo: arranca suave, cruza rápido y aterriza
                              suave. La clase cambia con el estado en el
                              mismo render, así que cada transición usa la
                              curva de SU dirección. */}
                          <div
                            className={`overflow-hidden [interpolate-size:allow-keywords] transition-[height] ${
                              upNextOpen
                                ? 'h-auto duration-350 ease-[cubic-bezier(.45,0,.2,1)]'
                                : 'h-0 duration-300 ease-[cubic-bezier(.22,1,.36,1)]'
                            }`}
                          >
                            <UpNextList
                              games={upNext}
                              onSelect={openGame}
                              onUnpin={(id) => togglePin(id, false)}
                              highlightId={landingInUpNext}
                            />
                          </div>
                        </section>
                      ),
                    },
                  ]
                : []),
              ...(queue.length > 0
                ? [
                    {
                      key: 'queue',
                      node: (
                        /* ── La cola, con sus lentes (§2.3-2.4) ────────── */
                        <section className={`mt-7 ${expandClass}`}>
                          <PlanSectionHeading
                            Icon={ListOrdered}
                            color={GRAY}
                            label={upNext.length > 0 ? 'THE REST' : 'YOUR QUEUE'}
                            count={queue.length}
                            right={<PlanLensChips value={lens} onChange={setLens} />}
                          />
                          {/* FlipList y no un .map() a secas: cambiar de
                              lente baraja el array entero y React
                              reconcilia por key sin animar nada. */}
                          <FlipList
                            items={visibleQueue}
                            keyOf={(game) => game.id}
                            className="flex flex-col gap-2"
                            /* content-visibility:auto en cada envoltorio:
                               Chromium se salta maquetar y pintar las filas
                               fuera del viewport (el grueso de una cola de
                               cientos), con su alto estimado reservando el
                               hueco para que el scroll no baile. FlipList lo
                               respeta porque mide el envoltorio, no el
                               contenido — ver su comentario de medición. */
                            itemClassName="[content-visibility:auto] [contain-intrinsic-size:auto_158px]"
                            renderItem={(game) => (
                              <PlanRow
                                game={game}
                                pinned={false}
                                landing={landingInQueue === game.id}
                                onSelect={() => openGame(game.id)}
                                onTogglePin={() => togglePin(game.id, true)}
                              />
                            )}
                          />
                        </section>
                      ),
                    },
                  ]
                : []),
              ...(queue.length === 0 && upNext.length === 0 && horizonItems.length > 0
                ? [
                    {
                      key: 'all-waiting',
                      node: (
                        /* Todo lo planeado está sin salir: la cola vacía no
                           es un error, es una situación con su propia frase. */
                        <div
                          className={`mt-7 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center ${expandClass}`}
                        >
                          <Bookmark
                            size={20}
                            strokeWidth={1.5}
                            className="text-muted-foreground/50"
                          />
                          <p className="text-[13px] font-semibold text-foreground">
                            Everything on your plan is still to come.
                          </p>
                          <p className="max-w-80 text-[11.5px] text-muted-foreground">
                            Nothing here is playable tonight — open the horizon above to see
                            what&apos;s on the way.
                          </p>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
            keyOf={(section) => section.key}
            renderItem={(section) => section.node}
          />
        </>
      )}

      {/* El intermedio del radar: pulsaste una entrega que no tienes y hay
          exactamente dos sitios donde puede ir. El mismo diálogo que usa el
          carrusel de la saga — la pregunta es idéntica. */}
      {pendingAdd && (
        <WhereToAddDialog
          title={pendingAdd.title}
          onCancel={() => setPendingAdd(null)}
          onPick={(where) => {
            setAddTo({ where, game: pendingAdd });
            setPendingAdd(null);
          }}
        />
      )}
      {addTo && (
        <AddGameModal
          open
          onOpenChange={(next) => {
            if (!next) setAddTo(null);
          }}
          mode={addTo.where === 'plan' ? 'plan' : 'library'}
          preselected={addTo.game}
          onCreated={(gameId) => {
            setAddTo(null);
            // Al añadirlo deja de ser un descubrimiento pendiente: la
            // siguiente pasada del radar borra su fila (su igdbId ya está en
            // tu BD), y hasta entonces se descarta para que no se vea
            // duplicado con el juego de verdad.
            dismissRadar.mutate(addTo.game.igdbId);
            if (addTo.where === 'library') void navigate(`/games/${gameId}`);
            else openGame(gameId);
          }}
        />
      )}
    </div>
  );
};
