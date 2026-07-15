import { ChevronLeft, ChevronRight } from 'lucide-react';

type PagerProps = {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
};

const pagerButtonClass =
  'flex items-center gap-1.5 rounded-[9px] border border-input bg-white/[0.03] px-3.5 py-2 text-[13px] font-semibold text-foreground hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/[0.03]';

// Paginador simple (Bloque 5A) — nada que pintar si todo cabe en una sola
// página. El número de página vive en el propio Sessions.tsx (no aquí):
// este componente es puramente presentacional.
export const Pager = ({ page, totalPages, onChange }: PagerProps): React.JSX.Element | null => {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-6.5 flex items-center justify-center gap-4">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className={pagerButtonClass}
      >
        <ChevronLeft size={15} />
        Previous
      </button>
      <span className="text-[13px] text-muted-foreground tabular-nums">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className={pagerButtonClass}
      >
        Next
        <ChevronRight size={15} />
      </button>
    </div>
  );
};
