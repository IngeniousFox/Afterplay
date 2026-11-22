import { cn } from '../../lib/utils';
import { CircleCheck } from 'lucide-react';
import type { GameListItem, StateEventSummary } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision, formatHours } from '../../lib/format';
import { STATUS_META } from '../../lib/gameStatus';
import { floatingPanelClass } from '../../lib/styles';
import { GameCover } from '../GameCover';
import { ChartHeading, StatCard } from './StatCard';
import { StatCardEmpty } from './StatCardEmpty';
import { StatsPager } from './StatsPager';
import { usePagedYear } from './usePagedYear';
import type { Year } from './YearPicker';
import { compareByCreation, type GameId } from '../../../../shared/entityIds';

type CompletedGalleryProps = {
  stateEvents: StateEventSummary[];
  games: GameListItem[];
  year: Year;
  onOpenGame: (gameId: GameId) => void;
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
  const { page, direction, goToPage } = usePagedYear(year);

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
    .sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || compareByCreation(b.id, a.id),
    );

  // Acotada, no confiada al estado: borrar eventos puede dejar `page` fuera
  // de rango sin que ningún click lo haya pedido.
  const totalPages = Math.max(1, Math.ceil(completions.length / MAX_ENTRIES));
  const currentPage = Math.min(page, totalPages - 1);
  const shown = completions.slice(currentPage * MAX_ENTRIES, (currentPage + 1) * MAX_ENTRIES);
  const beatenColor = STATUS_META.beaten.color;

  return (
    <StatCard>
      <ChartHeading
        className="mb-4"
        title="Completed"
        right={
          <div className="flex items-center gap-2.5">
            {completions.length > 0 && (
              <span>
                <strong>{completions.length}</strong>{' '}
                {year === 'all' ? 'all time, newest first' : `in ${year}`}
              </span>
            )}
            <StatsPager
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={goToPage}
              prevLabel="Newer completions"
              nextLabel="Older completions"
            />
          </div>
        }
      />

      {shown.length === 0 ? (
        <StatCardEmpty>
          {year === 'all' ? 'Nothing completed yet.' : `Nothing completed in ${year}.`}
        </StatCardEmpty>
      ) : (
        // key={currentPage} fuerza a React a remontar el grid en cada
        // cambio de página — sin eso la animación de entrada no se
        // repetiría nunca (mismo nodo del DOM, nada que animar). El sentido
        // (slide-in-from-right al avanzar, -left al retroceder) sale de
        // `direction`, puesto por goToPage.
        <div
          key={currentPage}
          className={`grid grid-cols-8 gap-3 duration-300 motion-reduce:animate-none animate-in fade-in-0 ${
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
                  className={cn(
                    'afterplay-completed-button relative block w-full overflow-hidden rounded-sm outline-hidden',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor',
                    '[transition:transform_260ms_cubic-bezier(0.22,1,0.36,1),box-shadow_220ms_ease]',
                    '[&:is(:hover,:focus-visible)]:shadow-lift',
                    '[&:is(:hover,:focus-visible)]:[transform:translateY(-2px)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                  aria-label={`Open ${game.title}`}
                >
                  <GameCover
                    url={game.coverUrl}
                    className={cn(
                      'afterplay-completed-cover aspect-[2/3] w-full overflow-hidden rounded-sm border border-line',
                      '[transition:border-color_180ms_ease,filter_220ms_ease]',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:border-line-hover',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:[filter:saturate(1.12)_brightness(1.05)]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    iconSize={20}
                  />
                  <span
                    className={cn(
                      'afterplay-completed-wash pointer-events-none absolute inset-0 rounded-sm opacity-0',
                      'bg-[linear-gradient(180deg,transparent_58%,rgb(3_6_7/0.45))] [transition:opacity_220ms_ease]',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:opacity-100',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    aria-hidden="true"
                  />
                  <CircleCheck
                    size={12}
                    aria-hidden="true"
                    className={cn(
                      'afterplay-completed-mark absolute top-1.5 right-1.5 rounded-full bg-cabinet/80 p-px',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    style={{ color: beatenColor }}
                  />
                </button>
                <div className="mt-2 min-w-0">
                  <span className="block truncate text-small font-semibold text-bone">
                    {game.title}
                  </span>
                  <span className="block text-micro text-dust">
                    {event.occurredAt.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: year === 'all' ? 'numeric' : undefined,
                    })}
                  </span>
                </div>
                <div
                  className={cn(
                    'pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-48 -translate-x-1/2 flex-col gap-0.5',
                    'rounded-md border',
                    floatingPanelClass,
                    'px-3.25 py-2.75 text-micro',
                    'group-hover/completed:flex',
                  )}
                >
                  <span className="truncate text-small font-semibold text-bone">{game.title}</span>
                  <span style={{ color: beatenColor }}>
                    {event.iterationLabel} —{' '}
                    {formatByPrecision(event.occurredAt, event.datePrecision, timeFormat)}
                  </span>
                  {game.totalHours > 0 && (
                    <span className="text-dust">
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
