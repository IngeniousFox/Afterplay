import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { focusRing } from '../shell/controls';

type PlanSectionHeadingProps = {
  Icon: LucideIcon;
  // Clase de color del icono (literal, para que Tailwind la encuentre).
  iconClassName: string;
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

// Rótulo de cada sección del Plan, como las estanterías de Home: título en
// Lead semibold, recuento y una pista en Dust. El H1 de la pantalla es uno
// solo y las secciones cuelgan de él con h2.
export const PlanSectionHeading = ({
  Icon,
  iconClassName,
  label,
  count,
  hint,
  collapsible,
  right,
}: PlanSectionHeadingProps): React.JSX.Element => {
  const content = (
    <>
      <Icon aria-hidden size={15} className={cn('flex-none', iconClassName)} />
      <span className="text-lead font-semibold text-bone">{label}</span>
      <span className="text-small font-semibold text-dust tabular-nums">{count}</span>
      {hint && <span className="min-w-0 text-small text-dust">{hint}</span>}
      {collapsible && (
        <ChevronDown
          aria-hidden
          size={15}
          className={cn(
            'flex-none text-dust transition-transform duration-200 ease-out',
            collapsible.open && 'rotate-180',
          )}
        />
      )}
    </>
  );

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h2 className="min-w-0">
        {collapsible ? (
          <button
            type="button"
            onClick={collapsible.onToggle}
            aria-expanded={collapsible.open}
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm py-0.5 text-left',
              focusRing,
            )}
          >
            {content}
          </button>
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">{content}</span>
        )}
      </h2>
      {right}
    </div>
  );
};
