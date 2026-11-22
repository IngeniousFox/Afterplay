import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonSize, secondaryButtonClass } from '../shell/controls';

type PagerProps = {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
};

// Paginador simple (Bloque 5A) — nada que pintar si todo cabe en una sola
// página. El número de página vive en el propio Sessions.tsx (no aquí):
// este componente es puramente presentacional.
export const Pager = ({ page, totalPages, onChange }: PagerProps): React.JSX.Element | null => {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-4">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className={cn(secondaryButtonClass, buttonSize.md)}
      >
        <ChevronLeft aria-hidden size={15} />
        Previous
      </button>
      <span className="text-small text-dust tabular-nums" aria-current="page">
        Page <span className="font-semibold text-bone">{page}</span> of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className={cn(secondaryButtonClass, buttonSize.md)}
      >
        Next
        <ChevronRight aria-hidden size={15} />
      </button>
    </nav>
  );
};
