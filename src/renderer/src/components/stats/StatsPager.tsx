import { ChevronLeft, ChevronRight } from 'lucide-react';

type StatsPagerProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (next: number) => void;
  prevLabel: string;
  nextLabel: string;
};

const pagerButtonClass =
  'flex h-5.5 w-5.5 items-center justify-center rounded-[6px] border border-input bg-white/[0.03] text-muted-foreground hover:text-foreground disabled:opacity-35 disabled:hover:text-muted-foreground';

// Flechas + contador de página — compartido por CompletedGallery y
// HltbCompareList (mismo pagerButtonClass, mismo layout). Se pinta a sí
// mismo como null con una sola página: cada caller ya no necesita su propio
// `{totalPages > 1 && (...)}`.
export const StatsPager = ({
  currentPage,
  totalPages,
  onPageChange,
  prevLabel,
  nextLabel,
}: StatsPagerProps): React.JSX.Element | null => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 0}
        aria-label={prevLabel}
        className={pagerButtonClass}
      >
        <ChevronLeft size={13} />
      </button>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {currentPage + 1}/{totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages - 1}
        aria-label={nextLabel}
        className={pagerButtonClass}
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
};
