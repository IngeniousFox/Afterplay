import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { GeneratedMemorySummary } from '../../../shared/types';
import type { JourneyEntrySummary } from '../../../shared/domain/journeyEntries';
import { groupEntriesByYearMonth } from '../../../shared/domain/journeyEntries';
import { useMemories } from '../hooks/memories';
import { useJourneyEntries, useSessionStats } from '../hooks/stats';
import { formatHours } from '../lib/format';
import type { StatusKey } from '../lib/gameStatus';
import { STATE_TO_STATUS_KEY, STATUS_META } from '../lib/gameStatus';
import { useImageSrc } from '../hooks/useImageSrc';
import { useTvBackdrop } from './backdropContext';
import { useTvButtons, useTvLegend } from './tvInput';
import { useTvFocusable } from './focusContext';
import { forgetJourneyPage, recallJourneyPage, rememberJourneyPage } from './screenMemory';
import { TvActivityHeatmap } from './TvActivityHeatmap';
import { tvSound } from './sound';
import {
  tvButtonHalo,
  tvFocusHalo,
  tvFocusMotion,
  tvFocusScale,
  tvLabelClass,
  tvPanelClass,
  tvRevealClass,
  tvRevealStyle,
} from './styles';
import { TvCoverArt, TvFigure, TvLed } from './tvUi';

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
      entries: JourneyEntrySummary[];
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

// La carátula del Journey TV: la misma portada de Fósforo que TvGameTile
// (LED, franja de horas, foco con borde Phosphor, halo y escala 1.06) y el
// título debajo, en el flujo, para que nunca pise nada.
const JourneyCoverTv = ({
  entry,
  autoFocus,
  revealIndex,
  onOpen,
}: {
  entry: JourneyEntrySummary;
  autoFocus: boolean;
  revealIndex: number;
  onOpen: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect: onOpen, autoFocus });
  const status: StatusKey = entry.state ? STATE_TO_STATUS_KEY[entry.state] : 'unplayed';
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className={cn(
        'w-[7.6em] flex-none text-left outline-hidden',
        tvRevealClass,
        focused && 'z-[2]',
      )}
      style={tvRevealStyle(revealIndex)}
    >
      <span
        className={cn(
          'relative block rounded-sm ring-1 ring-line',
          tvFocusMotion,
          focused && ['ring-4 ring-phosphor', tvFocusHalo, tvFocusScale],
        )}
      >
        <TvCoverArt game={entry} />
        <TvLed
          status={status}
          className="absolute top-[0.4em] right-[0.4em] size-[0.6em] ring-[0.14em] ring-cabinet"
        />
        <span className="absolute inset-x-0 bottom-0 flex h-[1.5em] items-center rounded-b-sm bg-cabinet/80 px-[0.45em] text-[0.88em] font-medium text-bone tabular-nums">
          {entry.hours > 0 ? formatHours(entry.hours) : STATUS_META[status].label}
        </span>
      </span>
      <span
        className={cn(
          'mt-[0.7em] block text-[0.92em] leading-snug font-medium',
          focused ? 'font-semibold text-bone' : 'text-dust',
        )}
      >
        {entry.title}
      </span>
    </button>
  );
};

// El recap del Loop como página del libro: panel plano con el filo Phosphor
// a la izquierda, el titular en Big Shoulders y el relato en Barlow.
const RecapPanel = ({
  recap,
  heading,
  compact = false,
}: {
  recap: GeneratedMemorySummary;
  heading: string;
  compact?: boolean;
}): React.JSX.Element => (
  <div className="rounded-md border border-l-[0.12em] border-line border-l-phosphor bg-panel px-[1.3em] py-[1em]">
    <div className={tvLabelClass}>{heading}</div>
    <div className="mt-[0.3em] font-display text-[1.7em] leading-tight font-bold text-bone">
      {recap.payload.headline}
    </div>
    <p className="mt-[0.35em] text-[1.08em] leading-relaxed text-bone">{recap.payload.narrative}</p>
    {!compact && recap.payload.highlights.length > 0 && (
      <div className="mt-[0.6em] flex flex-col gap-[0.3em]">
        {recap.payload.highlights.map((line) => (
          <div key={line} className="flex items-start gap-[0.55em] text-[1em] text-bone">
            <span className="mt-[0.5em] size-[0.35em] flex-none rounded-full bg-phosphor" />
            {line}
          </div>
        ))}
      </div>
    )}
    {!compact && recap.payload.closingLine.length > 0 && (
      <p className="mt-[0.6em] text-[1em] text-dust italic">{recap.payload.closingLine}</p>
    )}
  </div>
);

// Una cifra de página: número en Big Shoulders y la palabra debajo.
const PageFigure = ({
  value,
  label,
  hot = false,
  divided = false,
}: {
  value: string;
  label: string;
  hot?: boolean;
  divided?: boolean;
}): React.JSX.Element => (
  <div
    className={cn(
      'flex flex-col gap-[0.25em] pr-[1.2em]',
      divided && 'border-l border-line-strong pl-[1.2em]',
    )}
  >
    <TvFigure value={value} className={cn('text-[3em]', hot ? 'text-phosphor' : 'text-bone')} />
    <span className="text-[0.95em] text-dust">{label}</span>
  </div>
);

// Pasar página también con el ratón (y como affordance visible de que HAY
// más páginas): flechas redondas en los cantos del libro. La de la primera
// página no se pinta.
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
      className={cn(
        'absolute top-1/2 z-10 -translate-y-1/2',
        side === 'left' ? '-left-[0.4em]' : '-right-[0.4em]',
      )}
    >
      <button
        ref={ref}
        type="button"
        onClick={onSelect}
        // Sin el confirmar genérico: pasar página ya trae su propio swish
        // (turnPage), y confirmar + swish a la vez era una pila de sonidos.
        data-tv-sound="none"
        aria-label={side === 'left' ? 'Previous page' : 'Next page'}
        className={cn(
          'flex size-[2.6em] items-center justify-center rounded-full border border-line-strong bg-panel text-bone',
          tvFocusMotion,
          focused && ['border-phosphor text-phosphor', tvFocusScale, tvButtonHalo],
        )}
      >
        <Icon className="size-[1.2em]" />
      </button>
    </span>
  );
};

// El índice del año al pie de la página: las doce iniciales de mes, con punto
// en los meses que tienen página y el actual en Phosphor.
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const MonthIndex = ({
  year,
  activeMonths,
  current,
}: {
  year: number;
  activeMonths: Set<number>;
  current: number | null;
}): React.JSX.Element => (
  <div className="flex items-end gap-[1em]">
    <span className="font-display text-[1.6em] leading-none font-bold text-bone">{year}</span>
    <div className="flex items-end gap-[0.95em]">
      {MONTH_INITIALS.map((initial, month) => (
        <span key={month} className="flex flex-col items-center gap-[0.25em]">
          <span
            className={cn(
              'size-[0.4em] rounded-full',
              month === current
                ? 'bg-phosphor shadow-[0_0_8px_var(--color-phosphor)]'
                : activeMonths.has(month)
                  ? 'bg-dust'
                  : 'bg-raised',
            )}
          />
          <span
            className={cn(
              'text-[0.92em] leading-none',
              month === current ? 'font-semibold text-phosphor' : 'text-dust',
            )}
          >
            {initial}
          </span>
        </span>
      ))}
    </div>
  </div>
);

export const TvJourney = (): React.JSX.Element => {
  const navigate = useNavigate();
  // Las carátulas ya cocinadas por el main y el resumen de sesiones (F-41): esta
  // pantalla no recorre sesiones.
  const { data: journeyEntries = [] } = useJourneyEntries();
  const { data: sessionStats } = useSessionStats();
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
  // futuro) que el Journey de escritorio — literalmente la misma función
  // (groupEntriesByYearMonth), que es donde vive el recorte — solo que
  // aplanadas en una secuencia de PÁGINAS: [año, sus meses..., año, ...].
  const pages = useMemo<TvJourneyPage[]>(() => {
    const grouped = groupEntriesByYearMonth(journeyEntries);

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
      const topEntry = yearEntries.reduce<JourneyEntrySummary | null>(
        (best, entry) => (best === null || entry.hours > best.hours ? entry : best),
        null,
      );
      list.push({
        kind: 'year',
        year,
        games: new Set(yearEntries.map((entry) => entry.gameId)).size,
        hours: yearEntries.reduce((sum, entry) => sum + entry.hours, 0),
        // hasMeasuredDuration y no "endedAt !== null": el predicado de la casa
        // descarta además las sesiones manuales heredadas, que es lo que hacen
        // TODAS las gráficas de sesiones del escritorio. Contándolas, la
        // portada del año anunciaba veces-que-te-sentaste que en Stats no
        // existían.
        sessionCount: sessionStats?.lengthByYear.find((entry) => entry.year === year)?.total ?? 0,
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
  }, [journeyEntries, sessionStats, recapByScope]);

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

  if (!page) {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center text-center">
        <div className="font-display text-[2em] font-bold text-bone">Your journey starts here</div>
        <div className="mt-[0.3em] text-[1em] text-dust">
          Played and logged games will become part of it.
        </div>
      </div>
    );
  }

  const current = clamp(pageIndex);
  // El índice de meses del año de la página (cubierta: ninguno).
  const pageYear = page.kind === 'intro' ? null : page.year;
  const activeMonths = new Set(
    pages.flatMap((entry) =>
      entry.kind === 'month' && entry.year === pageYear ? [entry.month] : [],
    ),
  );

  return (
    // EL LIBRO (tvpwa-tv-notes-journey.png): el lomo a la izquierda, los
    // cantos de las páginas que quedan a la derecha y las flechas en los
    // bordes. key por página: cada paso remonta con su fundido de entrada
    // (sin giro 3D: el sistema no anima lo que el mando repite). Las flechas
    // viven FUERA del key para no re-montarse con cada paso.
    <div className="relative mx-[0.6em] h-full">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[0.4em] left-0 w-px bg-line-strong"
      />
      {current < pages.length - 1 && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-[0.8em] right-0 w-px bg-line-strong"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-[1.3em] -right-[0.3em] w-px bg-line"
          />
        </>
      )}
      <PageArrow side="left" disabled={current === 0} onSelect={() => turnPage(-1)} />
      <PageArrow side="right" disabled={current >= pages.length - 1} onSelect={() => turnPage(1)} />

      <div
        key={pageIndex}
        className="relative flex h-full animate-fade-in flex-col gap-[1.1em] px-[2.6em] pb-[0.6em]"
      >
        {page.kind !== 'intro' && (
          <div
            className={cn('flex flex-none items-end justify-between gap-[2em]', tvRevealClass)}
            style={tvRevealStyle(0)}
          >
            <h1 className="flex items-baseline gap-[0.3em] font-display font-bold text-bone">
              <span className="text-[5em] leading-[0.85]">
                {page.kind === 'year' ? page.year : MONTH_NAMES[page.month]}
              </span>
              {page.kind === 'month' && (
                <span className="text-[2.2em] leading-none text-dust">{page.year}</span>
              )}
            </h1>
            <div className="flex items-end">
              <PageFigure value={formatHours(page.hours)} label="played" hot />
              {page.kind === 'year' ? (
                <>
                  <PageFigure
                    value={String(page.games)}
                    label={page.games === 1 ? 'game' : 'games'}
                    divided
                  />
                  <PageFigure
                    value={String(page.sessionCount)}
                    label={page.sessionCount === 1 ? 'session' : 'sessions'}
                    divided
                  />
                </>
              ) : (
                <PageFigure
                  value={String(page.entries.length)}
                  label={page.entries.length === 1 ? 'game' : 'games'}
                  divided
                />
              )}
            </div>
          </div>
        )}

        {page.kind === 'intro' ? (
          // La CUBIERTA del libro — todo el texto es fijo, escrito aquí
          // mismo (nada de IA en la portada). Solo los números salen de la
          // biblioteca.
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-[1em]">
            <div className={cn(tvLabelClass, tvRevealClass)} style={tvRevealStyle(0)}>
              Your journey
            </div>
            <h1
              className={cn(
                'max-w-[10em] font-display text-[4.6em] leading-[0.92] font-bold text-bone',
                tvRevealClass,
              )}
              style={tvRevealStyle(1)}
            >
              The Book of Your Games
            </h1>
            <p
              className={cn('max-w-[38em] text-[1.08em] leading-relaxed text-bone', tvRevealClass)}
              style={tvRevealStyle(2)}
            >
              Every session left a line, and every finish closed a chapter. Since {page.firstYear}{' '}
              this library has been quietly writing itself — the long hauls, the quick detours, the
              games you came back to when nobody was looking. Turn the pages and walk it back.
            </p>
            <div className={cn('flex items-end', tvRevealClass)} style={tvRevealStyle(3)}>
              <PageFigure value={formatHours(page.hours)} label="played" hot />
              <PageFigure
                value={String(page.games)}
                label={page.games === 1 ? 'game' : 'games'}
                divided
              />
              <PageFigure
                value={String(page.years)}
                label={page.years === 1 ? 'year' : 'years'}
                divided
              />
            </div>
            {/* EL SECRETO, DICHO UNA VEZ: las motas que flotan detrás de
                todo el modo TV son el censo de tu biblioteca — una por juego,
                del color de su estado. */}
            <div
              className={cn('flex items-center gap-[0.55em] text-[1em] text-dust', tvRevealClass)}
              style={tvRevealStyle(4)}
            >
              <span aria-hidden className="size-[0.4em] flex-none rounded-full bg-phosphor" />
              Every light in this sky is a game in your library.
            </div>
            <div className={cn('text-[1em] text-dust', tvRevealClass)} style={tvRevealStyle(5)}>
              Turn the page to begin →
            </div>
          </div>
        ) : page.kind === 'year' ? (
          // La portada de capítulo: el juego del año, su historia y el mapa
          // de días jugados.
          <div className="flex min-h-0 flex-1 flex-col gap-[1em]">
            {page.topGame && (
              <div
                className={cn('text-[1.05em] text-dust', tvRevealClass)}
                style={tvRevealStyle(1)}
              >
                Most played · <span className="font-semibold text-bone">{page.topGame.title}</span>{' '}
                <span className="text-phosphor tabular-nums">
                  {formatHours(page.topGame.hours)}
                </span>
              </div>
            )}
            <div className={tvRevealClass} style={tvRevealStyle(2)}>
              {page.recap ? (
                <RecapPanel recap={page.recap} heading={`The story of ${page.year}`} />
              ) : (
                <div className="text-[1.05em] text-dust">
                  A year of play — its story has not been written yet.
                </div>
              )}
            </div>
            {/* EL PULSO DEL AÑO: el mapa de días jugados, que se lee de lejos
                y de un vistazo. */}
            <div
              className={cn(
                'flex h-[11.5em] flex-none flex-col overflow-hidden px-[1em] py-[0.8em]',
                tvPanelClass,
                tvRevealClass,
              )}
              style={tvRevealStyle(3)}
            >
              <TvActivityHeatmap year={page.year} />
            </div>
          </div>
        ) : (
          <div
            className="-mx-[1.2em] flex min-h-0 flex-1 flex-col gap-[1em] overflow-y-auto px-[1.2em] pb-[0.5em]"
            style={{ scrollbarWidth: 'none' }}
          >
            {page.recap && (
              <div className={tvRevealClass} style={tvRevealStyle(1)}>
                <RecapPanel
                  recap={page.recap}
                  heading={`The story of ${MONTH_NAMES[page.month]}`}
                  compact
                />
              </div>
            )}
            {/* Las carátulas por horas, con colchón para el foco (escala +
                halo) dentro del clip del scroll. */}
            <div className="flex flex-wrap items-start gap-[1em] pt-[0.8em]">
              {page.entries.map((entry, index) => (
                <JourneyCoverTv
                  key={entry.key}
                  entry={entry}
                  autoFocus={index === 0}
                  revealIndex={index + 2}
                  onOpen={() => {
                    // Billete de vuelta: la ficha te devuelve a esta página.
                    rememberJourneyPage(current);
                    void navigate(`/tv/game/${entry.gameId}`);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* El pie de la página: índice de meses del año y "Page N of M". */}
        <div className="flex flex-none items-end justify-between gap-[2em]">
          {pageYear !== null ? (
            <MonthIndex
              year={pageYear}
              activeMonths={activeMonths}
              current={page.kind === 'month' ? page.month : null}
            />
          ) : (
            <span />
          )}
          <span className="text-[0.95em] text-dust tabular-nums">
            Page {current + 1} of {pages.length}
          </span>
        </div>
      </div>
    </div>
  );
};
