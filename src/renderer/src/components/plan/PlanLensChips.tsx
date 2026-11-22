import { cn } from '@/lib/utils';
import type { PlanLens } from '../../lib/plan';
import { PLAN_LENSES } from '../../lib/plan';
import { focusRing } from '../shell/controls';

type PlanLensChipsProps = {
  value: PlanLens;
  onChange: (lens: PlanLens) => void;
};

// Las LENTES (PLAN-TO-PLAY.md §2.4) — chips a la vista, no un desplegable de
// "ordenar por" enterrado en una esquina. Estos cuatro chips SON las preguntas
// ("tengo esta noche", "¿por qué sigue aquí?"), y verlas todas a la vez
// recuerda que se pueden hacer. La pregunta entera va en el title: en el chip
// los cuatro no cabrían en una línea.
export const PlanLensChips = ({ value, onChange }: PlanLensChipsProps): React.JSX.Element => (
  <div role="group" aria-label="Sort the queue" className="flex flex-wrap items-center gap-1.5">
    {PLAN_LENSES.map((lens) => {
      const active = lens.id === value;
      return (
        <button
          key={lens.id}
          type="button"
          onClick={() => onChange(lens.id)}
          aria-pressed={active}
          title={lens.question}
          className={cn(
            'flex h-7.5 items-center gap-1.5 rounded-sm border px-2.5 text-small font-semibold whitespace-nowrap',
            'transition-[color,border-color,background-color] duration-150 ease-out',
            focusRing,
            active
              ? 'border-phosphor/45 bg-phosphor-tint text-phosphor'
              : 'border-line bg-transparent text-dust hover:border-line-strong hover:text-bone',
          )}
        >
          <lens.Icon aria-hidden size={13} className="flex-none" />
          {lens.label}
        </button>
      );
    })}
  </div>
);
