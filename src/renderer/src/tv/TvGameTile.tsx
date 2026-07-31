import type { GameListItem } from '../../../shared/types';
import { GameCover } from '../components/GameCover';
import { formatHours } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import { useTvFocusable } from './focusContext';
import { tvRevealClass, tvRevealStyle } from './styles';

// La carátula del modo TV, rediseñada: el foco se dice con LUZ DENTRO del
// marco — anillo interior del color de estado respirando, barrido de brillo
// cruzando el arte, brightness que sube — y no con adornos que sobresalgan.
// La primera versión colgaba un anillo por FUERA del tile y los contenedores
// con scroll lo recortaban por los cuatro costados; todo lo que brilla vive
// ahora dentro del overflow-hidden, y FUERA del marco no hay nada — ni halo
// ni sombra de elevación (sobre el backdrop claro se veía como una mancha
// gris). Los paddings de parrillas y estanterías absorben solo el translate
// del foco.
//
// Sin escalar el arte: la lección Chromium de siempre — un <img> escalando
// en transición se ve borroso hasta asentarse. La vida la ponen la luz y el
// barrido, que son translate/opacity puros.
export const TvGameTile = ({
  game,
  onOpen,
  autoFocus = false,
  fill = false,
  disabled = false,
  revealIndex,
}: {
  game: GameListItem;
  onOpen: () => void;
  autoFocus?: boolean;
  // En estanterías la carátula fija su ancho; en la parrilla de Library lo
  // manda la celda del grid.
  fill?: boolean;
  // Para las celdas PLEGADAS de la parrilla líquida: fuera del motor de foco
  // mientras el filtro las oculta — ni navegables ni seleccionables.
  disabled?: boolean;
  // Puesto en la cascada de entrada de su pantalla (ver styles.ts) — sin él,
  // la carátula aparece sin animación (para listas que se refiltran en vivo,
  // donde re-animar cada letra marearía).
  revealIndex?: number;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect: onOpen, autoFocus, disabled });
  const status = getGameStatusMeta(game.currentState);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className={`group relative flex-none text-left transition-[translate] duration-200 ease-[cubic-bezier(.22,1,.36,1)] ${fill ? 'w-full' : 'w-[7.2em]'} ${revealIndex !== undefined ? tvRevealClass : ''}`}
      style={{
        ...(revealIndex !== undefined ? tvRevealStyle(revealIndex) : {}),
        ...(focused ? { translate: '0 -0.22em', zIndex: 2 } : {}),
      }}
    >
      <div
        className="relative overflow-hidden rounded-[0.55em] transition-[box-shadow,filter] duration-250"
        style={{
          // NADA fuera del marco: ni halo de color ni sombra de elevación —
          // sobre el backdrop claro la sombra negra difuminada se veía como
          // una mancha grisácea detrás de la carátula. La elevación la dan
          // el translate y el brightness; el color, el anillo interior.
          boxShadow: focused ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,.09)',
          filter: focused ? 'brightness(1.12)' : undefined,
        }}
      >
        <GameCover url={game.coverUrl} className="aspect-[264/374] w-full" iconSize={26} />
        {/* La franja de estado al pie de la carátula, como en Journey. */}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[0.18em] transition-opacity duration-200"
          style={{ background: status.color, opacity: focused ? 1 : 0.55 }}
        />
        {/* El anillo INTERIOR que respira — dentro del marco, jamás se
            recorta. Encima, el barrido de luz que cruza el arte una vez al
            recibir el foco. */}
        {focused && (
          <>
            <span
              aria-hidden
              className="afterplay-tv-ring pointer-events-none absolute inset-0 rounded-[0.55em]"
              style={{ boxShadow: `inset 0 0 0 3px ${status.color}` }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden rounded-[0.55em]"
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
      <div className="mt-[0.45em] px-[0.1em]">
        <div
          className="truncate text-[0.72em] font-bold transition-colors duration-150"
          style={{ color: focused ? 'var(--foreground)' : 'var(--muted-foreground)' }}
        >
          {game.title}
        </div>
        <div
          className="text-[0.62em] font-semibold tabular-nums transition-colors duration-150"
          style={{ color: focused ? status.color : 'rgba(136,143,138,.7)' }}
        >
          {game.totalHours > 0 ? formatHours(game.totalHours) : status.label}
        </div>
      </div>
    </button>
  );
};
