import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GameListItem, StateEventSummary } from '../../../../shared/types';
import { formatHours } from '../../lib/format';
import { GameCover } from '../GameCover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { StatCard } from './StatCard';
import type { Year } from './YearPicker';

type CompareSession = {
  iterationId: number;
  durationSec: number | null;
};

type HltbCompareListProps = {
  games: GameListItem[];
  stateEvents: StateEventSummary[];
  // Para sumar las horas trackeadas del playthrough completado — las
  // sesiones ya vienen sin marcadores de borde (getAllSessions).
  sessions: CompareSession[];
  year: Year;
};

const MAX_ENTRIES = 6;

// La barra representa hasta 2× el Main Story: el marcador blanco al 50% ES
// el tiempo oficial de HLTB, así que quedarse a su izquierda = más rápido
// que la media, pasarlo = lo exprimiste. Ratios mayores de 2× saturan la
// barra (la etiqueta numérica sigue diciendo la verdad).
const BAR_SCALE = 2;

// Alto de una fila (carátula/pista h-12 = 3rem) + el gap-2 entre filas —
// fijan el alto del área de la lista a MAX_ENTRIES filas SIEMPRE, tengas 1
// completado o 6. Sin esto la card se encogía/crecía con el nº de datos y
// bailaba de tamaño en la grid junto a su vecina (Session length, que
// siempre pinta sus 5 tramos fijos).
const ROW_HEIGHT_PX = 48;
const ROW_GAP_PX = 8;
const LIST_MIN_HEIGHT_PX = ROW_HEIGHT_PX * MAX_ENTRIES + ROW_GAP_PX * (MAX_ENTRIES - 1);

// Verde de acento para quien despachó el juego por debajo del Main Story,
// ámbar de Beaten para quien lo pasó de largo (lo exprimió) — el mismo
// vocabulario de color del resto de Stats.
const FAST_COLOR = '#2fdc7e';
const SAVOR_COLOR = '#e3b24a';

const pagerButtonClass =
  'flex h-5.5 w-5.5 items-center justify-center rounded-[6px] border border-input bg-white/[0.03] text-muted-foreground hover:text-foreground disabled:opacity-35 disabled:hover:text-muted-foreground';

// Tus horas frente al Main Story de HowLongToBeat, solo en juegos
// completados (con año filtrado, completados ESE año). Las horas son las del
// ÚLTIMO playthrough completado del juego — no las totales de todos los
// playthroughs juntos: comparar la suma de tres partidas contra el tiempo de
// UNA pasada no decía nada (petición explícita: "mira solo el último
// Beaten"). Resueltas con la regla manual-reemplaza-trackeado de siempre.
// Ordenado por ratio descendente, con paginación (mismo patrón de
// Completed: flechas + deslizamiento sutil al cambiar de página).
export const HltbCompareList = ({
  games,
  stateEvents,
  sessions,
  year,
}: HltbCompareListProps): React.JSX.Element | null => {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState(1);
  // Cambiar de año reinicia la página — mismo ajuste-durante-el-render que
  // CompletedGallery (patrón wasOpen de ChangeCoverModal), sin useEffect.
  const [prevYear, setPrevYear] = useState<Year>(year);
  if (prevYear !== year) {
    setPrevYear(year);
    setPage(0);
  }

  const goToPage = (next: number): void => {
    setDirection(next > page ? 1 : -1);
    setPage(next);
  };

  const entries = useMemo(() => {
    // El ÚLTIMO evento 'completed' de cada juego dentro de la ventana — de
    // él sale qué playthrough se compara (desempate por id, como el resto
    // de la app).
    const lastCompletedByGame = new Map<number, StateEventSummary>();
    for (const event of stateEvents) {
      if (event.type !== 'completed') continue;
      if (year !== 'all' && event.occurredAt.getFullYear() !== year) continue;
      const current = lastCompletedByGame.get(event.gameId);
      if (
        !current ||
        event.occurredAt.getTime() > current.occurredAt.getTime() ||
        (event.occurredAt.getTime() === current.occurredAt.getTime() && event.id > current.id)
      ) {
        lastCompletedByGame.set(event.gameId, event);
      }
    }

    const trackedSecondsByIteration = new Map<number, number>();
    for (const session of sessions) {
      trackedSecondsByIteration.set(
        session.iterationId,
        (trackedSecondsByIteration.get(session.iterationId) ?? 0) + (session.durationSec ?? 0),
      );
    }

    return games
      .filter(
        (game) => lastCompletedByGame.has(game.id) && game.hltbMain !== null && game.hltbMain > 0,
      )
      .flatMap((game) => {
        const completed = lastCompletedByGame.get(game.id);
        if (!completed) return [];
        // Horas de ESE playthrough — manual reemplaza a trackeado, misma
        // regla que resolveIterationHours en el main.
        const manual = game.manualIterations.find(
          (iteration) => iteration.iterationId === completed.iterationId,
        );
        const hours =
          manual?.hours ?? (trackedSecondsByIteration.get(completed.iterationId) ?? 0) / 3600;
        if (hours <= 0) return [];
        return [
          {
            id: game.id,
            title: game.title,
            coverUrl: game.coverUrl,
            iterationLabel: completed.iterationLabel,
            hours,
            hltbMain: game.hltbMain as number,
            ratio: hours / (game.hltbMain as number),
          },
        ];
      })
      .sort((a, b) => b.ratio - a.ratio);
  }, [games, stateEvents, sessions, year]);

  // Acotada, no confiada al estado: filtrar a otro año puede dejar `page`
  // fuera de rango sin que ningún click lo haya pedido.
  const totalPages = Math.max(1, Math.ceil(entries.length / MAX_ENTRIES));
  const currentPage = Math.min(page, totalPages - 1);
  const shown = entries.slice(currentPage * MAX_ENTRIES, (currentPage + 1) * MAX_ENTRIES);

  // Mediana y no media: un único juego rejugado veinte veces no debe
  // arrastrar el "cómo juegas normalmente". Sobre TODAS las entradas, no
  // solo la página visible.
  const medianRatio = useMemo(() => {
    if (entries.length === 0) return null;
    const sorted = entries.map((entry) => entry.ratio).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }, [entries]);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="mb-4.5 flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-bold text-foreground">You vs HowLongToBeat</span>
          <Tooltip>
            <TooltipTrigger>
              <Info size={12} className="text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              Compares the hours of each game&apos;s LAST beaten playthrough (not the whole game)
              against HLTB&apos;s Main Story time. The white marker is the official time.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2.5">
          {medianRatio !== null && (
            <div className="text-[11.5px] text-muted-foreground">
              typically {medianRatio.toFixed(1)}× the Main Story
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
                aria-label="Previous games"
                className={pagerButtonClass}
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {currentPage + 1}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages - 1}
                aria-label="Next games"
                className={pagerButtonClass}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col" style={{ minHeight: LIST_MIN_HEIGHT_PX }}>
        {shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No completed games with HowLongToBeat data{year === 'all' ? '' : ` in ${year}`} yet.
          </p>
        ) : (
          // key={currentPage}: mismo remontado-para-animar que CompletedGallery.
          // justify-start (no -center): con pocas filas se quedan arriba, no
          // flotando a media altura de un hueco que ahora es fijo.
          <div
            key={currentPage}
            className={`flex flex-col justify-start gap-2 duration-300 animate-in fade-in-0 ${
              direction > 0 ? 'slide-in-from-right-3' : 'slide-in-from-left-3'
            }`}
          >
            {shown.map((entry) => {
              // Verde si te quedaste por debajo del Main Story, ámbar si lo
              // pasaste — el relleno y el ratio hablan el mismo color.
              const color = entry.ratio <= 1 ? FAST_COLOR : SAVOR_COLOR;
              return (
                <div key={entry.id} className="flex items-center gap-3">
                  <GameCover
                    url={entry.coverUrl}
                    className="h-12 w-9 flex-none overflow-hidden rounded-[6px] border border-border"
                    iconSize={15}
                  />
                  {/* La fila ES la barra (mismo estilo que Most Played): la
                      pista entera representa 2× el Main Story, el relleno
                      llega hasta tu ratio y la línea blanca del 50% ES el
                      tiempo oficial de HLTB. */}
                  <div className="relative h-12 flex-1 overflow-hidden rounded-[9px] bg-white/[0.03]">
                    <div
                      className="absolute inset-y-0 left-0"
                      style={{
                        width: `${Math.min(1, entry.ratio / BAR_SCALE) * 100}%`,
                        background: `linear-gradient(90deg, ${color}38, ${color}12)`,
                        borderRight: `2px solid ${color}b3`,
                      }}
                    />
                    {/* Marcador del Main Story oficial — al 50% por diseño. */}
                    <div className="absolute inset-y-1.5 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-white/45" />
                    <div className="relative z-1 flex h-full items-center justify-between gap-3 px-3.25">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-foreground">
                          {entry.title}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground tabular-nums">
                          {formatHours(entry.hours)} vs {formatHours(entry.hltbMain)} main
                        </div>
                      </div>
                      <span
                        className="flex-none rounded-md border border-white/10 bg-black/30 px-1.75 py-0.5 text-[12px] font-bold tabular-nums"
                        style={{ color }}
                      >
                        {entry.ratio.toFixed(1)}×
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </StatCard>
  );
};
