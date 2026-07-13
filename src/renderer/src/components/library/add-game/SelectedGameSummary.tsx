import type { IgdbSearchResult } from '../../../../../shared/types';
import { useHltbTimes } from '../../../hooks/hltb';
import { formatHours } from '../../../lib/format';
import { CoverThumb } from './CoverThumb';

type SelectedGameSummaryProps = {
  selected: IgdbSearchResult;
  onChangeSelection: () => void;
};

export const SelectedGameSummary = ({
  selected,
  onChangeSelection,
}: SelectedGameSummaryProps): React.JSX.Element => {
  const hltb = useHltbTimes(selected.title, selected.releaseYear);
  const hltbMainLabel =
    hltb.data?.hltbMain !== null && hltb.data?.hltbMain !== undefined
      ? formatHours(hltb.data.hltbMain)
      : null;

  return (
    <div className="mt-3.5 flex items-center gap-3.5 rounded-xl border border-input bg-white/[0.03] p-3">
      <div className="h-17.5 w-13 flex-none overflow-hidden rounded-lg border border-border bg-muted">
        <CoverThumb url={selected.coverUrl} alt="" className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15.5px] font-extrabold text-foreground">
          {selected.title}
        </div>
        <div className="mt-0.75 truncate text-[12.5px] text-muted-foreground">
          {[selected.releaseYear, selected.genres[0], selected.platforms.join(', ')]
            .filter(Boolean)
            .join(' · ')}
        </div>
        <div className="mt-1.25 text-xs text-muted-foreground">
          HowLongToBeat ·{' '}
          <span className="font-semibold text-foreground">{hltbMainLabel ?? '—'}</span> main story
        </div>
      </div>
      <button
        type="button"
        onClick={onChangeSelection}
        className="flex-none rounded-lg border border-border bg-white/[0.03] px-3 py-1.75 text-[12.5px] font-semibold text-foreground hover:bg-white/[0.06]"
      >
        Change
      </button>
    </div>
  );
};
