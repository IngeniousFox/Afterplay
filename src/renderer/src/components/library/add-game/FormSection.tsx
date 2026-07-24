import type { LucideIcon } from 'lucide-react';

type FormSectionProps = {
  icon: LucideIcon;
  title: string;
  color: string;
  children: React.ReactNode;
  // Para la entrada escalonada (revealClass/revealStyle) — el propio grupo
  // no sabe de eso, solo deja sitio para que quien lo monta se lo pegue.
  className?: string;
  style?: React.CSSProperties;
};

// Cabecera ligera para agrupar campos dentro de Add Game / Edit Game —
// chip de icono + etiqueta coloreada + una regla que se come el resto del
// ancho, mismo espíritu que el "GENRES"/"INSTALLED AT" de DetailsCard pero
// con icono y color propios por grupo. A propósito NO es una card con
// borde: varios de los grupos ya contienen sus propias cajas (CheckboxRow,
// PlayedBeforePanel...) y una caja más alrededor las anidaría dos veces.
export const FormSection = ({
  icon: Icon,
  title,
  color,
  children,
  className,
  style,
}: FormSectionProps): React.JSX.Element => (
  <div className={`flex flex-col gap-3.5 ${className ?? ''}`} style={style}>
    <div className="flex items-center gap-2">
      <div
        className="flex h-5 w-5 flex-none items-center justify-center rounded-[6px]"
        style={{ background: `${color}1f` }}
      >
        <Icon size={11} style={{ color }} />
      </div>
      <span className="text-[11px] font-bold tracking-[.09em] whitespace-nowrap" style={{ color }}>
        {title.toUpperCase()}
      </span>
      <div className="h-px flex-1 rounded-full" style={{ background: `${color}26` }} />
    </div>
    {children}
  </div>
);
