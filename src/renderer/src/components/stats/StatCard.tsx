import { cn } from '../../lib/utils';
import type { CSSProperties } from 'react';

type StatCardProps = {
  // Título estándar de card (Barlow semibold 16 px, Bone) — cada sitio aporta
  // su propio margen inferior (o ninguno) vía titleClassName.
  title?: string;
  titleClassName?: string;
  // Extras del wrapper por sitio: 'flex h-full flex-col' (estirarse a la
  // altura de la rejilla) o el overflow de cada card.
  className?: string;
  style?: CSSProperties;
  children: React.ReactNode;
};

// Panel de Fósforo para Stats: Panel sobre Cabinet, borde Line, radio de
// panel (8 px). Al pasar el ratón solo se aviva el borde: el énfasis lo ponen
// las cifras y la serie activa, no la caja.
export const StatCard = ({
  title,
  titleClassName = '',
  className = '',
  style,
  children,
}: StatCardProps): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-stat-card relative isolate rounded-md border border-line bg-panel px-5.5 py-5',
      'transition-[border-color] duration-200 hover:border-line-strong',
      className,
    )}
    style={style}
  >
    {title !== undefined && (
      <div className={cn('text-[16px] leading-tight font-semibold text-bone', titleClassName)}>
        {title}
      </div>
    )}
    {children}
  </div>
);

// Cabecera común de las gráficas: título a la izquierda y, a la derecha, el
// subtítulo o el dato que resume la card. Sin iconos ni eyebrows: el título
// basta. Los nombres de clase son contrato de los e2e de legibilidad.
export const ChartHeading = ({
  title,
  subtitle,
  right,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-chart-heading flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1',
      className,
    )}
  >
    <div className="afterplay-chart-heading-copy flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <strong className="block text-[16px] leading-tight font-semibold text-bone">{title}</strong>
      {subtitle != null && <small className="block text-small text-dust">{subtitle}</small>}
    </div>
    {right != null && (
      <div
        className={cn(
          'afterplay-chart-total text-right text-small text-dust tabular-nums',
          '[&_strong]:font-semibold [&_strong]:text-bone [&_small]:ml-1 [&_small]:text-small [&_small]:text-dust',
          '[&_em]:font-semibold [&_em]:text-phosphor [&_em]:not-italic',
        )}
      >
        {right}
      </div>
    )}
  </div>
);
