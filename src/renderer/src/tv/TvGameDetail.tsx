import {
  CalendarPlus,
  CalendarRange,
  Check,
  ChevronLeft,
  Clock3,
  Coins,
  History,
  Hourglass,
  Lightbulb,
  Play,
  Repeat,
  Trophy,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { GameDetail } from '../../../shared/types';
import { GameCover } from '../components/GameCover';
import { useGameAchievements } from '../hooks/achievements';
import { useGame } from '../hooks/games';
import { useCuriosities } from '../hooks/curiosities';
import { useCreateIteration } from '../hooks/iterations';
import { useAddStateEvent } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { useLiveTimer } from '../hooks/useLiveTimer';
import { celebrateCompletion } from '../lib/celebrate';
import { humanizeAgoDays } from './tvFormat';
import { formatElapsed, formatHours, formatMoney } from '../lib/format';
import type { PastStatusKey } from '../lib/gameStatus';
import {
  ENDLESS_STATUS_OPTIONS,
  getGameStatusMeta,
  NORMAL_STATUS_OPTIONS,
  STATE_TO_STATUS_KEY,
  STATUS_META,
  STATUS_TO_STATE_TYPE,
} from '../lib/gameStatus';
import { isTerminal, lastIteration, startedIteration } from '../lib/iterations';
import { closedSessions, liveSession } from '../lib/sessions';
import { useTvBackdrop } from './backdropContext';
import { TV_MODAL_SWALLOW, useTvButtons, useTvLegend } from './tvInput';
import { TvFocusLayer } from './focus';
import { useTvFocusable } from './focusContext';
import { tvSound } from './sound';
import { tvRevealClass, tvRevealStyle } from './styles';
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

// La pestaña: el mismo lenguaje que los FilterPill de Library (verde para la
// activa, luz interior para la enfocada). Silenciada en el reparto genérico:
// cambiar de sección suena el tick de moverse, no el confirmar de actuar.
const TabPill = ({
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
      data-tv-sound="none"
      // Base oscura SÓLIDA, sin backdrop-blur: la fila entra con la cascada
      // de reveal (transform+opacity) y un blur ahí dentro no puede
      // muestrear hasta que la animación acaba — el "cristal que de pronto
      // se oscurece". Regla de la casa (la del RecapPanel del Journey).
      className="relative overflow-hidden rounded-full px-[0.95em] py-[0.32em] text-[0.7em] font-bold transition-[background-color,color,box-shadow,translate] duration-200"
      style={{
        ...(active
          ? {
              background:
                'linear-gradient(180deg, rgba(47,220,126,.26), rgba(47,220,126,.12)), rgba(8,12,10,.6)',
              color: '#2fdc7e',
              boxShadow: 'inset 0 0 0 1px rgba(47,220,126,.4)',
            }
          : {
              background: 'rgba(8,12,10,.5)',
              color: 'var(--muted-foreground)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1)',
            }),
        ...(focused
          ? {
              background:
                'linear-gradient(180deg, rgba(47,220,126,.18), rgba(47,220,126,.1)), rgba(8,12,10,.6)',
              color: '#2fdc7e',
              translate: '0 -0.1em',
            }
          : {}),
      }}
    >
      {focused && (
        <span
          aria-hidden
          className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: 'inset 0 0 0 2px rgba(47,220,126,.8)' }}
        />
      )}
      <span className="relative">{label}</span>
    </button>
  );
};

const ActionButton = ({
  label,
  icon,
  color = '#2fdc7e',
  solid = false,
  autoFocus = false,
  silent = false,
  onSelect,
}: {
  label: string;
  icon?: React.ReactNode;
  color?: string;
  solid?: boolean;
  autoFocus?: boolean;
  // silent: para acciones cuya consecuencia ya suena sola (abrir un panel →
  // pushLayer) — el confirmar genérico encima sería doble.
  silent?: boolean;
  onSelect: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect, autoFocus });
  return (
    <button
      ref={ref}
      type="button"
      data-tv-sound={silent ? 'none' : undefined}
      onClick={onSelect}
      // overflow-hidden para que el sheen viva DENTRO de la píldora; la
      // elevación va por CLASE (translate) y no inline para que el active:
      // del ratón pueda hundirla — el press-feedback lo resuelve la cascada.
      className={`relative flex items-center gap-[0.5em] overflow-hidden rounded-full px-[1.3em] py-[0.55em] text-[0.9em] font-extrabold transition-[background-color,box-shadow,translate,color,filter] duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${
        focused ? '-translate-y-[0.15em] active:translate-y-[0.02em] active:brightness-90' : ''
      }`}
      style={
        focused
          ? solid
            ? {
                background: color,
                color: '#08240f',
                boxShadow: `0 0.6em 1.8em ${color}59, 0 0 0 3px ${color}40, inset 0 1px 0 rgba(255,255,255,.35)`,
              }
            : {
                background: `${color}1f`,
                color,
                boxShadow: `inset 0 0 0 2px ${color}80, 0 0 1.4em ${color}33`,
              }
          : {
              // Base oscura sólida (sin blur): estos botones viven sobre el
              // hero nítido y el white translúcido se perdía contra arte claro.
              background: 'rgba(12,16,14,.62)',
              color: 'var(--foreground)',
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,.13), inset 0 1px 0 rgba(255,255,255,.09)',
            }
      }
    >
      {/* El barrido de luz al recibir el foco: la píldora te saluda una vez. */}
      {focused && (
        <span
          aria-hidden
          className="afterplay-tv-sheen pointer-events-none absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-transparent via-white/30 to-transparent"
        />
      )}
      {icon}
      {label}
    </button>
  );
};

// Volver, visible: el mando tiene B, el ratón necesita una puerta que se vea.
// Cristal como el resto de superficies; al enfocarse, el anillo RESPIRA y el
// chevrón se asoma hacia la salida — la puerta te señala el camino.
const BackButton = ({ onSelect }: { onSelect: () => void }): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect });
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      // Vuelve hacia ATRÁS: sonar el confirmar ascendente aquí era decir lo
      // contrario de lo que hace — el back() lo pone quien lo usa (abajo).
      data-tv-sound="none"
      aria-label="Back"
      className="relative flex h-[1.9em] w-[1.9em] items-center justify-center rounded-full transition-[background-color,box-shadow] duration-200 ease-[cubic-bezier(.22,1,.36,1)]"
      style={
        focused
          ? {
              background: 'rgba(255,255,255,.14)',
              boxShadow: '0 0 1.2em rgba(255,255,255,.14)',
            }
          : {
              background: 'rgba(12,16,14,.6)',
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,.14), inset 0 1px 0 rgba(255,255,255,.08)',
            }
      }
    >
      {/* El anillo late solo con el foco encima: "esto te espera", no "esto está". */}
      {focused && (
        <span
          aria-hidden
          className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.55)' }}
        />
      )}
      <ChevronLeft
        className={`h-[1.1em] w-[1.1em] transition-[translate] duration-200 ${
          focused ? '-translate-x-[0.07em]' : ''
        }`}
      />
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
      const needsNewIteration =
        !activeIteration && (!lastIt || (isTerminal(lastIt) && key === 'playing'));

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
      if (key === 'beaten') celebrateCompletion();
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
          className="animate-in fade-in-0 absolute inset-0 bg-black/65 duration-200"
          onClick={onClose}
        />
        {/* El panel nace con el pop de la casa: pequeño y subiendo, con su
            hairline de luz arriba — cristal que llega, no que aparece. */}
        <div className="afterplay-tv-pop relative w-[16em] rounded-[0.7em] border border-white/[0.12] bg-[#121413]/95 px-[1em] py-[1em] shadow-[inset_0_1px_0_rgba(255,255,255,.10),0_2em_4em_rgba(0,0,0,.6)]">
          <div className="mb-[0.6em] border-b border-white/[0.07] px-[0.4em] pb-[0.55em] text-[0.68em] font-extrabold tracking-[.18em] text-muted-foreground">
            SET STATUS
          </div>
          <div className="flex flex-col gap-[0.35em]">
            {options.map((key, index) => {
              const meta = STATUS_META[key];
              return (
                <StatusOption
                  key={key}
                  label={meta.label}
                  color={meta.color}
                  Icon={meta.Icon}
                  current={key === currentKey}
                  autoFocus={index === 0}
                  onSelect={() => void save(key)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </TvFocusLayer>
  );
};

const StatusOption = ({
  label,
  color,
  Icon,
  current,
  autoFocus,
  onSelect,
}: {
  label: string;
  color: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
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
      className="flex w-full items-center gap-[0.6em] rounded-[0.45em] px-[0.8em] py-[0.55em] text-[0.9em] font-bold transition-[background-color,box-shadow,translate,color] duration-150 ease-[cubic-bezier(.22,1,.36,1)]"
      style={
        focused
          ? {
              background: `${color}1c`,
              color,
              boxShadow: `inset 0 0 0 2px ${color}66, 0 0 1.1em ${color}26`,
              translate: '0.25em 0',
            }
          : { color: current ? color : 'var(--muted-foreground)' }
      }
    >
      <Icon
        className="h-[1em] w-[1em] transition-[filter] duration-150"
        // La gotita de luz del icono solo con el foco: vida sin ruido.
        style={{ color, filter: focused ? `drop-shadow(0 0 0.4em ${color}b3)` : undefined }}
      />
      {label}
      {/* El estado que ya tienes LATE despacio: elegirlo de nuevo solo cierra. */}
      {current && (
        <span
          className="afterplay-tv-glow ml-auto h-[0.4em] w-[0.4em] rounded-full"
          style={{ background: color, boxShadow: `0 0 0.5em ${color}` }}
        />
      )}
    </button>
  );
};

export const TvGameDetail = (): React.JSX.Element | null => {
  const { id } = useParams();
  const navigate = useNavigate();
  const gameId = Number(id);
  const { data: game } = useGame(gameId);
  const { data: curiosityRows = [] } = useCuriosities();
  const { data: achievements } = useGameAchievements(gameId);
  const [statusOpen, setStatusOpen] = useState(false);
  const [tab, setTab] = useState<DetailTabKey>('overview');
  const [launching, setLaunching] = useState(false);

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
  const liveSince = useMemo(() => {
    if (!game?.isLive) return null;
    return liveSession(game)?.startedAt ?? null;
  }, [game]);
  const liveSeconds = useLiveTimer(liveSince);
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

  if (!game) return null;

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
  const noteLabel = lastNote ? 'WHERE YOU LEFT OFF' : 'YOUR NOTES';

  // HLTB con la geometría del escritorio: tres tramos sobre una escala común
  // (el mayor de los tres tiempos) y tus horas aterrizando como marcador.
  const hltbMain = game.hltbMain ?? 0;
  const hltbExtra = game.hltbMainExtras ?? 0;
  const hltbComp = game.hltbCompletionist ?? 0;
  const hasHltb = hltbMain > 0 || hltbExtra > 0 || hltbComp > 0;
  const hltbScale = Math.max(hltbMain, hltbExtra, hltbComp, 1);
  const segMain = (hltbMain / hltbScale) * 100;
  const segExtra = (Math.max(0, hltbExtra - hltbMain) / hltbScale) * 100;
  // El último tramo se calcula como RESTO para que la suma cierre exacta.
  const segComp = hltbComp > 0 ? Math.max(0, (hltbComp / hltbScale) * 100 - segMain - segExtra) : 0;
  const hltbSegments = [
    { key: 'main', pct: segMain, color: '#2bb6a6' },
    { key: 'extra', pct: segExtra, color: '#3f7fe0' },
    { key: 'comp', pct: segComp, color: '#2fdc7e' },
  ].filter((segment) => segment.pct > 0);
  const hltbMarkerPct = Math.min(100, (game.totalHours / hltbScale) * 100);
  const hltbTiers = [
    { label: 'STORY', hours: hltbMain, color: '#2bb6a6' },
    { label: '+ EXTRAS', hours: hltbExtra, color: '#3f7fe0' },
    { label: '100%', hours: hltbComp, color: '#2fdc7e' },
  ].filter((tier) => tier.hours > 0);

  const launch = async (): Promise<void> => {
    if (!game.executablePath || launching) return;
    setLaunching(true);
    const result = await window.api.games.launchExecutable(game.executablePath);
    if (!result.ok) {
      toast.error(
        result.reason === 'missing'
          ? 'That executable is gone — set it again from your desk.'
          : 'Could not launch the game.',
      );
    }
    setTimeout(() => setLaunching(false), 2_500);
  };

  return (
    <div className="isolate relative flex h-full flex-col pb-[0.6em]">
      {/* EL HERO COMO ESCENARIO: el arte NÍTIDO ocupa la pantalla ENTERA de
          la ficha, derivando en Ken Burns, y se oscurece progresivamente
          hacia abajo hasta ser la base del contenido. La primera versión era
          una banda que moría a mitad de pantalla y debajo asomaba el mundo
          de luciérnagas — dos fondos pegados con una costura visible;
          full-bleed es UNA sola atmósfera. Velo izquierdo para el texto de
          cabecera, oscuridad creciente para la zona de pestañas. -z-10 +
          isolate: detrás de todo lo de esta pantalla, delante del backdrop
          global. */}
      {heroSrc && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[3.2vh] -right-[4vw] -bottom-[0.2em] -left-[4vw] -z-10 overflow-hidden"
        >
          <img src={heroSrc} alt="" className="afterplay-tv-hero-art h-full w-full object-cover" />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(8,10,9,.92) 0%, rgba(8,10,9,.58) 38%, rgba(8,10,9,.2) 68%, rgba(8,10,9,.5) 100%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(8,10,9,.32) 0%, rgba(8,10,9,.12) 22%, rgba(9,11,10,.55) 52%, rgba(10,12,11,.84) 74%, rgba(11,13,12,.93) 100%)',
            }}
          />
        </div>
      )}

      {/* CABECERA fija: volver, estado, título e identidad — lo que no
          cambia con la sección. Debajo, el cuerpo reparte contenido de
          pestaña (izquierda) y la pieza física con sus vueltas (derecha). */}
      <div className="flex flex-none flex-col gap-[0.5em]">
        <div className={tvRevealClass} style={tvRevealStyle(0)}>
          <BackButton
            onSelect={() => {
              // La misma firma sonora que B: nota cayendo, no confirmar.
              tvSound.back();
              void navigate(-1);
            }}
          />
        </div>

        <div
          className={`flex flex-wrap items-center gap-x-[0.6em] gap-y-[0.25em] text-[0.72em] font-extrabold tracking-[.14em] ${tvRevealClass}`}
          style={tvRevealStyle(1)}
        >
          <status.Icon className="h-[1.15em] w-[1.15em]" style={{ color: status.color }} />
          <span style={{ color: status.color }}>{status.label.toUpperCase()}</span>
          {game.releaseYear !== null && (
            <span className="text-muted-foreground">· {game.releaseYear}</span>
          )}
          {game.endless && (
            <span
              className="rounded-full px-[0.55em] py-[0.08em] text-[0.8em]"
              style={{
                color: '#a9b3e8',
                background: 'rgba(124,134,200,.12)',
                boxShadow: 'inset 0 0 0 1px rgba(124,134,200,.35)',
              }}
            >
              ∞ ENDLESS
            </span>
          )}
          {game.isEmulated && (
            <span
              className="rounded-full px-[0.55em] py-[0.08em] text-[0.8em]"
              style={{
                color: '#a6c1e8',
                background: 'rgba(133,163,214,.12)',
                boxShadow: 'inset 0 0 0 1px rgba(133,163,214,.35)',
              }}
            >
              EMULATED
            </span>
          )}
        </div>

        <h1
          className={`max-w-[95%] text-[2em] leading-[1.06] font-extrabold tracking-[-.018em] drop-shadow-[0_2px_20px_rgba(0,0,0,.6)] ${tvRevealClass}`}
          style={tvRevealStyle(2)}
        >
          {game.title}
        </h1>

        {/* La línea de identidad bajo el título — quién lo hizo y de qué
            va, como la cabecera del hero de escritorio. Vive en la cabecera
            (es identidad, no contenido de sección) y así el Overview respira. */}
        {(game.developer || game.publisher || (game.genres?.length ?? 0) > 0) && (
          <div
            className={`flex max-w-[70%] flex-wrap items-center gap-x-[0.55em] gap-y-[0.3em] text-[0.68em] font-semibold text-white/60 ${tvRevealClass}`}
            style={tvRevealStyle(3)}
          >
            {game.developer && <span>{game.developer}</span>}
            {game.publisher && game.publisher !== game.developer && (
              <span className="text-white/35">· {game.publisher}</span>
            )}
            {(game.genres ?? []).slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="rounded-full bg-black/55 px-[0.6em] py-[0.1em] text-[0.85em] text-white/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-[2.2em] pt-[0.6em]">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Las acciones viven SOBRE las pestañas: lanzar y cambiar estado
              valen para cualquier sección. */}
          <div
            className={`flex items-center gap-[0.8em] ${tvRevealClass}`}
            style={tvRevealStyle(3)}
          >
            {game.isLive ? (
              // El juego ESTÁ corriendo: el botón de lanzar se convierte en
              // el estado en vivo — píldora sólida con el punto latiendo y
              // el contador de la sesión subiendo. (No hay "Stop" honesto:
              // Afterplay observa el proceso, no lo posee — matarlo desde
              // aquí podría llevarse una partida sin guardar.)
              <div
                className="relative flex items-center gap-[0.5em] rounded-full px-[1.3em] py-[0.55em] text-[0.9em] font-extrabold"
                style={{
                  background: 'rgba(47,220,126,.16)',
                  color: '#2fdc7e',
                  boxShadow: 'inset 0 0 0 2px rgba(47,220,126,.55), 0 0 1.4em rgba(47,220,126,.18)',
                }}
              >
                <span className="relative flex h-[0.55em] w-[0.55em] flex-none">
                  <span className="afterplay-tv-ring absolute inset-0 rounded-full bg-[#2fdc7e] shadow-[0_0_0.6em_#2fdc7e]" />
                </span>
                Playing
                {liveSince && (
                  <span className="text-[0.85em] font-bold text-[#a7f3c9] tabular-nums">
                    · {formatElapsed(liveSeconds)}
                  </span>
                )}
              </div>
            ) : (
              game.executablePath && (
                <ActionButton
                  label={launching ? 'Launching…' : 'Play'}
                  icon={<Play className="h-[1em] w-[1em]" fill="currentColor" />}
                  solid
                  autoFocus
                  onSelect={() => void launch()}
                />
              )
            )}
            <ActionButton
              label="Set status"
              autoFocus={!game.executablePath || game.isLive}
              // La apertura del picker ya suena por pushLayer.
              silent
              onSelect={() => setStatusOpen(true)}
            />
          </div>

          {/* La barra de secciones — ver DETAIL_TABS arriba. */}
          <div
            className={`mt-[0.7em] flex items-center gap-[0.4em] ${tvRevealClass}`}
            style={tvRevealStyle(4)}
          >
            {tabs.map((entry) => (
              <TabPill
                key={entry.key}
                label={entry.label}
                active={activeTab === entry.key}
                onSelect={() => selectTab(entry.key)}
              />
            ))}
            {/* El recordatorio del atajo, con cuerpo de chapa (sobre el arte
                un texto suelto se evaporaba). */}
            <span className="ml-[0.4em] flex items-center gap-[0.3em] rounded-full bg-black/55 px-[0.55em] py-[0.18em] text-[0.5em] font-extrabold tracking-[.08em] text-white/50 shadow-[inset_0_0_0_1px_rgba(255,255,255,.1)]">
              LB
              <span className="text-white/25">·</span>
              RB
            </span>
          </div>

          {/* El contenido de la sección activa: remonta con key para que
              cada llegada tenga su pequeña entrada. */}
          <div
            key={activeTab}
            className="animate-in fade-in-0 slide-in-from-bottom-2 mt-[0.85em] min-h-0 flex-1 duration-300"
          >
            {activeTab === 'overview' ? (
              <div
                className="flex h-full flex-col gap-[0.95em] overflow-y-auto pr-[0.3em] pt-[0.15em]"
                style={{ scrollbarWidth: 'none' }}
              >
                {/* Los VITALES como fichas de cristal: cada número con su
                    casa, su color y su brillo de esquina — legibles sobre
                    cualquier arte, nada de texto flotando en el fondo. */}
                <div
                  className={`flex flex-wrap gap-[0.55em] ${tvRevealClass}`}
                  style={tvRevealStyle(1)}
                >
                  {(
                    [
                      {
                        label: 'HOURS',
                        value: formatHours(game.totalHours),
                        accent: '#2fdc7e',
                        Icon: Clock3,
                      },
                      {
                        label: 'SESSIONS',
                        value: String(sessionCount),
                        accent: '#85a3d6',
                        Icon: CalendarRange,
                      },
                      // Los trofeos entre los vitales: el "cuánto es tuyo" en
                      // un vistazo, con la invitación implícita de RB para
                      // llegar a la pestaña con el detalle.
                      ...(achievementsTotal > 0
                        ? [
                            {
                              label: 'TROPHIES',
                              value: `${achievementsUnlocked}/${achievementsTotal}`,
                              sub: `${Math.round((achievementsUnlocked / achievementsTotal) * 100)}%`,
                              accent: '#e3b24a',
                              Icon: Trophy,
                            },
                          ]
                        : []),
                      ...(lastPlayed
                        ? [
                            {
                              label: 'LAST PLAYED',
                              value: humanizeAgoDays(lastPlayed),
                              accent: '#7c86c8',
                              Icon: History,
                            },
                          ]
                        : []),
                      ...(game.totalSpend > 0
                        ? [
                            {
                              label: 'SPENT',
                              value: formatMoney(game.totalSpend),
                              sub:
                                game.costPerHour !== null
                                  ? `${formatMoney(game.costPerHour)}/h`
                                  : undefined,
                              accent: '#e3b24a',
                              Icon: Coins,
                            },
                          ]
                        : []),
                      {
                        label: 'IN LIBRARY',
                        value: `since ${game.addedAt.getFullYear()}`,
                        accent: '#8b93a3',
                        Icon: CalendarPlus,
                      },
                    ] as {
                      label: string;
                      value: string;
                      sub?: string;
                      accent: string;
                      Icon: typeof Clock3;
                    }[]
                  ).map((stat) => (
                    <div
                      key={stat.label}
                      className="relative min-w-[7.2em] overflow-hidden rounded-[0.55em] bg-black/70 px-[0.75em] py-[0.5em]"
                      style={{
                        boxShadow:
                          'inset 0 0 0 1px rgba(255,255,255,.07), inset 0 1px 0 rgba(255,255,255,.07)',
                      }}
                    >
                      {/* El brillo del acento en la esquina, tan tenue que
                          solo colorea el aire de la ficha. */}
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -top-[1.2em] -right-[1.2em] h-[3em] w-[3em] rounded-full"
                        style={{ background: stat.accent, opacity: 0.12, filter: 'blur(0.7em)' }}
                      />
                      <div
                        className="relative flex items-center gap-[0.4em] text-[0.5em] font-extrabold tracking-[.16em]"
                        style={{ color: `${stat.accent}d9` }}
                      >
                        <stat.Icon className="h-[1.25em] w-[1.25em]" />
                        {stat.label}
                      </div>
                      <div className="relative mt-[0.1em] text-[0.95em] font-extrabold tabular-nums">
                        {stat.value}
                      </div>
                      {stat.sub && (
                        <div className="relative text-[0.55em] font-semibold text-white/45 tabular-nums">
                          {stat.sub}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* HowLongToBeat con la barra de TRES TRAMOS del escritorio:
                    Story, +Extras y 100% creciendo en cascada, tus horas
                    aterrizando como marcador encima, y los hitos alcanzados
                    encendidos con su check. */}
                {hasHltb && (
                  <div
                    className={`relative max-w-[94%] overflow-hidden rounded-[0.6em] bg-black/70 px-[0.9em] pt-[0.65em] pb-[0.7em] ${tvRevealClass}`}
                    style={{
                      ...tvRevealStyle(2),
                      boxShadow:
                        'inset 0 0 0 1px rgba(255,255,255,.07), inset 0 1px 0 rgba(255,255,255,.06)',
                    }}
                  >
                    <div className="flex items-center gap-[0.4em] text-[0.55em] font-extrabold tracking-[.18em] text-white/45">
                      <Hourglass className="h-[1.2em] w-[1.2em] text-[#2bb6a6]" />
                      HOW LONG TO BEAT
                      {game.totalHours > 0 && (
                        <span className="ml-auto font-bold tracking-[.04em] text-white/55 tabular-nums">
                          you · {formatHours(game.totalHours)}
                        </span>
                      )}
                    </div>
                    <div className="relative mt-[1.25em]">
                      {game.totalHours > 0 && (
                        <div
                          className="absolute -top-[1.3em] z-[1]"
                          style={{
                            left: `${hltbMarkerPct}%`,
                            animation:
                              'afterplay-drop-in 420ms cubic-bezier(.22,1,.36,1) 620ms both',
                          }}
                        >
                          <span className="rounded-[0.3em] bg-[#1d211f] px-[0.4em] py-[0.12em] text-[0.5em] font-extrabold tabular-nums shadow-[0_0.2em_0.6em_rgba(0,0,0,.55),inset_0_0_0_1px_rgba(255,255,255,.16)]">
                            {formatHours(game.totalHours)}
                          </span>
                        </div>
                      )}
                      <div
                        className="flex h-[0.5em] w-full gap-[2px] overflow-hidden rounded-[0.25em] bg-white/[0.06]"
                        style={{ boxShadow: 'inset 0 1px 2px rgba(0,0,0,.5)' }}
                      >
                        {hltbSegments.map((segment, index) => (
                          <div
                            key={segment.key}
                            style={{
                              width: `${segment.pct}%`,
                              background: segment.color,
                              transformOrigin: 'left',
                              animation: `afterplay-grow-x 520ms cubic-bezier(.22,1,.36,1) ${index * 110}ms both`,
                            }}
                          />
                        ))}
                      </div>
                      {game.totalHours > 0 && (
                        <div
                          className="absolute top-0 h-[0.5em] w-[3px] -translate-x-1/2 rounded-full bg-white"
                          style={{
                            left: `${hltbMarkerPct}%`,
                            boxShadow:
                              '0 0 0.4em rgba(255,255,255,.8), 0 0 0 2px rgba(11,13,12,.7)',
                          }}
                        />
                      )}
                    </div>
                    <div className="mt-[0.55em] flex gap-[0.45em]">
                      {hltbTiers.map((tier) => {
                        const done = game.totalHours >= tier.hours;
                        return (
                          <div
                            key={tier.label}
                            className="flex flex-1 items-center justify-between gap-[0.4em] rounded-[0.4em] px-[0.55em] py-[0.32em] text-[0.55em] font-bold"
                            style={
                              done
                                ? {
                                    color: tier.color,
                                    background: `${tier.color}17`,
                                    boxShadow: `inset 0 0 0 1px ${tier.color}5c`,
                                  }
                                : {
                                    color: 'var(--muted-foreground)',
                                    background: 'rgba(255,255,255,.03)',
                                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)',
                                  }
                            }
                          >
                            <span className="flex items-center gap-[0.4em]">
                              {done ? (
                                <Check className="h-[1em] w-[1em]" strokeWidth={3.5} />
                              ) : (
                                <span
                                  className="h-[0.5em] w-[0.5em] rounded-[2px]"
                                  style={{ background: tier.color }}
                                />
                              )}
                              {tier.label}
                            </span>
                            <span className="font-extrabold tabular-nums">
                              {Math.round(tier.hours)}h
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {noteText && (
                  <div
                    className={`relative mt-[0.4em] max-w-[85%] overflow-hidden rounded-[0.55em] border border-white/[0.08] bg-black/70 px-[1em] py-[0.75em] ${tvRevealClass}`}
                    style={{
                      ...tvRevealStyle(3),
                      boxShadow:
                        'inset 0 1px 0 rgba(255,255,255,.10), 0 0.9em 2.2em rgba(0,0,0,.35)',
                    }}
                  >
                    {/* El aliento violeta del panel: la nota es memoria, y la
                  memoria en esta casa es violeta. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background:
                          'radial-gradient(120% 170% at 0% 0%, rgba(124,134,200,.14), transparent 55%)',
                      }}
                    />
                    {/* El lomo del cuaderno, respirando despacio; su luz sangra
                  hacia dentro del cristal (el overflow recorta lo demás). */}
                    <span
                      aria-hidden
                      className="afterplay-tv-glow absolute inset-y-0 left-0 w-[0.18em]"
                      style={{
                        background: 'linear-gradient(180deg, #7c86c8, #7c86c826)',
                        boxShadow: '0 0 0.8em rgba(124,134,200,.55)',
                      }}
                    />
                    {/* Unas comillas de agua como marca del panel, medio recortadas
                  a propósito — filigrana, no rótulo. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -top-[0.12em] right-[0.3em] text-[2.3em] leading-none font-extrabold text-[#7c86c8]/15"
                    >
                      ”
                    </span>
                    <div className="relative text-[0.6em] font-extrabold tracking-[.18em] text-[#a3abd8]/85">
                      {noteLabel}
                    </div>
                    <p className="relative mt-[0.25em] line-clamp-3 text-[0.95em] leading-snug font-medium text-white/85 italic">
                      “{noteText}”
                    </p>
                  </div>
                )}

                {/* La curiosidad ancla el PIE del Overview (mt-auto): con
                    pocos bloques, el hueco central queda como aire
                    intencionado en vez de contenido colgando a media
                    pantalla. */}
                {curiosity && (
                  <p
                    key={curiosity}
                    className="animate-in fade-in-0 slide-in-from-bottom-2 mt-auto flex max-w-[80%] items-start gap-[0.5em] pt-[0.8em] pb-[0.3em] text-[0.7em] leading-relaxed text-white/55 transition-[opacity,translate] duration-500 ease-out"
                    style={
                      curiosityLeaving
                        ? { opacity: 0, translate: '0 0.35em', transitionDuration: '340ms' }
                        : undefined
                    }
                  >
                    {/* La bombilla parpadea despacio: una idea que se le ocurre a
                  la pantalla, no un bullet point. */}
                    <Lightbulb className="afterplay-tv-glow mt-[0.15em] h-[1.1em] w-[1.1em] flex-none text-[#2bb6a6]/80" />
                    {curiosity}
                  </p>
                )}
              </div>
            ) : activeTab === 'achievements' ? (
              // El cristal se lo pone el shell: la pestaña trae contenido.
              <div
                className="relative h-full overflow-hidden rounded-[0.7em] border border-white/[0.09] bg-black/75 px-[1em] py-[0.8em]"
                style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10)' }}
              >
                <TvDetailAchievements gameId={game.id} />
              </div>
            ) : activeTab === 'sessions' ? (
              <div
                className="relative h-full overflow-hidden rounded-[0.7em] border border-white/[0.09] bg-black/75 px-[1em] py-[0.8em]"
                style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.10)' }}
              >
                <TvDetailSessions game={game} />
              </div>
            ) : activeTab === 'history' ? (
              <TvDetailHistory game={game} />
            ) : activeTab === 'notes' ? (
              <TvDetailNotes game={game} />
            ) : (
              <TvDetailSaves gameId={game.id} />
            )}
          </div>
        </div>

        {/* La pieza física: carátula nítida flotando con sus vueltas debajo
            — constante sea cual sea la sección (el ancla visual). */}
        <div
          className={`relative flex w-[10.5em] flex-none flex-col gap-[0.9em] self-center ${tvRevealClass}`}
          style={tvRevealStyle(2)}
        >
          {/* La pieza entera FLOTA (es el objeto físico de la pantalla) y
                el halo del color de estado respira detrás; la carátula queda
                nítida encima con su propia sombra profunda. Dos contenedores
                porque reveal y float no pueden compartir animation. */}
          <div className="afterplay-tv-float relative">
            <span
              aria-hidden
              className="afterplay-tv-glow absolute -inset-[0.9em]"
              style={{
                background: `radial-gradient(closest-side, ${status.color}50, transparent 72%)`,
                filter: 'blur(0.6em)',
              }}
            />
            <div
              className="relative"
              style={{ filter: 'drop-shadow(0 1.6em 3em rgba(0,0,0,.65))' }}
            >
              <GameCover
                url={game.coverUrl}
                className="aspect-[264/374] w-full overflow-hidden rounded-[0.6em]"
                iconSize={34}
              />
              {/* El vidrio de la carátula: hairline y luz superior en vez
                    de un border plano. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[0.6em]"
                style={{
                  boxShadow:
                    'inset 0 0 0 1px rgba(255,255,255,.16), inset 0 1px 0 rgba(255,255,255,.26)',
                }}
              />
            </div>
          </div>

          {/* Las vueltas al juego bajo la carátula — el PlaythroughPanel
                de escritorio en versión lectura: ordinal, estado, horas y
                el arco de fechas de cada una. */}
          {playthroughs.length > 0 && (
            <div
              className="relative overflow-hidden rounded-[0.6em] border border-white/[0.08] bg-black/70"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(120% 130% at 0% 0%, rgba(124,134,200,.1), transparent 55%)',
                }}
              />
              <div className="relative flex items-center gap-[0.4em] border-b border-white/[0.07] px-[0.7em] py-[0.4em]">
                <Repeat
                  className="h-[0.85em] w-[0.85em] flex-none text-[#7c86c8]"
                  style={{ filter: 'drop-shadow(0 0 0.4em rgba(124,134,200,.5))' }}
                />
                <span className="text-[0.52em] font-extrabold tracking-[.18em] text-muted-foreground">
                  PLAYTHROUGHS
                </span>
                <span className="ml-auto text-[0.55em] font-bold text-[#a3abd8]/80 tabular-nums">
                  {playthroughs.length}
                </span>
              </div>
              <div className="relative flex flex-col gap-[0.15em] px-[0.7em] py-[0.4em]">
                {playthroughs.slice(0, 3).map(({ iteration, ordinal }) => {
                  const meta = getGameStatusMeta(iteration.currentState);
                  const range = iteration.startedAt
                    ? `${monthYear(iteration.startedAt)}${
                        iteration.endedAt
                          ? ` → ${monthYear(iteration.endedAt)}`
                          : iteration.currentState === 'started'
                            ? ' → now'
                            : ''
                      }`
                    : null;
                  return (
                    <div key={iteration.id} className="py-[0.15em]">
                      <div className="flex items-center gap-[0.4em] text-[0.58em] font-bold">
                        <span className="text-white/35 tabular-nums">#{ordinal}</span>
                        <meta.Icon
                          className="h-[1.05em] w-[1.05em] flex-none"
                          style={{ color: meta.color }}
                        />
                        <span className="truncate" style={{ color: meta.color }}>
                          {meta.label}
                        </span>
                        {iteration.hours > 0 && (
                          <span className="ml-auto flex-none text-white/60 tabular-nums">
                            {formatHours(iteration.hours)}
                          </span>
                        )}
                      </div>
                      {range && (
                        <div className="pl-[1.6em] text-[0.5em] font-semibold text-white/40 tabular-nums">
                          {range}
                        </div>
                      )}
                    </div>
                  );
                })}
                {playthroughs.length > 3 && (
                  <div className="text-[0.5em] font-semibold text-white/30">
                    +{playthroughs.length - 3} earlier
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {statusOpen && <StatusPicker game={game} onClose={() => setStatusOpen(false)} />}
    </div>
  );
};
