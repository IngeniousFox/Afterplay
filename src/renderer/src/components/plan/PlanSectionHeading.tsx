import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

type PlanSectionHeadingProps = {
  Icon: LucideIcon;
  color: string;
  label: string;
  count: number;
  hint?: React.ReactNode;
  // Se pliegan el horizonte (no es accionable ahora mismo) y Up next (con la
  // estantería llena, tapa la cola). La cola no: plegar lo que has venido a
  // mirar no resuelve nada. Sin esto, la cabecera es un rótulo, no un botón.
  collapsible?: { open: boolean; onToggle: () => void };
  // Las lentes de la cola viven a la derecha de su propia cabecera.
  right?: React.ReactNode;
};

// Rótulo de cada sección del Plan. Diminuto y con mucho tracking a propósito
// —el mismo lenguaje que las etiquetas de las cards del detalle (GENRES,
// DEVELOPER)—: son separadores, no titulares. El H1 de la pantalla es uno
// solo, y las tres secciones cuelgan de él sin competirle.
export const PlanSectionHeading = ({
  Icon,
  color,
  label,
  count,
  hint,
  collapsible,
  right,
}: PlanSectionHeadingProps): React.JSX.Element => {
  const content = (
    <>
      <span
        className="flex h-6 w-6 flex-none items-center justify-center rounded-lg"
        style={{ background: `${color}1c`, border: `1px solid ${color}33` }}
      >
        <Icon size={12} style={{ color }} />
      </span>
      <span className="text-[11px] font-extrabold tracking-[.13em]" style={{ color }}>
        {label}
      </span>
      <span className="text-[11px] font-bold text-muted-foreground/70 tabular-nums">{count}</span>
      {hint && (
        <span className="truncate text-[11.5px] font-normal text-muted-foreground/60">{hint}</span>
      )}
      {collapsible && (
        <ChevronDown
          size={13}
          className="flex-none text-muted-foreground/60 transition-transform duration-200"
          style={{ transform: collapsible.open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      )}
    </>
  );

  return (
    <div className="mb-2.5 flex items-center justify-between gap-4">
      {collapsible ? (
        <button
          type="button"
          onClick={collapsible.onToggle}
          className="flex min-w-0 items-center gap-2 rounded-lg py-0.5 text-left"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{content}</div>
      )}
      {right}
    </div>
  );
};
