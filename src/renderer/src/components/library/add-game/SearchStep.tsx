import { ArrowRight, Search } from 'lucide-react';
import type { IgdbSearchResult } from '../../../../../shared/types';
import { CoverThumb } from './CoverThumb';

type SearchStepProps = {
  query: string;
  onQueryChange: (query: string) => void;
  isLoading: boolean;
  results: IgdbSearchResult[] | undefined;
  onSelect: (result: IgdbSearchResult) => void;
};

export const SearchStep = ({
  query,
  onQueryChange,
  isLoading,
  results,
  onSelect,
}: SearchStepProps): React.JSX.Element => (
  <>
    <div className="relative">
      <Search
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
      />
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search a game… (e.g. Sekiro)"
        className="w-full rounded-[10px] border border-input bg-white/[0.03] py-2.75 pr-3.5 pl-9.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>

    <div className="mt-3.5 flex flex-col gap-2">
      {isLoading && query.trim() ? (
        Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="flex animate-pulse items-center gap-3.25 rounded-[11px] border border-border p-2.75"
          >
            <div className="h-14 w-10.5 flex-none rounded-[7px] bg-white/[0.06]" />
            <div className="flex-1">
              <div className="h-3.5 w-2/3 rounded bg-white/[0.06]" />
              <div className="mt-2 h-3 w-1/3 rounded bg-white/[0.05]" />
            </div>
          </div>
        ))
      ) : query.trim() && results?.length === 0 ? (
        <div className="px-4 py-6.5 text-center text-[13px] text-muted-foreground">
          No games found in the catalog — try another title.
        </div>
      ) : (
        results?.map((result) => (
          <button
            key={result.igdbId}
            type="button"
            onClick={() => onSelect(result)}
            className="flex items-center gap-3.25 rounded-[11px] border border-border bg-white/[0.02] p-2.75 text-left hover:border-input hover:bg-white/[0.05]"
          >
            <div className="h-14 w-10.5 flex-none overflow-hidden rounded-[7px] border border-border bg-muted">
              <CoverThumb url={result.coverUrl} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-foreground">{result.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {[result.releaseYear, result.genres[0], result.platforms.join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <ArrowRight size={15} className="flex-none text-muted-foreground" />
          </button>
        ))
      )}
    </div>
  </>
);
