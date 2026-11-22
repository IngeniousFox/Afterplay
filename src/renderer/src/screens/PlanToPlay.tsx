import { Bookmark, CalendarClock, Gamepad2, ListOrdered, Pin, Plus, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AddGameModal } from '../components/library/AddGameModal';
import { computePlanDebt } from '../../../shared/planShelves';
import type { IgdbSearchResult } from '../../../shared/types';
import { NextUpCard } from '../components/plan/NextUpCard';
import { PlanDebtHeader } from '../components/plan/PlanDebtHeader';
import { PlanLensChips } from '../components/plan/PlanLensChips';
import { PlanRow } from '../components/plan/PlanRow';
import { FlipList } from '../components/plan/FlipList';
import { PlanSectionHeading } from '../components/plan/PlanSectionHeading';
import { RadarRow } from '../components/plan/RadarRow';
import { UpNextList } from '../components/plan/UpNextList';
import { WhereToAddDialog } from '../components/library/WhereToAddDialog';
import { buttonSize, primaryButtonClass, secondaryButtonClass } from '../components/shell/controls';
import {
  externalRefreshBar,
  useExternalRefreshProgress,
  useIsExternalRefreshRunning,
  useRefreshPlanData,
} from '../hooks/external';
import { usePlannedGamesWithExtras, useReorderUpNext, useSetPlanPinned } from '../hooks/games';
import { useDismissRadarGame, useRadarGames } from '../hooks/radar';
import { getStoredScroll, useScrollMemory } from '../hooks/useScrollMemory';
import { pluralize } from '../lib/format';
import type { PlanLens } from '../lib/plan';
import { splitPlanSections } from '../lib/plan';
import { countdownLabel, releaseCountdown, releaseSortKey } from '../lib/releaseDate';
import { expandClass } from '../lib/styles';
import type { GameId } from '../../../shared/entityIds';

// Entrada escalonada de los bloques de la pantalla, la misma de Home.
const enter = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 5) * 40}ms`,
});

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
// del mínimo real (una fila pelada mide ~130px: carátula de 96 + padding y el
// hueco entre filas): quedarse corto en el alto significa pasarse en el número
// de filas, que es el error inofensivo — sobran unas pocas. Al revés, el
// scroll aterrizaría más arriba de donde estabas.
const ESTIMATED_ROW_HEIGHT = 120;
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
  // WithExtras y no usePlannedGames a secas: esta pantalla es LA consumidora
  // del canal de extras (sinopsis, porqué, notas, etiquetas, fecha completa).
  // Los demás consumidores de la lista van con el canal escueto — el porqué
  // y la medida están en hooks/games.ts e ipc/games.ts.
  const { data: games = [], isLoading, isError, refetch } = usePlannedGamesWithExtras();
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
  // "Move down" de la tarjeta Next up: la misma mutation que el arrastre de
  // la lista, cediendo el primer puesto al segundo.
  const reorderUpNext = useReorderUpNext();
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
  const horizonHeadline = ((): { title: string; label: string; out: boolean } | null => {
    for (const item of horizonItems) {
      const countdown = releaseCountdown(item.game);
      if (!countdown) continue;
      const urgent = countdown.kind !== 'soon' || countdown.imminent ? countdown : null;
      if (!urgent) break;
      return {
        title: item.game.title,
        label: countdownLabel(urgent),
        out: urgent.kind === 'out-now',
      };
    }
    return null;
  })();

  // Vacío es vacío del PLAN: un radar con descubrimientos no convierte una
  // lista vacía en una lista — son juegos que ni tienes ni has apuntado.
  const isEmpty = games.length === 0;

  const openGame = (id: GameId): void => {
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
  const [justMoved, setJustMoved] = useState<{ id: GameId; toUpNext: boolean } | null>(null);
  const justMovedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(justMovedTimer.current ?? undefined), []);

  // Marcas de llegada por sección: cada fila solo anima si ESTA es su destino.
  const landingInUpNext = justMoved?.toUpNext === true ? justMoved.id : null;
  const landingInQueue = justMoved?.toUpNext === false ? justMoved.id : null;

  const togglePin = (id: GameId, pinned: boolean): void => {
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

  // Mientras corre, el botón cuenta por dónde va. Qué fases tienen porcentaje
  // de verdad y cuáles se dicen con palabras lo decide el helper compartido:
  // la tarjeta de Ajustes pinta esta misma barra desde el mismo evento, y la
  // regla escrita a mano en los dos sitios se desincroniza a la primera fase
  // nueva (ver externalRefreshBar). Con un Plan grande la de Steam son minutos.
  const { measurable, percent: refreshPercent } = externalRefreshBar(progress, refreshing);
  const refreshLabel = !refreshing
    ? 'Refresh data'
    : measurable && progress
      ? `${progress.done}/${progress.total}`
      : progress?.phase === 'saving'
        ? 'Saving…'
        : 'Refreshing…';

  // "Move down" de la tarjeta Next up: el primero cede su puesto al segundo,
  // con la misma mutation (optimista) que reordena la lista.
  const moveNextUpDown = (): void => {
    if (upNext.length < 2) return;
    const ids = upNext.map((game) => game.id);
    [ids[0], ids[1]] = [ids[1], ids[0]];
    reorderUpNext.mutate(ids, { onError: () => toast.error("Couldn't update Up next.") });
  };

  return (
    <div ref={attachRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col px-7 pt-5 pb-12">
        <header
          className="mb-5 flex animate-screen-in flex-wrap items-end justify-between gap-x-6 gap-y-3"
          style={enter(0)}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="font-display text-page font-bold text-bone">Plan</h1>
              {!isLoading && !isError && games.length > 0 && (
                <span className="text-small text-dust tabular-nums">
                  {pluralize(games.length, 'game')} on your plan
                </span>
              )}
            </div>
            <p className="mt-1.5 max-w-[72ch] text-small text-dust">
              Everything you want to play, with what it takes to decide — how long it is, how long
              it&apos;s waited and what people say about it.
            </p>
          </div>

          <div className="flex flex-none flex-wrap items-center gap-2.5">
            {/* Puerta 1 de las dos del refresco (§5.1): la del día a día, solo
                sobre los planeados. Notas, sinopsis, fecha de salida y
                etiquetas de Steam — justo los datos que esta pantalla usa
                para decidir. */}
            {!isEmpty && (
              <button
                type="button"
                onClick={runRefresh}
                disabled={refreshing}
                aria-busy={refreshing}
                title="Re-fetch ratings, summaries, release dates and Steam tags for your plan"
                className={cn(
                  secondaryButtonClass,
                  buttonSize.md,
                  'relative overflow-hidden disabled:cursor-default disabled:opacity-100',
                )}
              >
                <RefreshCw
                  aria-hidden
                  size={14}
                  className={cn(refreshing && 'animate-spin motion-reduce:animate-none')}
                />
                <span className="tabular-nums">{refreshLabel}</span>
                {/* La barra DENTRO del propio botón, pegada a su borde
                    inferior: es donde el ojo ya está mirando. En las fases sin
                    porcentaje medible late a lo ancho en vez de mentir con un
                    avance. */}
                {refreshing && (
                  <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-bone/8">
                    <span
                      className={cn(
                        'block h-full bg-tube transition-[width] duration-500 ease-out',
                        !measurable && 'animate-pulse-soft motion-reduce:animate-none',
                      )}
                      style={{ width: measurable ? `${refreshPercent}%` : '100%' }}
                    />
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              <Plus aria-hidden size={16} />
              Plan a game
            </button>
          </div>
        </header>

        {/* onCreated abre la ficha del recién añadido. Sin onOpenExisting a
            propósito: abrir aquí es openGame → /plan/:id, la sección
            equivocada para un juego que ya está en la BIBLIOTECA (el modal ya
            lo apaga en modo 'plan' —canLeaveForOwned—). */}
        <AddGameModal
          open={addModalOpen}
          onOpenChange={setAddModalOpen}
          mode="plan"
          onCreated={openGame}
        />

        {isLoading ? (
          <p className="animate-screen-in text-body text-dust" style={enter(1)}>
            Loading your plan…
          </p>
        ) : isError ? (
          <div className="flex animate-screen-in flex-col items-start gap-3" style={enter(1)}>
            <p className="text-body text-live">
              Something went wrong loading your plan. Try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className={cn(secondaryButtonClass, buttonSize.md)}
            >
              <RefreshCw aria-hidden size={14} />
              Try again
            </button>
          </div>
        ) : isEmpty ? (
          <div
            className="flex animate-screen-in flex-col items-center justify-center gap-4 rounded-md border border-dashed border-line-strong px-6 py-20 text-center"
            style={enter(1)}
          >
            <span className="font-display text-stat font-bold text-dust/70">0</span>
            <div>
              <p className="text-lead font-semibold text-bone">Nothing planned yet</p>
              <p className="mt-1 text-small text-dust">
                Add a game you want to play someday — it won&apos;t clutter your library.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              <Gamepad2 aria-hidden size={16} />
              Plan a game
            </button>
          </div>
        ) : (
          <>
            <div className="animate-screen-in" style={enter(1)}>
              <PlanDebtHeader
                debt={debt}
                upNextCount={upNext.length}
                queueCount={queue.length}
                horizonCount={horizon.length}
              />
            </div>

            {/* ── Los bloques, dentro de un FLIP de SECCIONES ──────────────
                Cada bloque puede aparecer o desaparecer entero (fijar el
                primer juego monta Next up y Up next; soltar el último los
                desmonta), y eso desplaza TODO lo que tiene debajo. Con este
                FLIP externo la sección entera (rótulo + filas) se desliza como
                una unidad, y el FLIP interior no se entera porque mide
                relativo a su propio contenedor, que viaja con ella.

                Las secciones entran con expandClass (corta, sin retraso): un
                retraso con fill backwards dejaría un hueco invisible ya
                reservado al aparecer en mitad de una interacción. */}
            <FlipList
              items={[
                ...(upNext.length > 0
                  ? [
                      {
                        key: 'nextup',
                        node: (
                          <div className={cn('mt-5', expandClass)}>
                            <NextUpCard
                              game={upNext[0]}
                              upNextCount={upNext.length}
                              onOpen={() => openGame(upNext[0].id)}
                              onMoveDown={moveNextUpDown}
                              onRemove={() => togglePin(upNext[0].id, false)}
                            />
                          </div>
                        ),
                      },
                      {
                        key: 'upnext',
                        node: (
                          /* ── Up next (§2.2) — máxima prioridad, siempre
                             manual: se entra por un gesto tuyo, nunca lo
                             deriva la app. Una lista de reproducción que se
                             reordena arrastrando por el asa, con las flechas
                             del teclado o con los botones de subir/bajar. */
                          <section aria-label="Up next" className={cn('mt-8', expandClass)}>
                            <PlanSectionHeading
                              Icon={Pin}
                              iconClassName="text-phosphor"
                              label="Up next"
                              count={upNext.length}
                              /* Plegada, el rótulo dice a QUIÉN le toca. */
                              hint={
                                !upNextOpen ? (
                                  <span>
                                    first · <span className="text-bone">{upNext[0].title}</span>
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
                            {/* El pliegue ANIMA la altura en los dos sentidos
                                (interpolate-size permite transicionar hasta
                                auto/0), y por eso la lista se queda MONTADA:
                                desmontar es instantáneo por definición. Curvas
                                distintas por dirección: abrir arranca suave y
                                aterriza suave; cerrar es un chasquido que se
                                asienta. `inert` plegada: lo que no se ve no se
                                alcanza con el tabulador. */}
                            <div
                              inert={!upNextOpen}
                              className={cn(
                                'overflow-hidden [interpolate-size:allow-keywords] transition-[height] motion-reduce:transition-none',
                                upNextOpen
                                  ? 'h-auto duration-350 ease-[cubic-bezier(.45,0,.2,1)]'
                                  : 'h-0 duration-300 ease-[cubic-bezier(.22,1,.36,1)]',
                              )}
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
                ...(horizonItems.length > 0
                  ? [
                      {
                        key: 'horizon',
                        node: (
                          /* ── En el horizonte (§2.5) ────────────────────────
                             Lo que aún no ha salido no compite con lo jugable
                             — es ESPERA, no decisión. PLEGADO: cerrado ocupa
                             un renglón y su titular ("Out today!") queda a la
                             vista. DOS fuentes mezcladas por fecha: tus
                             planeados sin salir y lo que el radar (§4)
                             descubrió — las del radar, punteadas. */
                          <section aria-label="On the horizon" className={cn('mt-8', expandClass)}>
                            <PlanSectionHeading
                              Icon={CalendarClock}
                              iconClassName="text-st-resting"
                              label="On the horizon"
                              count={horizonItems.length}
                              hint={
                                horizonOpen ? undefined : horizonHeadline ? (
                                  <span>
                                    <span className="text-bone">{horizonHeadline.title}</span>
                                    {' · '}
                                    <span
                                      className={cn(
                                        'font-semibold',
                                        horizonHeadline.out ? 'text-st-beaten' : 'text-phosphor',
                                      )}
                                    >
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
                              <div className={cn('flex flex-col gap-2', expandClass)}>
                                {horizonItems.map((item) =>
                                  item.kind === 'plan' ? (
                                    /* Un planeado sin salir vive aquí ESTÉ O NO
                                       fijado, así que su pin alterna en los dos
                                       sentidos. Sin animación de llegada: la
                                       que aterriza es su copia de Up next. */
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
                ...(queue.length > 0
                  ? [
                      {
                        key: 'queue',
                        node: (
                          /* ── La cola, con sus lentes (§2.3-2.4) ────────── */
                          <section
                            aria-label={upNext.length > 0 ? 'The rest' : 'Your queue'}
                            className={cn('mt-8', expandClass)}
                          >
                            <PlanSectionHeading
                              Icon={ListOrdered}
                              iconClassName="text-dust"
                              label={upNext.length > 0 ? 'The rest' : 'Your queue'}
                              count={queue.length}
                              right={<PlanLensChips value={lens} onChange={setLens} />}
                            />
                            {/* FlipList y no un .map() a secas: cambiar de
                                lente baraja el array entero y React reconcilia
                                por key sin animar nada. */}
                            <FlipList
                              items={visibleQueue}
                              keyOf={(game) => game.id}
                              className="flex flex-col gap-2"
                              /* content-visibility:auto en cada envoltorio:
                                 Chromium se salta maquetar y pintar las filas
                                 fuera del viewport, con su alto estimado
                                 reservando el hueco. FlipList lo respeta porque
                                 mide el envoltorio, no el contenido. */
                              itemClassName="[content-visibility:auto] [contain-intrinsic-size:auto_124px]"
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
                            className={cn(
                              'mt-8 flex flex-col items-center gap-2 rounded-md border border-dashed border-line-strong px-6 py-10 text-center',
                              expandClass,
                            )}
                          >
                            <Bookmark
                              aria-hidden
                              size={20}
                              strokeWidth={1.5}
                              className="text-dust"
                            />
                            <p className="text-body font-semibold text-bone">
                              Everything on your plan is still to come.
                            </p>
                            <p className="max-w-80 text-small text-dust">
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
      </div>

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
          preselected={{
            // Un descubrimiento del radar SIEMPRE viene de IGDB: es de donde
            // sale el radar entero.
            source: { igdbId: addTo.game.igdbId },
            title: addTo.game.title,
            coverUrl: addTo.game.coverUrl,
            releaseYear: addTo.game.releaseYear,
            platforms: addTo.game.platforms,
            genres: addTo.game.genres,
            summary: addTo.game.summary,
          }}
          onCreated={(gameId) => {
            setAddTo(null);
            // Al añadirlo deja de ser un descubrimiento pendiente: la
            // siguiente pasada del radar borra su fila, y hasta entonces se
            // descarta para que no se vea duplicado con el juego de verdad.
            dismissRadar.mutate(addTo.game.igdbId);
            if (addTo.where === 'library') void navigate(`/games/${gameId}`);
            else openGame(gameId);
          }}
        />
      )}
    </div>
  );
};
