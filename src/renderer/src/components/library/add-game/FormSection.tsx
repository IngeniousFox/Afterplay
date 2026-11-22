import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type FormSectionProps = {
  icon: LucideIcon;
  title: string;
  // Se conserva por los consumidores; Fósforo ya no tiñe cada grupo de su
  // color (el color se reserva para estados y acciones).
  color?: string;
  // Algo junto al título: la etiqueta "On this PC" de Launch and install.
  extra?: React.ReactNode;
  children: React.ReactNode;
  // Para la entrada escalonada (revealClass/revealStyle) — el propio grupo
  // no sabe de eso, solo deja sitio para que quien lo monta se lo pegue.
  className?: string;
  style?: React.CSSProperties;
};

// Cabecera de un grupo de campos dentro de Add Game / Edit Game
// (ficha-editar.png): título de panel en Barlow semibold con su icono en Dust,
// sin caja alrededor — varios grupos ya contienen sus propias cajas
// (CheckboxRow, PlayedBeforePanel...) y otra más las anidaría dos veces.
export const FormSection = ({
  icon: Icon,
  title,
  extra,
  children,
  className,
  style,
}: FormSectionProps): React.JSX.Element => (
  <section className={cn('flex flex-col gap-3.5', className)} style={style}>
    <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-lead font-semibold text-bone">
      <Icon size={16} className="flex-none text-dust" />
      {title}
      {extra}
    </h3>
    {children}
  </section>
);
