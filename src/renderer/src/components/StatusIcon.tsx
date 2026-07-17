import type { GameStatusMeta } from '../lib/gameStatus';

type StatusIconProps = {
  meta: GameStatusMeta;
  size: number;
  strokeWidth?: number;
};

// El icono de estado relleno-o-no según STATUS_META, repetido en 8 sitios
// (GameCard, MiddleColumn, IterationSection, StatusCard x2, HistoryList,
// GameStats x2) — cada uno con su propio `size`.
export const StatusIcon = ({ meta, size, strokeWidth }: StatusIconProps): React.JSX.Element => (
  <meta.Icon
    size={size}
    color={meta.color}
    fill={meta.filled ? meta.color : 'none'}
    strokeWidth={strokeWidth}
  />
);
