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

// Chip de nota para las filas del Plan. Deliberadamente MÁS PEQUEÑO y más
// denso que los tiles de la RatingsCard de la ficha: allí es EL dato de la
// pantalla y ocupa un tercio de la card; aquí son tres números que tienen que
// poder compararse de un vistazo entre veinte filas sin robarle el sitio al
// título ni a la nota de por qué planeaste el juego.
//
// El número va gordo y la fuente en un icono diminuto de su color, no en
// texto: escrito ("88 CRITICS") triplica el ancho del chip y en una fila
// estrecha eso significa que el tercero ya no cabe. El title del hover dice
// la fuente y la muestra completas para quien las quiera.
export const RatingChip = ({
  Icon,
  color,
  value,
  suffix,
  title,
}: RatingChipProps): React.JSX.Element => (
  <span
    title={title}
    className="inline-flex flex-none items-center gap-1 rounded-lg border px-1.75 py-0.75 text-[11.5px] font-extrabold tabular-nums"
    style={{ color, borderColor: `${color}3d`, background: `${color}14` }}
  >
    <Icon size={11} className="flex-none" />
    {value}
    {suffix}
  </span>
);
