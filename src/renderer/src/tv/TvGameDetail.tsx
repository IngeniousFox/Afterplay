import { Check, ChevronLeft, Info, Play, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { parseEntityId } from '../../../shared/entityIds';
import type { GameDetail } from '../../../shared/types';
import { useGameAchievements } from '../hooks/achievements';
import { useGame } from '../hooks/games';
import { useCuriosities } from '../hooks/curiosities';
import { useCreateIteration } from '../hooks/iterations';
import { useAddStateEvent } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { useLiveTimer } from '../hooks/useLiveTimer';
import { celebrate, GlowText, Odometer, ScanBeam, ScanLines, Ticker } from '../components/fx';
import { humanizeAgoDays } from './tvFormat';
import { formatElapsed, formatHours, formatMoney } from '../lib/format';
import type { PastStatusKey, StatusKey } from '../lib/gameStatus';
import {
  ENDLESS_STATUS_OPTIONS,
  getGameStatusMeta,
  NORMAL_STATUS_OPTIONS,
  STATE_TO_STATUS_KEY,
  STATUS_META,
  STATUS_TO_STATE_TYPE,
} from '../lib/gameStatus';
import { isTerminal, lastIteration, startedIteration } from '../lib/iterations';
import { closedSessions, openSessions } from '../lib/sessions';
import { useDeviceContext } from '../hooks/devices';
import { isOwnLiveSession } from '../../../shared/liveSession';
import { useNoSignalText } from '../hooks/sessionDevice';
import { useTvBackdrop } from './backdropContext';
import { TV_MODAL_SWALLOW, useTvButtons, useTvLegend } from './tvInput';
import { TvFocusLayer } from './focus';
import { useTvFocusable } from './focusContext';
import { useTvInputDevice } from './inputDevice';
import { tvSound } from './sound';
import {
  TV_HERO_BEAM_EVERY_S,
  TV_TICKER_MS,
  tvButtonHalo,
  tvFocusHalo,
  tvFocusMotion,
  tvFocusScale,
  tvLabelClass,
  tvRevealClass,
  tvRevealStyle,
} from './styles';
import { TvButton, TvCoverArt, TvFigure, TvLed } from './tvUi';
import { TvDetailAchievements } from './detail/TvDetailAchievements';
import { TvDetailHistory } from './detail/TvDetailHistory';
import { TvDetailNotes } from './detail/TvDetailNotes';
import { TvDetailSaves } from './detail/TvDetailSaves';
import { TvDetailSessions } from './detail/TvDetailSessions';

// La ficha del sofá (BIG-PICTURE.md §5.3), v2 POR SECCIONES: el arte lo pone
// el fondo global (backdropContext) y la carátula flota constante a la
// derecha con sus vueltas; a la izquierda, cabecera fija (volver, estado,
// título, acciones) y CINCO pestañas cicladas con LB/RB — Overview (vistazo:
// identidad, métricas, HLTB, nota, curiosidades), Sessions (inicio→fin y
// contador vivo), History (línea temporal de estados+gastos+alta), Notes
// (tu Markdown + diario) y Saves (copias en solo lectura) — el detalle de
// escritorio entero, ordenado para una tele. Las pestañas viven en
// ./detail/. Play solo con exe (emulados en lectura); con el juego corriendo
// el botón es el estado en vivo.

// "Nov 2024" — el grano justo para contar una vuelta en una sola línea.
const monthYear = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

// Las SECCIONES de la ficha (la respuesta al "todo apilado"): el detalle de
// escritorio cabe entero en el sofá, pero por pestañas — Overview para el
// vistazo, y Sessions/History/Notes/Saves con la información completa. Se
// ciclan con LB/RB y también son botones de verdad.
const DETAIL_TABS = [
  { key: 'overview', label: 'Overview' },
  // Solo aparece si el juego tiene catálogo de logros traído — en un emulado
  // de consola la pestaña entera sería un "0 logros" que no informa de nada.
  { key: 'achievements', label: 'Achievements' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'history', label: 'History' },
  { key: 'notes', label: 'Notes' },
  { key: 'saves', label: 'Saves' },
] as const;
type DetailTabKey = (typeof DETAIL_TABS)[number]['key'];

// La pestaña de sección de tvpwa-tv-detail.png: caja con borde, la activa en
// Raised con su filo Phosphor abajo, y el recuento en Dust. Silenciada en el
// reparto genérico: cambiar de sección suena el tick de moverse, no el
// confirmar de actuar.
const TabPill = ({
  label,
  count,
  active,
  onSelect,
}: {
  label: string;
  count?: string;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      data-tv-sound="none"
      aria-pressed={active}
      className={cn(
        'relative flex h-[2.15em] items-center gap-[0.5em] rounded-sm border px-[0.9em] text-[1.05em] font-medium',
        tvFocusMotion,
        active
          ? 'border-line-strong bg-raised text-bone after:absolute after:inset-x-[0.3em] after:-bottom-px after:h-[0.12em] after:rounded-full after:bg-phosphor after:shadow-glow-bar'
          : 'border-line bg-panel/70 text-dust',
        focused && ['text-bone', tvFocusScale, tvButtonHalo],
      )}
    >
      {label}
      {count !== undefined && <span className="text-[0.86em] text-dust tabular-nums">{count}</span>}
    </button>
  );
};

// Volver, visible: el mando tiene B, el ratón necesita una puerta que se vea.
const BackButton = ({
  onSelect,
  autoFocus,
}: {
  onSelect: () => void;
  // Para cuando ESTE botón es lo único que hay en pantalla que enfocar —
  // ver el placeholder de "juego no encontrado" más abajo.
  autoFocus?: boolean;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect, autoFocus });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      // Vuelve hacia ATRÁS: sonar el confirmar ascendente aquí era decir lo
      // contrario de lo que hace — el back() lo pone quien lo usa (abajo).
      data-tv-sound="none"
      aria-label="Back"
      className={cn(
        'flex size-[1.9em] flex-none items-center justify-center rounded-sm border border-line-strong bg-raised text-bone',
        tvFocusMotion,
        focused && [tvFocusScale, tvButtonHalo],
      )}
    >
      <ChevronLeft className="size-[1.1em]" />
    </button>
  );
};

// El selector de estado: la MISMA regla de playthrough que StatusCard en
// escritorio — reutilizar la iteración activa (o la última no terminal), y
// abrir una nueva solo al volver a Playing tras un final.
const StatusPicker = ({
  game,
  onClose,
}: {
  game: GameDetail;
  onClose: () => void;
}): React.JSX.Element => {
  const addIteration = useCreateIteration();
  const addStateEvent = useAddStateEvent();
  const options = game.endless ? ENDLESS_STATUS_OPTIONS : NORMAL_STATUS_OPTIONS;
  const currentKey = game.currentState ? STATE_TO_STATUS_KEY[game.currentState] : null;

  useTvButtons({ ...TV_MODAL_SWALLOW, b: onClose });

  const save = async (key: PastStatusKey): Promise<void> => {
    if (addIteration.isPending || addStateEvent.isPending) return;
    // La guarda de no-op de StatusCard (SPEC 4.5), que aquí es aún más
    // simple porque no hay nota: re-elegir el estado que el juego ya tiene
    // no escribe un evento duplicado en el log — solo cierra.
    if (key === currentKey) {
      onClose();
      return;
    }
    try {
      const activeIteration = startedIteration(game.iterations);
      const lastIt = lastIteration(game.iterations);
      // El `!game.endless` no es un detalle: un endless no tiene playthroughs
      // discretos, así que volver a Playing tras un Dropped (desenlace que
      // ENDLESS_STATUS_OPTIONS sí ofrece) retoma SIEMPRE su contenedor único.
      // Sin él, el mismo gesto que en la ficha de escritorio reutiliza la
      // iteración existente aquí abría un "Playthrough 2" en un juego cuyo
      // modelo entero es que solo hay uno. Misma regla que StatusCard y que
      // resolveIterationForPlay en el main (el camino del watcher/Play).
      const needsNewIteration =
        !activeIteration && (!lastIt || (isTerminal(lastIt) && key === 'playing' && !game.endless));

      let iterationId = needsNewIteration ? undefined : (activeIteration?.id ?? lastIt?.id);
      if (!iterationId) {
        const iteration = await addIteration.mutateAsync({
          gameId: game.id,
          playedPlatform: game.officialPlatforms?.[0] ?? 'PC',
          origin: 'Purchased',
          format: 'digital',
        });
        iterationId = iteration.id;
        if (key !== 'playing') {
          await addStateEvent.mutateAsync({
            iterationId,
            type: 'started',
            occurredAt: new Date(),
            datePrecision: 'datetime',
          });
        }
      }
      await addStateEvent.mutateAsync({
        iterationId,
        type: STATUS_TO_STATE_TYPE[key],
        occurredAt: new Date(),
        datePrecision: 'datetime',
      });
      if (key === 'beaten') celebrate('beaten');
    } catch {
      toast.error('Could not save the status.');
      return;
    }
    onClose();
  };

  return (
    <TvFocusLayer>
      <div className="absolute inset-0 z-30 flex items-center justify-center">
        <div
          className="absolute inset-0 animate-[fade-in_200ms_var(--ease-out)_both] bg-scrim"
          onClick={onClose}
        />
        <div className="relative w-[19em] animate-dialog-in rounded-md border border-line-strong bg-overlay px-[0.9em] pt-[1em] pb-[0.9em] shadow-modal">
          <div className="mb-[0.6em] px-[0.5em] font-display text-[1.6em] leading-none font-bold text-bone">
            Set status
          </div>
          <div className="flex flex-col gap-[0.3em]">
            {options.map((key, index) => (
              <StatusOption
                key={key}
                status={key}
                current={key === currentKey}
                autoFocus={index === 0}
                onSelect={() => void save(key)}
              />
            ))}
          </div>
        </div>
      </div>
    </TvFocusLayer>
  );
};

const StatusOption = ({
  status,
  current,
  autoFocus,
  onSelect,
}: {
  status: PastStatusKey;
  current: boolean;
  autoFocus: boolean;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect, autoFocus });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      // Elegir SIEMPRE cierra el picker, y ese cierre ya suena (popLayer):
      // confirmar + cierre a la vez eran dos gestos sonoros contradictorios.
      data-tv-sound="none"
      className={cn(
        'flex w-full items-center gap-[0.65em] rounded-md border border-transparent px-[0.7em] py-[0.5em] text-[1.15em] font-semibold text-bone',
        tvFocusMotion,
        focused && ['border-phosphor bg-phosphor-tint', tvFocusHalo],
      )}
    >
      <TvLed status={status} />
      {STATUS_META[status].label}
      {current && <span className="ml-auto text-[0.8em] font-medium text-dust">Current</span>}
    </button>
  );
};

export const TvGameDetail = (): React.JSX.Element | null => {
  const { id } = useParams();
  const navigate = useNavigate();
  // Un id ilegible (null) no pide nada: useGame se queda sin ficha y la
  // pantalla cae en "This game is no longer in your library", lo mismo que
  // con un id que no casa con ninguna fila.
  const gameId = parseEntityId(id);
  const { data: game, isLoading: gameLoading, isError: gameFailed } = useGame(gameId);
  const { data: curiosityRows = [] } = useCuriosities();
  const { data: achievements } = useGameAchievements(gameId);
  const [statusOpen, setStatusOpen] = useState(false);
  const [tab, setTab] = useState<DetailTabKey>('overview');
  const [launching, setLaunching] = useState(false);
  // Las chapas LB/RB junto a las pestañas solo se enseñan con mando.
  const device = useTvInputDevice();

  // Los totales de logros alimentan la pestaña condicional y la ficha de
  // vitales del Overview. Cero entries = juego sin catálogo = ni rastro.
  const achievementsTotal = achievements?.entries.length ?? 0;
  const achievementsUnlocked =
    achievements?.entries.filter((entry) => entry.unlockedAt !== null).length ?? 0;
  const tabs = DETAIL_TABS.filter((entry) => entry.key !== 'achievements' || achievementsTotal > 0);
  // Si la pestaña activa desaparece (una invalidación deja los logros en
  // cero a mitad de visita), se cae al Overview sin tocar estado.
  const activeTab = tabs.some((entry) => entry.key === tab) ? tab : 'overview';

  // Cambiar de sección: LB/RB cicla (con vuelta), los pills seleccionan
  // directo. El sonido es el tick de moverse — cambiar de pestaña es
  // desplazarse, no confirmar.
  const cycleTab = (step: number): void => {
    const index = tabs.findIndex((entry) => entry.key === activeTab);
    const next = tabs[(index + step + tabs.length) % tabs.length].key;
    tvSound.move();
    setTab(next);
  };
  const selectTab = (key: DetailTabKey): void => {
    if (key === activeTab) return;
    tvSound.move();
    setTab(key);
  };
  const [curiosityIndex, setCuriosityIndex] = useState(0);
  // La rotación en dos tiempos: la curiosidad actual se desvanece primero
  // (transición corta) y solo entonces entra la siguiente — un relevo, no
  // un corte.
  const [curiosityLeaving, setCuriosityLeaving] = useState(false);

  const heroSrc = useImageSrc(game?.heroUrl ?? null, 'heroes');
  const coverSrc = useImageSrc(game?.coverUrl ?? null, 'covers');
  // El arte del juego baña el modo entero desde el fondo global — nítido
  // solo queda lo que importa: la carátula y la información.
  useTvBackdrop(heroSrc ?? coverSrc);

  // Todas las sesiones cerradas del juego (todas sus vueltas), de nueva a vieja.
  const sessions = useMemo(() => closedSessions(game), [game]);
  // La sesión ABIERTA (si el watcher tiene al juego en marcha): su inicio
  // alimenta el contador en vivo del botón de estado.
  //
  // §10.8: la abierta de ESTE PC es "Playing"; la de otro, "Playing on PC-A"
  // (y Play sigue disponible: una sesión por PC, §10.4). Aquí no hay Stop en
  // ningún caso, ni siquiera para un cronómetro ajeno: es la pantalla del sofá.
  const { thisDeviceId, nameOf } = useDeviceContext();
  const { ownLive, remoteLive } = useMemo(() => {
    const open = game?.isLive ? openSessions(game) : [];
    return {
      ownLive: open.find((session) => isOwnLiveSession(session, thisDeviceId)) ?? null,
      remoteLive: open.find((session) => !isOwnLiveSession(session, thisDeviceId)) ?? null,
    };
  }, [game, thisDeviceId]);
  const liveSince = ownLive?.startedAt ?? null;
  const liveSeconds = useLiveTimer(liveSince);
  const remoteNoSignal = useNoSignalText(remoteLive);
  const lastNote = useMemo(
    () => sessions.find((session) => (session.note?.trim().length ?? 0) > 0)?.note?.trim() ?? null,
    [sessions],
  );
  const curiosities = useMemo(
    () => curiosityRows.filter((row) => row.gameId === gameId).map((row) => row.text),
    [curiosityRows, gameId],
  );

  // Las vueltas al juego, como en el PlaythroughPanel de escritorio pero en
  // lectura: ordinal cronológico, estado, horas y rango de fechas. Solo las
  // que existieron de verdad (con inicio o sesiones) — una iteración vacía
  // recién creada por un cambio de estado no cuenta una historia.
  const playthroughs = useMemo(() => {
    const chronological = (game?.iterations ?? [])
      .filter((iteration) => iteration.startedAt !== null || iteration.sessions.length > 0)
      .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0))
      .map((iteration, index) => ({ iteration, ordinal: index + 1 }));
    return chronological.reverse();
  }, [game]);

  // La curiosidad ROTA cada docena de segundos: fundido de salida, y la
  // siguiente entra con su animate-in al remontar por el key.
  useEffect(() => {
    if (curiosities.length < 2) return;
    let advance: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setCuriosityLeaving(true);
      advance = setTimeout(() => {
        setCuriosityIndex((index) => index + 1);
        setCuriosityLeaving(false);
      }, 360);
    }, 12_000);
    return () => {
      clearInterval(timer);
      if (advance) clearTimeout(advance);
      // Si el efecto se rearma con el fundido a medias, que la nueva pasada
      // no arranque invisible.
      setCuriosityLeaving(false);
    };
  }, [curiosities.length]);

  useTvButtons({
    x: () => setStatusOpen(true),
    lb: () => cycleTab(-1),
    rb: () => cycleTab(1),
  });
  useTvLegend([
    { action: 'lbrb', label: 'Section' },
    { action: 'x', label: 'Set status' },
  ]);

  // "Todavía no ha llegado" NO es "ya no existe": la key ['games', 'detail', id] no
  // está en caché la primera vez que se abre CADA juego (nadie prefetchea ni
  // hace setQueryData en el renderer), así que `game` es undefined durante
  // todo el viaje IPC de getGameById — que resuelve iteraciones, sesiones y
  // estados, no es 1 ms. Sin esta rama, el panel rojo de abajo acusaba de
  // borrado en la apertura MÁS común de la pantalla. Mismo reparto de tres
  // estados que GameDetail.tsx y PlanGameDetail.tsx con QueryStatePlaceholder.
  if (gameLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-[1em] text-dust">Loading…</span>
      </div>
    );
  }

  // El equivalente de escritorio (GameDetail.tsx) usa QueryStatePlaceholder
  // para esto mismo: un mensaje y un camino de vuelta. Aquí antes era un
  // `return null` a secas — con la query bajo el prefijo ['games'], que
  // CUALQUIER sync o mutation invalida en bloque, un juego que desaparece
  // (o que una carrera deja momentáneamente sin datos) dejaba la pantalla
  // entera en negro desde el sofá, sin mensaje y sin nada que enfocar con el
  // mando salvo adivinar B. Aquí abajo ya solo se llega con la query
  // resuelta: o falló (y entonces el juego sigue ahí, solo que no se ha
  // podido leer) o de verdad no hay fila.
  if (!game) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[1.1em] text-center">
        <div className="flex size-[3.2em] items-center justify-center rounded-md border border-line bg-panel">
          <TriangleAlert className="size-[1.4em] text-phosphor" />
        </div>
        <div className="font-display text-[1.8em] font-bold text-bone">
          {gameFailed ? 'Couldn’t load this game' : 'This game is no longer in your library'}
        </div>
        <BackButton
          autoFocus
          onSelect={() => {
            tvSound.back();
            void navigate(-1);
          }}
        />
      </div>
    );
  }

  const status = getGameStatusMeta(game.currentState);
  const sessionCount = sessions.length;
  const curiosity =
    curiosities.length > 0 ? curiosities[curiosityIndex % curiosities.length] : null;
  const lastPlayed = sessions[0]?.startedAt ?? null;
  // El panel violeta enseña la última nota de sesión (retomar) y, si no la
  // hay, las notas del JUEGO (las del NotesSection de escritorio) — que la
  // memoria escrita no se quede en el escritorio.
  const gameNotes = game.notes?.trim() ? game.notes.trim() : null;
  const noteText = lastNote ?? gameNotes;
  const noteLabel = lastNote ? 'Where you left off' : 'Your notes';

  // HLTB con la geometría del escritorio: tres tramos sobre una escala común
  // (el mayor de los tres tiempos) y tus horas aterrizando como marcador.
  const hltbMain = game.hltbMain ?? 0;
  const hltbExtra = game.hltbMainExtras ?? 0;
  const hltbComp = game.hltbCompletionist ?? 0;
  const hasHltb = hltbMain > 0 || hltbExtra > 0 || hltbComp > 0;
  const hltbScale = Math.max(hltbMain, hltbExtra, hltbComp, 1);
  const hltbTiers = [
    { label: 'Story', hours: hltbMain },
    { label: '+ Extras', hours: hltbExtra },
    { label: '100%', hours: hltbComp },
  ].filter((tier) => tier.hours > 0);

  const launch = async (): Promise<void> => {
    if (!game.executablePath || launching) return;
    setLaunching(true);
    const result = await window.api.games.launchExecutable(game.id);
    if (!result.ok) {
      toast.error(
        result.reason === 'missing'
          ? 'That executable is gone — set it again from your desk.'
          : result.reason === 'not_installed'
            ? 'Not installed on this PC.'
            : 'Could not launch the game.',
      );
      // Al fallo, YA — mismo motivo que TvHome: el toast dice que no arrancó
      // en el acto, y el botón no puede seguir "Launching…" 2.5s más
      // contradiciéndolo (y tragándose una segunda pulsación mientras tanto).
      setLaunching(false);
      return;
    }
    setTimeout(() => setLaunching(false), 2_500);
  };

  const statusKey: StatusKey = game.currentState
    ? STATE_TO_STATUS_KEY[game.currentState]
    : 'unplayed';
  const compact = activeTab !== 'overview';

  // El medidor HLTB del sistema: un segmento por hora (con tope de 60 para
  // juegos largos: entonces cada segmento vale scale/60 h), relleno Phosphor,
  // la hora parcial proporcional y marcas para Story / + Extras / 100%.
  const hltbSegmentCount = Math.min(60, Math.max(12, Math.ceil(hltbScale)));
  const hltbFilled = (game.totalHours / hltbScale) * hltbSegmentCount;

  const figures: { key: string; node: React.ReactNode; label: string }[] = [
    {
      key: 'hours',
      // Las cifras del vistazo entran contando (Ticker): el valor final
      // está en data-value y en el texto accesible desde el primer frame.
      node: (
        <Ticker
          value={game.totalHours}
          format={formatHours}
          duration={TV_TICKER_MS}
          render={(value) => (
            <GlowText>
              <TvFigure value={formatHours(value)} className="text-phosphor" />
            </GlowText>
          )}
        />
      ),
      label: 'Hours',
    },
    {
      key: 'sessions',
      node: (
        <Ticker
          value={sessionCount}
          duration={TV_TICKER_MS}
          render={(value) => <TvFigure value={String(Math.round(value))} />}
        />
      ),
      label: 'Sessions',
    },
    ...(achievementsTotal > 0
      ? [
          {
            key: 'trophies',
            node: (
              <span className="font-display leading-none font-bold tabular-nums">
                <Ticker value={achievementsUnlocked} duration={TV_TICKER_MS} />
                <span className="text-[0.55em] font-semibold text-dust">/{achievementsTotal}</span>
              </span>
            ),
            label: 'Trophies',
          },
        ]
      : []),
    ...(lastPlayed
      ? [
          {
            key: 'last',
            node: (
              <span className="font-display leading-none font-bold">
                {humanizeAgoDays(lastPlayed)}
              </span>
            ),
            label: 'Last played',
          },
        ]
      : []),
    ...(game.totalSpend > 0
      ? [
          {
            key: 'spent',
            node: (
              <span className="font-display leading-none font-bold tabular-nums">
                {formatMoney(game.totalSpend)}
              </span>
            ),
            label:
              game.costPerHour !== null ? `Spent · ${formatMoney(game.costPerHour)}/h` : 'Spent',
          },
        ]
      : []),
    {
      key: 'library',
      node: (
        <span className="font-display leading-none font-bold tabular-nums">
          {game.addedAt.getFullYear()}
        </span>
      ),
      label: 'In library since',
    },
  ];

  // Las acciones: lanzar, el aviso de "jugándose en otro PC" y Set status.
  const actions = (
    <div
      className={cn('flex flex-wrap items-center gap-[0.9em]', tvRevealClass)}
      style={tvRevealStyle(2)}
    >
      {ownLive !== null ? (
        // El juego ESTÁ corriendo: el botón de lanzar se convierte en el
        // estado en vivo — LED rojo latiendo y el contador de la sesión. (No
        // hay "Stop" honesto: Afterplay observa el proceso, no lo posee.)
        <div className="flex h-[2.6em] items-center gap-[0.55em] rounded-md border border-live/50 bg-live/10 px-[1.1em] text-[1.08em] font-semibold text-bone">
          <span className="relative flex size-[0.55em] flex-none">
            <span className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden" />
            <span className="relative size-[0.55em] rounded-full bg-live" />
          </span>
          Playing
          {liveSince && (
            <GlowText
              breathe
              className="font-display text-[1.25em] leading-none font-bold text-phosphor tabular-nums"
            >
              <Odometer value={formatElapsed(liveSeconds)} />
            </GlowText>
          )}
        </div>
      ) : (
        game.executablePath && (
          <TvButton
            label={launching ? 'Launching…' : 'Play'}
            icon={<Play className="size-[0.85em]" fill="currentColor" />}
            variant="primary"
            autoFocus
            onSelect={() => void launch()}
          />
        )
      )}
      {/* Jugándose en OTRO PC (§10.8): el aviso, sin Stop y sin quitar Play.
          Con "No signal for X" (punto hueco ámbar) si lleva rato callada. */}
      {remoteLive !== null && (
        <div className="flex h-[2.6em] items-center gap-[0.55em] rounded-md border border-line-strong bg-panel px-[1.1em] text-[1.08em] font-semibold text-bone">
          <span
            className={cn(
              'size-[0.55em] flex-none rounded-full',
              remoteNoSignal === null ? 'bg-live' : 'border-[0.13em] border-phosphor',
            )}
          />
          Playing on {nameOf(remoteLive.deviceId)}
          {remoteNoSignal !== null && (
            <span className="text-[0.92em] text-phosphor">· {remoteNoSignal}</span>
          )}
        </div>
      )}
      {ownLive === null && !game.executablePath && !game.isEmulated && (
        <span className="text-[1em] text-dust">Not installed on this PC</span>
      )}
      <TvButton
        label="Set status"
        autoFocus={!game.executablePath || ownLive !== null}
        // La apertura del picker ya suena por pushLayer.
        silent
        onSelect={() => setStatusOpen(true)}
      />
    </div>
  );

  // La línea de identidad: LED + estado, géneros, plataforma y año.
  const identity = [
    ...(game.genres ?? []).slice(0, 2),
    game.officialPlatforms?.[0] ?? null,
    game.releaseYear !== null ? String(game.releaseYear) : null,
  ].filter((part): part is string => part !== null && part.length > 0);

  return (
    <div className="relative isolate flex h-full flex-col pb-[0.6em]">
      {/* El arte del juego arriba a la derecha, muy apagado y fundido hacia
          el Cabinet: atmósfera detrás del título, nunca encima del texto. */}
      {(heroSrc ?? coverSrc) && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[4em] -right-[4vw] -z-10 h-[24em] w-[62%] overflow-hidden"
        >
          {/* Ken Burns lento, scanlines que reptan y el haz: el arte vive
              detrás del título sin pisarlo (el fundido de debajo lo apaga
              hacia el texto). Quieto con reduced motion. */}
          <img
            src={heroSrc ?? coverSrc ?? undefined}
            alt=""
            className="h-full w-full animate-ken-burns object-cover opacity-35 motion-reduce:animate-none"
          />
          <ScanLines crawl />
          <ScanBeam every={TV_HERO_BEAM_EVERY_S} />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-cabinet)_0%,transparent_45%),linear-gradient(0deg,var(--color-cabinet)_0%,transparent_60%)]" />
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-[2.4em]">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* CABECERA: en Overview, título enorme y las acciones debajo; en
              las demás secciones el héroe se compacta (título más bajo y
              las acciones a la derecha) y la sección gana la pantalla. */}
          <div
            className={cn(
              'flex flex-none gap-[1.2em]',
              compact ? 'items-end justify-between' : 'flex-col',
            )}
          >
            <div className="flex min-w-0 flex-col gap-[0.35em]">
              <h1
                className={cn(
                  'font-display leading-[0.92] font-bold text-bone',
                  compact ? 'text-[3.4em]' : 'text-[4.6em]',
                  tvRevealClass,
                )}
                style={tvRevealStyle(0)}
              >
                {game.title}
              </h1>
              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-[0.75em] gap-y-[0.3em] text-[1.05em] text-bone',
                  tvRevealClass,
                )}
                style={tvRevealStyle(1)}
              >
                <BackButton
                  onSelect={() => {
                    // La misma firma sonora que B: nota cayendo, no confirmar.
                    tvSound.back();
                    void navigate(-1);
                  }}
                />
                <span className="flex items-center gap-[0.45em] font-semibold">
                  <TvLed status={statusKey} />
                  {status.label}
                </span>
                {identity.map((part) => (
                  <span key={part} className="flex items-center gap-[0.75em]">
                    <span aria-hidden className="h-[0.9em] w-px bg-line-strong" />
                    {part}
                  </span>
                ))}
                {game.endless && (
                  <span className="rounded-sm border border-line-strong px-[0.45em] text-[0.88em] text-dust">
                    Endless
                  </span>
                )}
                {game.isEmulated && (
                  <span className="rounded-sm border border-line-strong px-[0.45em] text-[0.88em] text-dust">
                    Emulated
                  </span>
                )}
              </div>
            </div>
            {actions}
          </div>

          {/* La barra de secciones — ver DETAIL_TABS arriba. */}
          <div
            className={cn(
              'mt-[1em] flex flex-none flex-wrap items-center gap-[0.5em]',
              tvRevealClass,
            )}
            style={tvRevealStyle(3)}
          >
            {tabs.map((entry) => (
              <TabPill
                key={entry.key}
                label={entry.label}
                count={
                  entry.key === 'achievements'
                    ? `${achievementsUnlocked}/${achievementsTotal}`
                    : entry.key === 'sessions' && sessionCount > 0
                      ? String(sessionCount)
                      : undefined
                }
                active={activeTab === entry.key}
                onSelect={() => selectTab(entry.key)}
              />
            ))}
            {/* LB/RB solo con mando: con teclado son Q/E y ya lo dice el pie. */}
            {device === 'gamepad' && (
              <span className="ml-[0.4em] flex items-center gap-[0.3em]">
                {['LB', 'RB'].map((glyph) => (
                  <span
                    key={glyph}
                    className="flex h-[1.4em] items-center rounded-sm border-[0.09em] border-dust px-[0.3em] text-[0.85em] font-semibold text-dust"
                  >
                    {glyph}
                  </span>
                ))}
              </span>
            )}
          </div>

          {/* El contenido de la sección activa: remonta con key (cambiar de
              pestaña no se anima: el sistema no anima lo que el mando repite). */}
          <div key={activeTab} className="mt-[1em] min-h-0 flex-1">
            {activeTab === 'overview' ? (
              <div
                className="-mx-[0.6em] flex h-full flex-col gap-[1.2em] overflow-y-auto px-[0.6em] pt-[0.2em]"
                style={{ scrollbarWidth: 'none' }}
              >
                {/* Las cifras del vistazo, separadas por filetes. */}
                <div
                  className={cn('flex flex-wrap items-end gap-y-[0.8em]', tvRevealClass)}
                  style={tvRevealStyle(4)}
                >
                  {figures.map((figure, index) => (
                    <div
                      key={figure.key}
                      className={cn(
                        'flex flex-col gap-[0.3em] pr-[1.3em]',
                        index > 0 && 'border-l border-line-strong pl-[1.3em]',
                      )}
                    >
                      <span className="text-[2.6em] text-bone">{figure.node}</span>
                      <span className="text-[0.92em] text-dust">{figure.label}</span>
                    </div>
                  ))}
                </div>

                <div
                  className={cn('grid grid-cols-2 items-start gap-[2em]', tvRevealClass)}
                  style={tvRevealStyle(5)}
                >
                  {hasHltb ? (
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between">
                        <span className={tvLabelClass}>How long to beat</span>
                        <span className="text-[0.88em] text-dust">HowLongToBeat</span>
                      </div>
                      <div className="mt-[0.6em] flex h-[1.5em] gap-[2px]">
                        {Array.from({ length: hltbSegmentCount }, (_, index) => {
                          const fill = Math.max(0, Math.min(1, hltbFilled - index));
                          return (
                            <span
                              key={index}
                              className="relative flex-1 overflow-hidden rounded-xs bg-raised"
                            >
                              {fill > 0 && (
                                <span
                                  className="absolute inset-y-0 left-0 bg-phosphor"
                                  style={{ width: `${fill * 100}%` }}
                                />
                              )}
                            </span>
                          );
                        })}
                      </div>
                      <div className="relative mt-[0.2em] h-[2.6em]">
                        {hltbTiers.map((tier) => {
                          const pct = (tier.hours / hltbScale) * 100;
                          const done = game.totalHours >= tier.hours;
                          return (
                            <div
                              key={tier.label}
                              className={cn(
                                'absolute top-0 flex flex-col',
                                pct > 90 ? 'items-end' : 'items-center',
                              )}
                              style={
                                pct > 90
                                  ? { right: `${100 - pct}%` }
                                  : { left: `${pct}%`, transform: 'translateX(-50%)' }
                              }
                            >
                              <span aria-hidden className="h-[0.35em] w-px bg-dust" />
                              <span
                                className={cn(
                                  'flex items-center gap-[0.25em] text-[0.95em] leading-tight font-semibold tabular-nums',
                                  done ? 'text-phosphor' : 'text-bone',
                                )}
                              >
                                {done && <Check className="size-[0.85em]" strokeWidth={3} />}
                                {Math.round(tier.hours)}h
                              </span>
                              <span className="text-[0.88em] leading-tight text-dust">
                                {tier.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div />
                  )}

                  {noteText && (
                    <div className="min-w-0">
                      <span className={tvLabelClass}>{noteLabel}</span>
                      <p className="mt-[0.6em] border-l-[0.12em] border-phosphor pl-[0.9em] text-[1.08em] leading-relaxed text-bone">
                        {noteText}
                      </p>
                    </div>
                  )}
                </div>

                {/* La curiosidad ancla el pie del Overview; rota cada docena
                    de segundos con un fundido. */}
                {curiosity && (
                  <p
                    key={curiosity}
                    className="mt-auto flex max-w-[48em] animate-fade-in items-start gap-[0.6em] self-start rounded-md border border-line bg-panel px-[1em] py-[0.7em] text-[0.95em] leading-relaxed text-dust transition-opacity duration-300"
                    style={curiosityLeaving ? { opacity: 0 } : undefined}
                  >
                    <Info className="mt-[0.2em] size-[1em] flex-none text-tube" />
                    {curiosity}
                  </p>
                )}
              </div>
            ) : activeTab === 'achievements' ? (
              <TvDetailAchievements gameId={game.id} />
            ) : activeTab === 'sessions' ? (
              <TvDetailSessions game={game} />
            ) : activeTab === 'history' ? (
              <TvDetailHistory game={game} />
            ) : activeTab === 'notes' ? (
              <TvDetailNotes game={game} />
            ) : (
              <TvDetailSaves gameId={game.id} />
            )}
          </div>
        </div>

        {/* La columna física del Overview: carátula y sus vueltas. En las
            demás secciones se retira para que la sección gane el ancho. */}
        {!compact && (
          <div
            className={cn(
              'flex w-[11.5em] flex-none flex-col gap-[1.2em] pt-[0.4em]',
              tvRevealClass,
            )}
            style={tvRevealStyle(2)}
          >
            <TvCoverArt game={game} className="w-full border border-line-strong shadow-lift" />
            {playthroughs.length > 0 && (
              <div className="flex flex-col gap-[0.5em]">
                <div className="flex items-baseline gap-[0.5em]">
                  <span className={tvLabelClass}>Playthroughs</span>
                  <span className="text-[0.92em] text-dust tabular-nums">
                    {playthroughs.length}
                  </span>
                </div>
                {playthroughs.slice(0, 3).map(({ iteration, ordinal }) => {
                  const key: StatusKey = iteration.currentState
                    ? STATE_TO_STATUS_KEY[iteration.currentState]
                    : 'unplayed';
                  const range = iteration.startedAt
                    ? `${monthYear(iteration.startedAt)}${
                        iteration.endedAt
                          ? ` to ${monthYear(iteration.endedAt)}`
                          : iteration.currentState === 'started'
                            ? ' to now'
                            : ''
                      }`
                    : null;
                  return (
                    <div key={iteration.id} className="flex flex-col">
                      <div className="flex items-center gap-[0.45em] text-[1em] font-semibold text-bone">
                        <span className="font-display text-[1.3em] leading-none font-bold text-dust">
                          #{ordinal}
                        </span>
                        <TvLed status={key} />
                        {STATUS_META[key].label}
                        {iteration.hours > 0 && (
                          <span className="ml-auto text-[0.92em] font-medium text-dust tabular-nums">
                            {formatHours(iteration.hours)}
                          </span>
                        )}
                      </div>
                      {range && <div className="text-[0.88em] text-dust tabular-nums">{range}</div>}
                    </div>
                  );
                })}
                {playthroughs.length > 3 && (
                  <div className="text-[0.88em] text-dust">+{playthroughs.length - 3} earlier</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {statusOpen && <StatusPicker game={game} onClose={() => setStatusOpen(false)} />}
    </div>
  );
};
