import { ArrowRight, BookOpen } from 'lucide-react';
import { usePendingSessionEpilogues } from '../../hooks/sessionEpilogues';
import { formatHours } from '../../lib/format';
import { requestSessionEpilogueReview } from '../../lib/sessionEpilogueReview';
import { GameCover } from '../GameCover';

export const SessionEpiloguesSection = (): React.JSX.Element | null => {
  const { data: epilogues = [] } = usePendingSessionEpilogues();
  if (epilogues.length === 0) return null;

  return (
    <section className="mb-6.5 border-y border-[#85a3d633] py-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BookOpen size={14} className="text-[#85a3d6]" />
          <span className="text-[10px] font-extrabold tracking-[.13em] text-[#85a3d6]">
            SESSIONS TO REVISIT
          </span>
        </div>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
          {epilogues.length}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {epilogues.slice(0, 3).map((epilogue) => (
          <button
            key={epilogue.id}
            type="button"
            onClick={() => requestSessionEpilogueReview(epilogue.id)}
            className="group flex items-center gap-3 rounded-[9px] px-2 py-1.5 text-left hover:bg-white/[0.04]"
          >
            <GameCover
              url={epilogue.coverUrl}
              className="h-11 w-8 flex-none overflow-hidden rounded-[6px] border border-white/10"
              iconSize={12}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-bold text-foreground">
                {epilogue.gameTitle}
              </div>
              <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                {formatHours(epilogue.durationSec / 3600)} ·{' '}
                {epilogue.endedAt.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-bold text-[#85a3d6]">
              Review <ArrowRight size={12} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
