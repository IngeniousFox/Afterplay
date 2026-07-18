import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem, StateEventSummary } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision, formatHours } from '../../lib/format';
import { STATUS_META } from '../../lib/gameStatus';
import { floatingPanelClass } from '../../lib/styles';
import { GameCover } from '../GameCover';
import { StatCard } from './StatCard';
import type { Year } from './YearPicker';

type CompletedGalleryProps = {
  stateEvents: StateEventSummary[];
  games: GameListItem[];
  year: Year;
  onOpenGame: (gameId: number) => void;
};

// Una sola fila (grid-cols-8, ver el div de abajo) — ahora que la card ocupa
// el ancho entero de Stats.tsx (ya no comparte fila con Genre Spread), 8
// deja las carátulas más grandes que un grid-cols-10 sin llegar a los huecos
// de un grid-cols-6.
const MAX_ENTRIES = 8;

// Galería de completados ("muro de trofeos"): una carátula por cada evento
// 'completed' — un juego rejugado y completado dos veces sale dos veces, por
// eso el tooltip dice QUÉ playthrough se completó. Con "All Time" enseña los
// más recientes; con un año concreto, los completados ESE año, con flechas
// para pasar de página si no caben. Sustituye a la antigua tarjeta Top
// Played, que era un subconjunto de Most Played. El tooltip es el mismo
// panel flotante oscuro del Activity heatmap, pero en CSS puro (group-hover)
// — aquí no hace falta estado: un panel por carátula, anclado encima.
export const CompletedGallery = ({
  stateEvents,
  games,
  year,
  onOpenGame,
}: CompletedGalleryProps): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [page, setPage] = useState(0);
  // Sentido de la última navegación (1 = adelante/más antiguo, -1 = atrás/
  // más reciente) — decide de qué lado entra la animación de la página
  // nueva, para que se note hacia dónde te mueves y no sea un fade plano.
  const [direction, setDirection] = useState(1);
  // Cambiar de año reinicia la página — ajuste durante el render (mismo
  // patrón wasOpen de ChangeCoverModal), sin useEffect.
  const [prevYear, setPrevYear] = useState<Year>(year);
  if (prevYear !== year) {
    setPrevYear(year);
    setPage(0);
  }

  const goToPage = (next: number): void => {
    setDirection(next > page ? 1 : -1);
    setPage(next);
  };

  const gamesById = new Map(games.map((game) => [game.id, game]));

  const completions = stateEvents
    .filter(
      (event) =>
        event.type === 'completed' &&
        (year === 'all' || event.occurredAt.getFullYear() === year) &&
        // Un evento cuyo juego ya no está en la biblioteca (borrado entre
        // queries, o casos raros) no tiene carátula que enseñar.
        gamesById.has(event.gameId),
    )
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id);

  // Acotada, no confiada al estado: borrar eventos puede dejar `page` fuera
  // de rango sin que ningún click lo haya pedido.
  const totalPages = Math.max(1, Math.ceil(completions.length / MAX_ENTRIES));
  const currentPage = Math.min(page, totalPages - 1);
  const shown = completions.slice(currentPage * MAX_ENTRIES, (currentPage + 1) * MAX_ENTRIES);
  const beatenColor = STATUS_META.beaten.color;

  const pagerButtonClass =
    'flex h-5.5 w-5.5 items-center justify-center rounded-[6px] border border-input bg-white/[0.03] text-muted-foreground hover:text-foreground disabled:opacity-35 disabled:hover:text-muted-foreground';

  return (
    <StatCard>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[14px] font-bold text-foreground">Completed</div>
        <div className="flex items-center gap-2.5">
          {completions.length > 0 && (
            <div
              className="text-[11.5px] font-semibold tabular-nums"
              style={{ color: beatenColor }}
            >
              {completions.length} {year === 'all' ? 'all time' : `in ${year}`}
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 0}
                aria-label="Newer completions"
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
                aria-label="Older completions"
                className={pagerButtonClass}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {year === 'all' ? 'Nothing completed yet.' : `Nothing completed in ${year}.`}
        </p>
      ) : (
        // key={currentPage} fuerza a React a remontar el grid en cada
        // cambio de página — sin eso la animación de entrada no se
        // repetiría nunca (mismo nodo del DOM, nada que animar). El sentido
        // (slide-in-from-right al avanzar, -left al retroceder) sale de
        // `direction`, puesto por goToPage.
        <div
          key={currentPage}
          className={`grid grid-cols-8 gap-3 duration-300 animate-in fade-in-0 ${
            direction > 0 ? 'slide-in-from-right-3' : 'slide-in-from-left-3'
          }`}
        >
          {shown.map((event) => {
            const game = gamesById.get(event.gameId);
            if (!game) return null;
            return (
              <div key={event.id} className="group/completed relative">
                <button
                  type="button"
                  onClick={() => onOpenGame(game.id)}
                  className="block w-full transition-transform group-hover/completed:-translate-y-0.5"
                >
                  <GameCover
                    url={game.coverUrl}
                    className="aspect-[2/3] w-full overflow-hidden rounded-[8px] border border-border"
                    iconSize={20}
                  />
                </button>
                <div
                  className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-48 -translate-x-1/2 flex-col gap-0.5 rounded-[10px] border ${floatingPanelClass} px-3.25 py-2.75 text-[11.5px] group-hover/completed:flex`}
                >
                  <span className="truncate text-[12px] font-bold text-foreground">
                    {game.title}
                  </span>
                  <span style={{ color: beatenColor }}>
                    {event.iterationLabel} —{' '}
                    {formatByPrecision(event.occurredAt, event.datePrecision, timeFormat)}
                  </span>
                  {game.totalHours > 0 && (
                    <span className="text-muted-foreground">
                      {formatHours(game.totalHours)} played in total
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </StatCard>
  );
};
