import type { LucideIcon } from 'lucide-react';

type RatingChipProps = {
  Icon: LucideIcon;
  color: string;
  // Ya redondeado. El sufijo separa el "88 sobre 100" de IGDB del "97%" de
  // Steam — tres fuentes, tres etiquetas, nunca fundidas.
  value: number;
  suffix?: string;
  title: string;
};

// Chip de nota para las filas del Plan. Pequeño y denso a propósito: son tres
// números que tienen que poder compararse de un vistazo entre veinte filas sin
// robarle el sitio al título ni a la nota de por qué planeaste el juego. La
// fuente va en un icono de su color y entera en el title del hover.
export const RatingChip = ({
  Icon,
  color,
  value,
  suffix,
  title,
}: RatingChipProps): React.JSX.Element => (
  <span
    title={title}
    className="inline-flex flex-none items-center gap-1 rounded-sm border px-1.5 py-0.5 text-micro font-semibold tabular-nums"
    style={{ color, borderColor: `${color}40`, background: `${color}12` }}
  >
    <Icon aria-hidden size={11} className="flex-none" />
    {value}
    {suffix}
  </span>
);
