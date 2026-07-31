import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GeneratedMemorySummary } from '../../../shared/types';
import type { JourneyEntry } from '../lib/journeyEntries';
import { buildEntries } from '../lib/journeyEntries';
import { GameCover } from '../components/GameCover';
import { useGames } from '../hooks/games';
import { useMemories } from '../hooks/memories';
import { useSessions } from '../hooks/sessions';
import { useStateEvents } from '../hooks/stateEvents';
import { BLUE, VIOLET } from '../lib/colors';
import { formatHours } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { useImageSrc } from '../hooks/useImageSrc';
import { useTvBackdrop, useTvSkyBackdrop } from './backdropContext';
import { useTvButtons, useTvLegend } from './tvInput';
import { useTvFocusable } from './focusContext';
import { forgetJourneyPage, recallJourneyPage, rememberJourneyPage } from './screenMemory';
import { TvActivityHeatmap } from './TvActivityHeatmap';
import { TvScreenTitle } from './TvScreenTitle';
import { tvSound } from './sound';
import { tvRevealClass, tvRevealStyle } from './styles';

// El Journey del sofá (BIG-PICTURE.md §5.7): tu historia como LIBRO de
// páginas, no como scroll infinito — el scroll-spy y el índice lateral son
// artefactos de ratón y se quedan en el escritorio. Una página por mes con
// actividad (su recap del Loop si existe + sus carátulas), y páginas de año
// como portadas de capítulo con el YearStory completo.
//
// LB/RB pasa página (mes a mes); LT/RT salta de año; el d-pad recorre las
// carátulas de la página; A abre la ficha TV. Mismos datos que el Journey de
// escritorio: buildEntries + useMemories, ni un cálculo nuevo.

type TvJourneyPage =
  | {
      // La cubierta del libro: texto FIJO escrito aquí (nada de IA) + los
      // totales de toda la biblioteca. Siempre es la página 1.
      kind: 'intro';
      years: number;
      games: number;
      hours: number;
      firstYear: number;
    }
  | {
      kind: 'year';
      year: number;
      games: number;
      hours: number;
      // El "año en revisión" de la portada de capítulo: cuántas veces te
      // sentaste y cuál fue EL juego del año.
      sessionCount: number;
      topGame: { title: string; hours: number } | null;
      recap: GeneratedMemorySummary | null;
    }
  | {
      kind: 'month';
      year: number;
      month: number;
      entries: JourneyEntry[];
      hours: number;
      recap: GeneratedMemorySummary | null;
    };

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// La carátula del Journey TV, con el mismo lenguaje de foco que TvGameTile:
// la luz vive DENTRO del marco (anillo interior respirando + barrido de
// brillo + brightness) y lo único exterior son sombras, que el acolchado de
// la fila absorbe. Sin escalar el arte jamás — la lección Chromium.
const JourneyCoverTv = ({
  entry,
  autoFocus,
  revealIndex,
  onOpen,
}: {
  entry: JourneyEntry;
  autoFocus: boolean;
  revealIndex: number;
  onOpen: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect: onOpen, autoFocus });
  const status = getGameStatusMeta(entry.state);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className={`w-[6.2em] flex-none text-left transition-[translate] duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${tvRevealClass}`}
      style={{
        ...tvRevealStyle(revealIndex),
        ...(focused ? { translate: '0 -0.35em', zIndex: 2 } : {}),
      }}
    >
      <div
        className="relative overflow-hidden rounded-[0.4em] transition-[box-shadow,filter] duration-250"
        style={{
          // NADA fuera del marco (misma regla que TvGameTile): la sombra
          // negra difuminada se veía como mancha gris sobre el backdrop —
          // la elevación la dan translate + brightness, el color el anillo.
          boxShadow: focused ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,.09)',
          filter: focused ? 'brightness(1.12)' : undefined,
        }}
      >
        <GameCover url={entry.coverUrl} className="aspect-[264/374] w-full" iconSize={22} />
        {/* La franja de estado al pie — se enciende con el foco. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[0.16em] transition-opacity duration-200"
          style={{ background: status.color, opacity: focused ? 1 : 0.6 }}
        />
        {/* El anillo INTERIOR que respira y el barrido de luz de bienvenida:
            todo dentro del overflow-hidden, nada que un contenedor con
            scroll pueda recortar. */}
        {focused && (
          <>
            <span
              aria-hidden
              className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-[0.4em]"
              style={{ boxShadow: `inset 0 0 0 3px ${status.color}` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-[0.4em]"
            >
              <span
                className="afterplay-tv-sheen absolute inset-y-0 left-0 w-[45%]"
                style={{
                  background:
                    'linear-gradient(105deg, transparent, rgba(255,255,255,.22), transparent)',
                }}
              />
            </span>
          </>
        )}
      </div>
      <div
        className="mt-[0.35em] truncate text-[0.62em] font-bold transition-colors duration-150"
        style={{ color: focused ? 'var(--foreground)' : 'var(--muted-foreground)' }}
      >
        {entry.title}
      </div>
      <div
        className="text-[0.55em] font-semibold tabular-nums transition-colors duration-150"
        style={{ color: focused ? status.color : 'rgba(136,143,138,.7)' }}
      >
        {entry.hours > 0 ? formatHours(entry.hours) : status.label}
      </div>
    </button>
  );
};

// El panel de recap — el texto violeta del Loop a escala de tele, vestido de
// lomo de libro: hairline de luz arriba en vez de border plano, el lomo
// violeta respirando, un aliento de luz en la esquina y un barrido único al
// abrir la página. Sin backdrop-blur a propósito: la página keyed lleva un
// transform permanente (el page-turn con fill both) que rompería el muestreo
// del backdrop-filter.
const RecapPanel = ({
  recap,
  eyebrow,
  compact = false,
}: {
  recap: GeneratedMemorySummary;
  eyebrow: string;
  compact?: boolean;
}): React.JSX.Element => (
  <div
    className="relative overflow-hidden rounded-[0.6em] px-[1.2em] py-[0.9em]"
    style={{
      // El tinte violeta va SOBRE una base oscura casi opaca: el panel es la
      // página del libro y tiene que taparle la luz a las luciérnagas que
      // pasan por detrás — con solo el degradado translúcido el texto
      // competía con el enjambre.
      background:
        'linear-gradient(125deg, rgba(124,134,200,.14), rgba(124,134,200,.05) 50%, transparent), rgba(13,15,17,.88)',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.07), 0 0.6em 1.6em rgba(0,0,0,.4)',
    }}
  >
    {/* Hairline de luz en el canto superior — el border plano, jubilado. */}
    <span
      aria-hidden
      className="absolute inset-x-0 top-0 h-px"
      style={{ background: `linear-gradient(90deg, transparent, ${VIOLET}66, transparent)` }}
    />
    {/* El aliento violeta de la esquina: una luz difusa que respira al mismo
        ritmo que el lomo — el panel está vivo sin moverse. */}
    <span
      aria-hidden
      className="afterplay-tv-glow pointer-events-none absolute -top-[3em] -left-[3em] h-[7em] w-[7em] rounded-full"
      style={{ background: `radial-gradient(circle, ${VIOLET}2e, transparent 70%)` }}
    />
    {/* El lomo del libro, respirando. */}
    <span
      aria-hidden
      className="afterplay-tv-glow absolute inset-y-0 left-0 w-[0.18em]"
      style={{
        background: `linear-gradient(180deg, ${VIOLET}, ${VIOLET}26)`,
        boxShadow: `0 0 0.9em ${VIOLET}66`,
      }}
    />
    <div
      className="flex items-center gap-[0.4em] text-[0.55em] font-extrabold tracking-[.2em]"
      style={{ color: `${VIOLET}d9` }}
    >
      <BookOpen className="h-[1.2em] w-[1.2em]" />
      {eyebrow}
    </div>
    <div className="mt-[0.35em] text-[1.05em] font-extrabold tracking-[-.01em]">
      {recap.payload.headline}
    </div>
    <p
      className={`mt-[0.3em] text-[0.72em] leading-relaxed text-muted-foreground ${compact ? 'line-clamp-3' : ''}`}
    >
      {recap.payload.narrative}
    </p>
    {!compact && recap.payload.highlights.length > 0 && (
      <div className="mt-[0.5em] flex flex-col gap-[0.25em]">
        {recap.payload.highlights.map((line) => (
          <div
            key={line}
            className="flex items-start gap-[0.5em] text-[0.68em] font-semibold text-foreground/80"
          >
            <span
              className="mt-[0.45em] h-[0.28em] w-[0.28em] flex-none rounded-full"
              style={{ background: `${VIOLET}b3` }}
            />
            {line}
          </div>
        ))}
      </div>
    )}
    {!compact && recap.payload.closingLine.length > 0 && (
      <p className="mt-[0.5em] text-[0.68em] italic" style={{ color: `${VIOLET}a6` }}>
        {recap.payload.closingLine}
      </p>
    )}
    {/* El barrido de luz al abrir la página: el panel se remonta con cada
        paso (key por página), así que el sheen saluda exactamente una vez. */}
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <span
        className="afterplay-tv-sheen absolute inset-y-0 left-0 w-[38%]"
        style={{
          background: 'linear-gradient(105deg, transparent, rgba(255,255,255,.06), transparent)',
        }}
      />
    </span>
  </div>
);

// Una cifra del año: número grande en su color y la palabra en pequeño. El
// mismo lenguaje que las métricas del escritorio, reducido a lo que se lee
// desde el sofá — sin tarjeta, sin icono, sin adorno.
const YearFigure = ({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}): React.JSX.Element => (
  <span className="flex items-baseline gap-[0.3em]">
    <span className="text-[1.35em] font-extrabold tabular-nums" style={{ color }}>
      {value}
    </span>
    <span className="text-[0.65em] font-semibold text-muted-foreground">{label}</span>
  </span>
);

// Pasar página también con el ratón (y como affordance visible de que HAY
// más páginas): flechas enfocables en los bordes. El mando ni las necesita
// (LB/RB), pero verlas dice "esto es un libro". Flotan despacio — piezas
// vivas, no cromo muerto — y al enfocarse se encienden en violeta con el
// anillo respirando. El wrapper estático hace el centrado vertical porque
// el float anima `translate` y pisaría un -translate-y-1/2 en el botón.
const PageArrow = ({
  side,
  disabled,
  onSelect,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onSelect: () => void;
}): React.JSX.Element | null => {
  const { ref, focused } = useTvFocusable({ onSelect, disabled });
  if (disabled) return null;
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <span
      className={`absolute top-1/2 z-10 -translate-y-1/2 ${side === 'left' ? 'left-[0.2em]' : 'right-[0.2em]'}`}
    >
      <button
        ref={ref}
        type="button"
        onClick={onSelect}
        // Sin el confirmar genérico: pasar página ya trae su propio swish
        // (turnPage), y confirmar + swish a la vez era una pila de sonidos.
        data-tv-sound="none"
        aria-label={side === 'left' ? 'Previous page' : 'Next page'}
        className="afterplay-tv-float relative flex h-[2.2em] w-[2.2em] items-center justify-center overflow-hidden rounded-full transition-[background-color,box-shadow,opacity] duration-200"
        style={
          focused
            ? {
                background: 'rgba(124,134,200,.22)',
                boxShadow: `inset 0 0 0 1px ${VIOLET}59, 0 0 1.6em ${VIOLET}66, 0 0.4em 1em rgba(0,0,0,.4)`,
                opacity: 1,
              }
            : {
                background: 'rgba(0,0,0,.45)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)',
                opacity: 0.7,
              }
        }
      >
        {focused && (
          <>
            <span
              aria-hidden
              className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: `inset 0 0 0 2px ${VIOLET}` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
            >
              <span
                className="afterplay-tv-sheen absolute inset-y-0 left-0 w-[45%]"
                style={{
                  background:
                    'linear-gradient(105deg, transparent, rgba(255,255,255,.25), transparent)',
                }}
              />
            </span>
          </>
        )}
        {/* El chevron se asoma hacia su lado al recibir el foco — "por aquí". */}
        <span
          className="relative transition-[translate] duration-200"
          style={focused ? { translate: side === 'left' ? '-0.12em 0' : '0.12em 0' } : undefined}
        >
          <Icon className="h-[1.2em] w-[1.2em]" />
        </span>
      </button>
    </span>
  );
};

// El punto de libro del pie de cabecera: en vez de un "3 / 42" seco, una
// cinta fina que se dibuja hasta el punto exacto del libro en que estás,
// con el gradiente violeta→azul de la casa. Se remonta con cada página, así
// que el relleno se dibuja de nuevo en cada paso — feedback del gesto.
const PageRibbon = ({ current, total }: { current: number; total: number }): React.JSX.Element => (
  <span className="flex items-center gap-[0.55em]">
    <span className="relative h-[0.16em] w-[5.5em] overflow-hidden rounded-full bg-white/[0.08]">
      <span
        className="animate-in fade-in-0 slide-in-from-left-96 absolute inset-y-0 left-0 rounded-full duration-700"
        style={{
          width: `${(current / Math.max(total, 1)) * 100}%`,
          background: `linear-gradient(90deg, ${VIOLET}, ${BLUE})`,
          boxShadow: `0 0 0.5em ${VIOLET}8c`,
        }}
      />
    </span>
    <span className="text-[0.6em] font-bold text-muted-foreground/60 tabular-nums">
      {current} / {total}
    </span>
  </span>
);

export const TvJourney = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [] } = useGames();
  const { data: sessions = [] } = useSessions();
  const { data: stateEvents = [] } = useStateEvents();
  const { data: memories = [] } = useMemories();
  // La vuelta de una ficha reabre el libro POR LA MISMA PÁGINA
  // (screenMemory) — sin esto, cada vuelta te devolvía a la cubierta.
  const [restoredPage] = useState(recallJourneyPage);
  useEffect(() => {
    forgetJourneyPage();
  }, []);
  const [pageIndex, setPageIndex] = useState(restoredPage ?? 0);

  const recapByScope = useMemo(
    () =>
      new Map<string, GeneratedMemorySummary>(
        memories.map((memory) => [`${memory.scopeType}:${memory.scopeKey}`, memory]),
      ),
    [memories],
  );

  // Las mismas entradas y la misma agrupación año→mes (de nuevo a viejo, sin
  // meses futuros del año en curso) que el Journey de escritorio — solo que
  // aplanadas en una secuencia de PÁGINAS: [año, sus meses..., año, ...].
  const pages = useMemo<TvJourneyPage[]>(() => {
    const entries = buildEntries(games, sessions, stateEvents);
    const now = new Date();
    const grouped = new Map<number, Map<number, JourneyEntry[]>>();
    for (const entry of entries) {
      const year = entry.lastAt.getFullYear();
      const month = entry.lastAt.getMonth();
      if (year === now.getFullYear() && month > now.getMonth()) continue;
      if (year > now.getFullYear()) continue;
      const months = grouped.get(year) ?? new Map<number, JourneyEntry[]>();
      months.set(month, [...(months.get(month) ?? []), entry]);
      grouped.set(year, months);
    }

    const list: TvJourneyPage[] = [];
    // La cubierta abre el libro: totales de TODO lo agrupado (los mismos
    // filtros de arriba), con el año más antiguo como "desde".
    if (grouped.size > 0) {
      const everything = [...grouped.values()].flatMap((months) => [...months.values()].flat());
      list.push({
        kind: 'intro',
        years: grouped.size,
        games: new Set(everything.map((entry) => entry.gameId)).size,
        hours: everything.reduce((sum, entry) => sum + entry.hours, 0),
        firstYear: Math.min(...grouped.keys()),
      });
    }
    for (const [year, months] of [...grouped.entries()].sort(([a], [b]) => b - a)) {
      const yearEntries = [...months.values()].flat();
      // El juego del año y las veces que te sentaste — las dos cifras que
      // rematan la portada de capítulo sin convertirla en un panel de datos.
      const topEntry = yearEntries.reduce<JourneyEntry | null>(
        (best, entry) => (best === null || entry.hours > best.hours ? entry : best),
        null,
      );
      list.push({
        kind: 'year',
        year,
        games: new Set(yearEntries.map((entry) => entry.gameId)).size,
        hours: yearEntries.reduce((sum, entry) => sum + entry.hours, 0),
        sessionCount: sessions.filter(
          (session) => session.endedAt !== null && session.startedAt.getFullYear() === year,
        ).length,
        topGame:
          topEntry && topEntry.hours > 0 ? { title: topEntry.title, hours: topEntry.hours } : null,
        recap: recapByScope.get(`year:${year}`) ?? null,
      });
      for (const [month, monthEntries] of [...months.entries()].sort(([a], [b]) => b - a)) {
        list.push({
          kind: 'month',
          year,
          month,
          entries: monthEntries.sort((a, b) => b.hours - a.hours),
          hours: monthEntries.reduce((sum, entry) => sum + entry.hours, 0),
          recap: recapByScope.get(`month:${year}-${String(month + 1).padStart(2, '0')}`) ?? null,
        });
      }
    }
    return list;
  }, [games, sessions, stateEvents, recapByScope]);

  const clamp = (index: number): number => Math.max(0, Math.min(pages.length - 1, index));
  // El paso de página se decide FUERA del updater (los updaters son puros —
  // regla del compilador) para poder sonar el swish solo cuando la página
  // cambia de verdad: contra la tapa del libro, silencio.
  const turnPage = (step: number): void => {
    const next = clamp(clamp(pageIndex) + step);
    if (next === clamp(pageIndex)) return;
    tvSound.pageTurn();
    setPageIndex(next);
  };
  const jumpYear = (step: number): void => {
    const current = pages[clamp(pageIndex)];
    // Desde la cubierta no hay "año actual": RT aterriza en el primer
    // capítulo (findIndex da -1 y -1 + 1 = 0), LT se queda quieto.
    const currentYear = current && current.kind !== 'intro' ? current.year : undefined;
    const yearStarts = pages.flatMap((page, position) =>
      page.kind === 'year' ? [{ year: page.year, position }] : [],
    );
    const currentPos = yearStarts.findIndex((start) => start.year === currentYear);
    const target = yearStarts[currentPos + step];
    if (!target || target.position === clamp(pageIndex)) return;
    tvSound.pageTurn();
    setPageIndex(target.position);
  };

  useTvButtons({
    lb: () => turnPage(-1),
    rb: () => turnPage(1),
    lt: () => jumpYear(-1),
    rt: () => jumpYear(1),
  });
  useTvLegend([
    { action: 'lbrb', label: 'Page' },
    { action: 'ltrt', label: 'Year' },
  ]);

  const page = pages[clamp(pageIndex)];

  // El fondo del modo respira con el protagonista de la página (el juego con
  // más horas del mes). Las páginas de año no lo cambian: conservan el arte
  // del mes vecino y la portada de capítulo queda bañada por él.
  const featuredEntry = page?.kind === 'month' ? (page.entries[0] ?? null) : null;
  const featuredSrc = useImageSrc(featuredEntry?.heroUrl ?? null, 'heroes');
  useTvBackdrop(featuredSrc);
  // LA CUBIERTA ES LA NOCHE: al abrir el libro se despeja el arte y el
  // cielo de luciérnagas (el censo de tu biblioteca) sale a escena — es la
  // única pantalla donde el enjambre es el protagonista, y el epígrafe de
  // abajo cuenta por fin qué es.
  useTvSkyBackdrop(page?.kind === 'intro');

  if (!page) {
    return (
      <div className="afterplay-tv-pop flex h-full flex-col items-center justify-center text-center">
        <div className="text-[1em] font-extrabold">Your journey starts here</div>
        <div className="mt-[0.3em] text-[0.75em] text-muted-foreground">
          Played and logged games will become part of it.
        </div>
      </div>
    );
  }

  return (
    // key por página: cada paso remonta con su animación de entrada — el
    // page-turn 3D gira la página nueva desde el canto, como un libro de
    // verdad. Las flechas viven FUERA del key para no re-montarse (y perder
    // el foco del ratón) con cada paso.
    <div className="relative h-full">
      <PageArrow side="left" disabled={clamp(pageIndex) === 0} onSelect={() => turnPage(-1)} />
      <PageArrow
        side="right"
        disabled={clamp(pageIndex) >= pages.length - 1}
        onSelect={() => turnPage(1)}
      />
      <div
        key={pageIndex}
        className="afterplay-tv-page-turn relative flex h-full flex-col gap-[0.9em] px-[2.6em] pb-[1em]"
      >
        {/* El cuerpo del LIBRO: el canto del lomo a la izquierda y, si
            quedan páginas por delante, el taco de las que faltan asomando
            por la derecha. Viven dentro del key para girar con la página. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-[0.9em] left-[1.15em] w-px"
          style={{
            background:
              'linear-gradient(180deg, transparent, rgba(255,255,255,.12) 18%, rgba(255,255,255,.12) 82%, transparent)',
            boxShadow: '-0.4em 0 1.2em rgba(0,0,0,.35)',
          }}
        />
        {clamp(pageIndex) < pages.length - 1 && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-[1.5em] right-[1.05em] w-px bg-gradient-to-b from-transparent via-white/10 to-transparent"
          />
        )}
        {clamp(pageIndex) < pages.length - 2 && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-[2.1em] right-[0.85em] w-px bg-gradient-to-b from-transparent via-white/[0.06] to-transparent"
          />
        )}

        {/* La cabecera abre la cascada interna de la página: cabecera →
            recap → carátulas, cada bloque con su compás de retardo. La
            cubierta no la lleva: compone su portada entera ella sola. */}
        {page.kind !== 'intro' && (
          <div
            className={`flex flex-none items-baseline gap-[0.8em] ${tvRevealClass}`}
            style={tvRevealStyle(0)}
          >
            <TvScreenTitle
              label={
                page.kind === 'year' ? `${page.year}` : `${MONTH_NAMES[page.month]} ${page.year}`
              }
              accent={VIOLET}
            />
            <span className="text-[0.72em] font-semibold text-muted-foreground tabular-nums">
              {page.kind === 'year'
                ? `${page.games} ${page.games === 1 ? 'game' : 'games'} · ${formatHours(page.hours)}`
                : `${page.entries.length} ${page.entries.length === 1 ? 'playthrough' : 'playthroughs'} · ${formatHours(page.hours)}`}
            </span>
            <span className="h-px min-w-[2em] flex-1 self-center bg-gradient-to-r from-white/15 to-transparent" />
            <PageRibbon current={clamp(pageIndex) + 1} total={pages.length} />
          </div>
        )}

        {page.kind === 'intro' ? (
          // La CUBIERTA del libro — todo el texto es fijo, escrito aquí
          // mismo (el usuario lo pidió así: nada de IA en la portada). Solo
          // los números salen de la biblioteca.
          <div className="relative flex min-h-0 flex-1 flex-col justify-center gap-[0.9em]">
            {/* El velo de lectura: una piscina de oscuridad detrás del texto
                de la cubierta — sin él, el epígrafe se perdía entre las
                luciérnagas y el arte del fondo. Radial que muere a
                transparente: velo, no rectángulo. Va el primero y el resto
                del contenido es position:relative — los absolutos pintan
                encima de los estáticos digan lo que digan en el DOM. */}
            <span
              aria-hidden
              // El borde izquierdo se estira hasta el canto de la PANTALLA
              // (el clip del layout está ahí): donde el degradado aún tiene
              // cuerpo, el corte queda fuera de la vista. Los otros tres
              // bordes los cubre la elipse con tamaño EXPLÍCITO — sin él,
              // farthest-corner dejaba el canto izquierdo al ~70% de negro:
              // una costura vertical justo en el gutter.
              className="pointer-events-none absolute -inset-y-[1.2em] -right-[2.6em] -left-[calc(2.6em+4vw)]"
              style={{
                background:
                  'radial-gradient(ellipse 75% 58% at 28% 52%, rgba(8,10,9,.92), rgba(8,10,9,.6) 45%, transparent 80%)',
              }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute right-[0.5em] bottom-[0.3em] select-none"
            >
              <span className="afterplay-tv-float block">
                <span className="afterplay-tv-glow block text-white/[0.05]">
                  <BookOpen className="h-[9em] w-[9em]" strokeWidth={1} />
                </span>
              </span>
            </span>
            <div
              className={`relative text-[0.6em] font-extrabold tracking-[.34em] ${tvRevealClass}`}
              style={{ ...tvRevealStyle(0), color: `${VIOLET}d9` }}
            >
              AFTERPLAY · YOUR JOURNEY
            </div>
            <h1
              className={`relative max-w-[9em] text-[2.3em] leading-[1.05] font-extrabold tracking-[-.02em] ${tvRevealClass}`}
              style={tvRevealStyle(1)}
            >
              The Book of Your Games
            </h1>
            <span
              aria-hidden
              className={`relative block h-px w-[14em] overflow-hidden ${tvRevealClass}`}
              style={tvRevealStyle(2)}
            >
              <span
                className="animate-in fade-in-0 slide-in-from-left-96 block h-full w-full duration-1000"
                style={{
                  background: `linear-gradient(90deg, ${VIOLET}cc, ${VIOLET}33, transparent)`,
                }}
              />
            </span>
            <p
              className={`relative max-w-[36em] text-[0.8em] leading-relaxed text-foreground/85 ${tvRevealClass}`}
              style={tvRevealStyle(3)}
            >
              Every session left a line, and every finish closed a chapter. Since {page.firstYear}{' '}
              this library has been quietly writing itself — the long hauls, the quick detours, the
              games you came back to when nobody was looking. Turn the pages and walk it back.
            </p>
            <div
              className={`relative flex items-baseline gap-[1.4em] ${tvRevealClass}`}
              style={tvRevealStyle(4)}
            >
              {[
                { value: String(page.years), label: page.years === 1 ? 'year' : 'years' },
                { value: String(page.games), label: page.games === 1 ? 'game' : 'games' },
                { value: formatHours(page.hours), label: 'played' },
              ].map((stat) => (
                <div key={stat.label} className="flex items-baseline gap-[0.35em]">
                  <span className="text-[1.4em] font-extrabold tabular-nums">{stat.value}</span>
                  <span className="text-[0.6em] font-semibold tracking-[.14em] text-muted-foreground uppercase">
                    {stat.label}
                  </span>
                </div>
              ))}
            </div>
            {/* EL SECRETO, DICHO UNA VEZ: el cielo de la cubierta es el
                censo de la biblioteca (una luz por juego, la brasa de su
                estado) y nadie podía saberlo. Esta línea lo convierte de
                textura en detalle que cuentas a un amigo — y solo vive
                aquí, en la única pantalla donde el cielo está a escena. */}
            <div
              className={`relative flex items-center gap-[0.55em] text-[0.68em] font-semibold text-foreground/55 italic ${tvRevealClass}`}
              style={tvRevealStyle(5)}
            >
              <span
                aria-hidden
                className="afterplay-tv-glow h-[0.4em] w-[0.4em] flex-none rounded-full"
                style={{ background: '#edd39a', boxShadow: '0 0 0.7em #edd39acc' }}
              />
              Every light in this sky is a game in your library.
            </div>
            <div
              className={`relative text-[0.7em] font-semibold text-foreground/60 ${tvRevealClass}`}
              style={tvRevealStyle(6)}
            >
              Turn the page to begin →
            </div>
          </div>
        ) : page.kind === 'year' ? (
          <div className="relative flex min-h-0 flex-1 flex-col justify-center gap-[0.8em]">
            {/* La portada de capítulo: el año en filigrana gigante detrás,
                flotando apenas y respirando — solemne, no un póster muerto.
                Float y glow en spans anidados: ambas clases pisan la misma
                propiedad `animation` y en el mismo nodo una anularía a la
                otra. */}
            <span
              aria-hidden
              className="pointer-events-none absolute right-[0.2em] bottom-[0.1em] select-none"
            >
              <span className="afterplay-tv-float block">
                <span className="afterplay-tv-glow block text-[7em] leading-none font-extrabold tracking-[-.05em] text-white/[0.06]">
                  {page.year}
                </span>
              </span>
            </span>
            {/* La regla del capítulo se dibuja sola: la línea entra deslizando
                dentro de una máscara overflow-hidden — translate puro, nada
                que re-rasterice. */}
            <span
              aria-hidden
              className={`block h-px w-[12em] overflow-hidden ${tvRevealClass}`}
              style={tvRevealStyle(1)}
            >
              <span
                className="animate-in fade-in-0 slide-in-from-left-96 block h-full w-full duration-1000"
                style={{
                  background: `linear-gradient(90deg, ${VIOLET}cc, ${VIOLET}33, transparent)`,
                }}
              />
            </span>
            {/* EL AÑO EN NÚMEROS: las cifras que de verdad se leen desde el
                sofá — lo que jugaste, cuántos juegos y cuántas veces te
                sentaste. Salen de yearTotals, la MISMA función que usa la
                pantalla de Stats de escritorio (lib/statsTotals), para que
                nadie vea dos cifras distintas del mismo año. */}
            <div
              className={`flex flex-none flex-wrap items-baseline gap-x-[1.6em] gap-y-[0.2em] ${tvRevealClass}`}
              style={tvRevealStyle(2)}
            >
              <YearFigure value={formatHours(page.hours)} label="played" color="#2fdc7e" />
              <YearFigure
                value={String(page.games)}
                label={page.games === 1 ? 'game' : 'games'}
                color="#85a3d6"
              />
              <YearFigure
                value={String(page.sessionCount)}
                label={page.sessionCount === 1 ? 'session' : 'sessions'}
                color={VIOLET}
              />
              {page.topGame && (
                <span className="text-[0.68em] font-semibold text-white/45">
                  most played · <span className="text-white/80">{page.topGame.title}</span>{' '}
                  <span className="text-[#2fdc7e]">{formatHours(page.topGame.hours)}</span>
                </span>
              )}
            </div>

            {page.recap ? (
              // El YearStory nace con el pop de paneles, un compás después de
              // la regla — la portada se compone delante de ti.
              <div className="afterplay-tv-pop flex-none" style={{ animationDelay: '140ms' }}>
                <RecapPanel recap={page.recap} eyebrow={`THE STORY OF ${page.year}`} />
              </div>
            ) : (
              <div
                className="afterplay-tv-pop flex-none text-[0.8em] text-muted-foreground"
                style={{ animationDelay: '140ms' }}
              >
                A year of play — its story has not been written yet.
              </div>
            )}

            {/* EL PULSO DEL AÑO: el mapa de días jugados. Es la pieza que
                convierte la portada de capítulo en un "año en revisión" — se
                lee de lejos y de un vistazo, que es justo lo que un sofá
                pide (los porcentajes y los desgloses se quedan en el
                escritorio, que es donde se estudian). */}
            <div
              className={`relative flex h-[11em] flex-none flex-col overflow-hidden rounded-[0.6em] bg-black/55 px-[0.9em] py-[0.65em] ${tvRevealClass}`}
              style={{
                ...tvRevealStyle(3),
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.07)',
              }}
            >
              <TvActivityHeatmap sessions={sessions} year={page.year} />
            </div>

            <div
              className={`flex-none text-[0.7em] font-semibold text-muted-foreground ${tvRevealClass}`}
              style={tvRevealStyle(4)}
            >
              Turn the page for the months →
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-[0.9em] overflow-y-auto pb-[0.5em]">
            {page.recap && (
              <div className={tvRevealClass} style={tvRevealStyle(1)}>
                <RecapPanel recap={page.recap} eyebrow="THE STORY" compact />
              </div>
            )}
            <div className="-mx-[0.5em] flex flex-wrap gap-[0.8em] px-[0.5em] pt-[0.5em] pb-[0.4em]">
              {page.entries.map((entry, index) => (
                <JourneyCoverTv
                  key={entry.key}
                  entry={entry}
                  autoFocus={index === 0}
                  revealIndex={index + 2}
                  onOpen={() => {
                    // Billete de vuelta: la ficha te devuelve a esta página.
                    rememberJourneyPage(clamp(pageIndex));
                    void navigate(`/tv/game/${entry.gameId}`);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
