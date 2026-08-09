import { ChevronLeft, ChevronRight } from 'lucide-react';

type PagerProps = {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
};

// Paginador — nada que pintar si todo cabe en una sola página. Mismo texto
// que el del escritorio ("Page N of M"), con las dianas engordadas a 40px de
// alto porque aquí las pulsa un pulgar y no un ratón.
export const Pager = ({ page, totalPages, onChange }: PagerProps): React.JSX.Element | null => {
  if (totalPages <= 1) return null;

  const buttonClass =
    'flex items-center gap-1.5 rounded-[9px] border border-white/14 bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] font-semibold text-foreground disabled:opacity-40';

  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className={buttonClass}
      >
        <ChevronLeft size={15} />
        Previous
      </button>
      <span className="text-[12px] text-muted-foreground tabular-nums">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className={buttonClass}
      >
        Next
        <ChevronRight size={15} />
      </button>
    </div>
  );
};
