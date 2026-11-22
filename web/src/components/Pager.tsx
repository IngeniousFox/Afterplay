import { ChevronLeft, ChevronRight } from 'lucide-react';
import { secondaryButtonClass } from '../lib/styles';

type PagerProps = {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
};

// Paginador — nada que pintar si todo cabe en una sola página. Mismo texto
// que el del escritorio ("Page N of M"), con dianas de 44 px porque aquí las
// pulsa un pulgar y no un ratón.
export const Pager = ({ page, totalPages, onChange }: PagerProps): React.JSX.Element | null => {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className={secondaryButtonClass}
      >
        <ChevronLeft size={16} />
        Previous
      </button>
      <span className="text-small text-dust tabular-nums">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className={secondaryButtonClass}
      >
        Next
        <ChevronRight size={16} />
      </button>
    </div>
  );
};
