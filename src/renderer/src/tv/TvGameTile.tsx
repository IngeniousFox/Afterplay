import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { GameListItem } from '../../../shared/types';
import { formatHours } from '../lib/format';
import { statusKeyOf } from '../lib/gameFilters';
import { STATUS_META } from '../lib/gameStatus';
import { useTvFocusable } from './focusContext';
import { tvFocusHalo, tvFocusMotion, tvFocusScale, tvRevealClass, tvRevealStyle } from './styles';
import { TvCoverArt, TvLed } from './tvUi';

// La portada del modo TV en Fósforo (tvpwa-tv-library.png): 3:4, radio 4, LED
// de estado en la esquina y franja de horas al pie. El foco es el del sistema
// a 10 pies: borde Phosphor de 4 px, halo ámbar y escala 1.06 con muelle
// (sin escala con reduced motion), y un reflejo que la cruza cada pocos
// segundos mientras siga enfocada.
//
// EL TÍTULO VA EN EL FLUJO, DEBAJO, y fuera de lo que escala: así nunca se
// monta sobre la fila de abajo (el fallo del concepto, donde la etiqueta de
// la portada enfocada pisaba la fila siguiente). El margen de arriba es
// mayor que lo que crece la portada al escalar.
export const TvGameTile = ({
  game,
  onOpen,
  autoFocus = false,
  fill = false,
  disabled = false,
  revealIndex,
  onFocusSpot,
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
  // la carátula aparece sin animación (para listas que se refiltran en vivo).
  revealIndex?: number;
  // La pantalla que quiera repintar su fondo con el juego SEÑALADO se
  // suscribe aquí — se dispara al ganar el foco.
  onFocusSpot?: () => void;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect: onOpen, autoFocus, disabled });
  const status = statusKeyOf(game);
  // Ref-asentado para no re-disparar por identidad del callback (la misma
  // doctrina que onSelect en useTvFocusable).
  const onFocusSpotRef = useRef(onFocusSpot);
  useEffect(() => {
    onFocusSpotRef.current = onFocusSpot;
  });
  useEffect(() => {
    if (focused) onFocusSpotRef.current?.();
  }, [focused]);

  const strip = game.isLive
    ? 'Playing now'
    : game.totalHours > 0
      ? formatHours(game.totalHours)
      : STATUS_META[status].label;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`${game.title}. ${STATUS_META[status].label}. ${strip}`}
      className={cn(
        // scroll-my: el conductor de scroll respeta scroll-margin, así que al
        // enfocar una fila también se ve entero el título de debajo.
        'group relative block flex-none scroll-my-[1.2em] text-left outline-hidden',
        fill ? 'w-full' : 'w-[7.2em]',
        revealIndex !== undefined && tvRevealClass,
        focused && 'z-[2]',
      )}
      style={revealIndex !== undefined ? tvRevealStyle(revealIndex) : undefined}
    >
      <span
        // La geometría que usan la estela y la chispa (focusFx): la portada,
        // no la portada más el título.
        data-tv-fx-ring
        className={cn(
          'relative block rounded-sm ring-1 ring-line',
          tvFocusMotion,
          focused && ['ring-4 ring-phosphor', tvFocusHalo, tvFocusScale],
        )}
      >
        <TvCoverArt game={game} />
        {/* El reflejo que cruza la portada enfocada cada pocos segundos
            mientras siga enfocada (styles.ts: TV_SHEEN_*). Solo existe en la
            enfocada: un único bucle en pantalla. Sin él con reduced motion. */}
        {focused && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm motion-reduce:hidden"
          >
            <span className="absolute inset-y-0 left-0 w-[40%] animate-[afterplay-tv-sheen_var(--tv-sheen-period)_linear_var(--tv-sheen-delay)_infinite_both] bg-[linear-gradient(90deg,transparent,rgb(255_244_222/0.34),transparent)] mix-blend-screen" />
          </span>
        )}
        {game.isLive ? (
          <span
            aria-hidden
            className="absolute top-[0.4em] right-[0.4em] flex size-[0.6em] items-center justify-center"
          >
            <span className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden" />
            <span className="relative size-[0.6em] rounded-full bg-live ring-[0.14em] ring-cabinet" />
          </span>
        ) : (
          <TvLed
            status={status}
            className="absolute top-[0.4em] right-[0.4em] size-[0.6em] ring-[0.14em] ring-cabinet"
          />
        )}
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 flex h-[1.5em] items-center rounded-b-sm bg-cabinet/80 px-[0.45em] text-[0.88em] font-medium tabular-nums',
            game.isLive ? 'text-live' : 'text-bone',
          )}
        >
          {strip}
        </span>
      </span>
      <span
        className={cn(
          'mt-[0.7em] block text-[0.92em] leading-snug font-medium transition-colors duration-(--tv-focus-out)',
          focused ? 'font-semibold text-bone' : 'text-dust',
        )}
      >
        {game.title}
      </span>
    </button>
  );
};
