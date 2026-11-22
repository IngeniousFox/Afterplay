import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { GameListItem } from '../../../shared/types';
import { useImageSrc } from '../hooks/useImageSrc';
import type { StatusKey } from '../lib/gameStatus';
import { useTvFocusable } from './focusContext';
import { tvButtonHalo, tvFocusMotion, tvFocusScale } from './styles';

// Los componentes compartidos del modo TV en Fósforo. Las clases y constantes
// del foco viven en styles.ts (módulo sin componentes, por Fast Refresh).

// ── Botones ────────────────────────────────────────────────────────────────

type TvButtonVariant = 'primary' | 'secondary' | 'danger';

const BUTTON_VARIANT: Record<TvButtonVariant, string> = {
  primary: 'bg-phosphor text-ink',
  secondary: 'border border-line-strong bg-raised text-bone',
  danger: 'bg-live text-ink-live',
};

export const TvButton = ({
  label,
  icon,
  variant = 'secondary',
  autoFocus = false,
  silent = false,
  className,
  onSelect,
  onFocusSpot,
  children,
}: {
  label?: string;
  icon?: React.ReactNode;
  variant?: TvButtonVariant;
  autoFocus?: boolean;
  // Para acciones cuya consecuencia ya suena sola (abrir un panel suena por
  // pushLayer; cerrar, por popLayer): el confirmar genérico encima sería doble.
  silent?: boolean;
  className?: string;
  onSelect: () => void;
  // Se dispara al ganar el foco (el Home repinta el fondo con él).
  onFocusSpot?: () => void;
  children?: React.ReactNode;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({ onSelect, autoFocus });
  const onFocusSpotRef = useRef(onFocusSpot);
  useEffect(() => {
    onFocusSpotRef.current = onFocusSpot;
  });
  useEffect(() => {
    if (focused) onFocusSpotRef.current?.();
  }, [focused]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      data-tv-sound={silent ? 'none' : undefined}
      data-tv-focused={focused ? 'true' : undefined}
      className={cn(
        'relative flex h-[2.5em] flex-none items-center justify-center gap-[0.5em] rounded-md px-[1.25em] text-[1.08em] font-semibold whitespace-nowrap',
        tvFocusMotion,
        BUTTON_VARIANT[variant],
        focused && [tvFocusScale, tvButtonHalo],
        className,
      )}
    >
      {icon}
      {label}
      {children}
    </button>
  );
};

// ── Cifras ─────────────────────────────────────────────────────────────────

// "38h 10m" → 38 h 10 m con la unidad a 0.45em en Dust (sistema, principio 7).
// Cualquier texto sin dígitos se pinta tal cual.
export const TvFigure = ({
  value,
  className,
  unitClassName,
}: {
  value: string;
  className?: string;
  unitClassName?: string;
}): React.JSX.Element => {
  const parts = value.match(/\d[\d.,:]*|[^\d]+/g) ?? [value];
  return (
    <span className={cn('font-display leading-none font-bold tabular-nums', className)}>
      {parts.map((part, index) =>
        /^\d/.test(part) ? (
          <span key={index}>{part}</span>
        ) : (
          <span key={index} className={cn('text-[0.45em] font-semibold text-dust', unitClassName)}>
            {part}
          </span>
        ),
      )}
    </span>
  );
};

// ── LED de estado ──────────────────────────────────────────────────────────

// El mismo reparto que el LED de escritorio (components/library/statusLed):
// cinco tonos, On Hold y Plan en hueco.
const LED_CLASS: Record<StatusKey, string> = {
  playing: 'bg-st-playing',
  on_hold: 'border-[0.14em] border-st-playing',
  beaten: 'bg-st-beaten',
  unplayed: 'bg-st-backlog',
  resting: 'bg-st-resting',
  dropped: 'bg-st-dropped',
  plan: 'border-[0.14em] border-st-backlog',
};

export const TvLed = ({
  status,
  className,
}: {
  status: StatusKey;
  className?: string;
}): React.JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'inline-block size-[0.55em] flex-none rounded-full',
      LED_CLASS[status],
      className,
    )}
  />
);

// ── Portada ────────────────────────────────────────────────────────────────

const initialsOf = (title: string): string =>
  title
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word[0] ?? ''))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

// La portada 3:4 del sistema: radio 4, arte o, sin carátula, la placa Raised
// con trama diagonal e iniciales en Big Shoulders (nunca un tono aleatorio).
export const TvCoverArt = ({
  game,
  className,
}: {
  game: Pick<GameListItem, 'title' | 'coverUrl'>;
  className?: string;
}): React.JSX.Element => {
  const src = useImageSrc(game.coverUrl, 'covers');
  return (
    <span
      className={cn('relative block aspect-3/4 overflow-hidden rounded-sm bg-raised', className)}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" className="block h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-[repeating-linear-gradient(135deg,transparent_0_12px,rgb(233_228_216/0.035)_12px_13px)] px-[0.4em] text-center font-display text-[2.4em] leading-none font-bold text-dust">
          {initialsOf(game.title)}
        </span>
      )}
    </span>
  );
};
