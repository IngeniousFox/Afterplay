import { CalendarDays, Check, Clock3, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResolveSessionEpilogue, useSessionEpilogue } from '../../hooks/sessionEpilogues';
import { useSetSessionNote } from '../../hooks/sessions';
import { useImageSrc } from '../../hooks/useImageSrc';
import { BLUE, GREEN } from '../../lib/colors';
import { formatHours } from '../../lib/format';
import {
  closeSessionEpilogueReview,
  getSessionEpilogueReview,
  subscribeSessionEpilogueReview,
} from '../../lib/sessionEpilogueReview';
import { accentGradientStyle } from '../../lib/styles';
import { useSyncExternalStore } from 'react';
import { GameCover } from '../GameCover';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';

const REFLECTION_TAGS = ['Relaxing', 'Intense', 'Progress', 'Memorable', 'Frustrating'] as const;

const formatDateTime = (date: Date): string =>
  date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const SessionEpilogueDialogHost = (): React.JSX.Element => {
  const epilogueId = useSyncExternalStore(
    subscribeSessionEpilogueReview,
    getSessionEpilogueReview,
    getSessionEpilogueReview,
  );
  const navigate = useNavigate();
  const { data: epilogue = null, isLoading, isError } = useSessionEpilogue(epilogueId);
  const resolveEpilogue = useResolveSessionEpilogue();
  const setSessionNote = useSetSessionNote();
  const heroSrc = useImageSrc(epilogue?.heroUrl ?? null, 'heroes');
  const [seenId, setSeenId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(false);

  if (epilogue && epilogue.id !== seenId) {
    setSeenId(epilogue.id);
    setNote(epilogue.note ?? '');
    setTags(epilogue.tags ?? []);
    setHighlight(epilogue.highlight);
  }

  const resolve = async (status: 'completed' | 'dismissed'): Promise<void> => {
    if (!epilogue || resolveEpilogue.isPending || setSessionNote.isPending) return;
    if (status === 'completed' && note.trim() !== (epilogue.note ?? '').trim()) {
      await setSessionNote.mutateAsync({ id: epilogue.sessionId, note: note.trim() });
    }
    await resolveEpilogue.mutateAsync({ id: epilogue.id, status, tags, highlight });
    closeSessionEpilogueReview();
  };

  const toggleTag = (tag: string): void => {
    setTags((current) =>
      current.includes(tag) ? current.filter((candidate) => candidate !== tag) : [...current, tag],
    );
  };

  return (
    <Dialog
      open={epilogueId !== null}
      onOpenChange={(open) => {
        if (!open && !resolveEpilogue.isPending) closeSessionEpilogueReview();
      }}
    >
      <DialogContent
        showCloseButton={!resolveEpilogue.isPending}
        className="w-full max-w-[620px] gap-0 overflow-hidden border border-input bg-[#121413] p-0"
      >
        {isLoading ? (
          <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
            Loading session…
          </div>
        ) : isError || !epilogue ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-2 text-center">
            <DialogTitle className="text-base font-extrabold text-foreground">
              Session unavailable
            </DialogTitle>
            <p className="text-sm text-muted-foreground">It may have been deleted.</p>
          </div>
        ) : (
          <>
            <div className="relative min-h-42 overflow-hidden border-b border-border">
              {heroSrc ? (
                <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 bg-white/[0.025]" />
              )}
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,14,13,.97),rgba(12,14,13,.82)_58%,rgba(12,14,13,.55)),linear-gradient(0deg,rgba(18,20,19,1),transparent_70%)]" />
              <div className="relative flex items-end gap-4 px-6 pt-7 pb-5">
                <GameCover
                  url={epilogue.coverUrl}
                  className="h-24 w-17 flex-none overflow-hidden rounded-[9px] border border-white/15 shadow-[0_12px_30px_rgba(0,0,0,.55)]"
                  iconSize={22}
                />
                <div className="min-w-0 pb-1">
                  <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-extrabold tracking-[.13em] text-primary">
                    <Check size={11} strokeWidth={2.5} />
                    SESSION COMPLETE
                  </div>
                  <DialogTitle className="truncate text-[22px] font-extrabold text-foreground">
                    {epilogue.gameTitle}
                  </DialogTitle>
                  <div className="mt-1.25 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                    <span>{epilogue.endless ? 'Endless game' : epilogue.iterationLabel}</span>
                    <span className="h-1 w-1 rounded-full bg-white/20" />
                    <span>{formatDateTime(epilogue.endedAt)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-5.5">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="border-r border-border pr-4">
                  <div className="flex items-center gap-1.5 text-[9px] font-bold tracking-[.11em] text-muted-foreground">
                    <Clock3 size={11} style={{ color: GREEN }} /> SESSION
                  </div>
                  <div
                    className="mt-1 text-[22px] font-extrabold tabular-nums"
                    style={{ color: GREEN }}
                  >
                    {formatHours(epilogue.durationSec / 3600)}
                  </div>
                </div>
                <div className="border-r border-border px-4">
                  <div className="flex items-center gap-1.5 text-[9px] font-bold tracking-[.11em] text-muted-foreground">
                    <CalendarDays size={11} style={{ color: BLUE }} /> TOTAL
                  </div>
                  <div
                    className="mt-1 text-[22px] font-extrabold tabular-nums"
                    style={{ color: BLUE }}
                  >
                    {formatHours(epilogue.totalHours)}
                  </div>
                </div>
                <div className="pl-4">
                  <div className="text-[9px] font-bold tracking-[.11em] text-muted-foreground">
                    STARTED
                  </div>
                  <div className="mt-1 text-[13px] font-extrabold text-foreground tabular-nums">
                    {formatDateTime(epilogue.startedAt)}
                  </div>
                </div>
              </div>

              {epilogue.moments.length > 0 && (
                <div className="mt-4 flex flex-col gap-1.5 border-y border-white/[0.07] py-3">
                  {epilogue.moments.map((moment) => (
                    <div
                      key={moment.key}
                      className="flex items-center gap-2 text-[12px] font-bold text-[#c8d7ef]"
                    >
                      <Sparkles size={13} className="flex-none text-[#85a3d6]" />
                      {moment.text}
                    </div>
                  ))}
                </div>
              )}

              <label className="mt-5 block">
                <span className="text-[10px] font-bold tracking-[.12em] text-muted-foreground">
                  WHAT HAPPENED?
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="Where did you leave off?"
                  className="mt-2 w-full resize-none rounded-[9px] border border-input bg-black/25 px-3.5 py-3 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
                />
              </label>

              <div className="mt-4">
                <div className="text-[10px] font-bold tracking-[.12em] text-muted-foreground">
                  THIS SESSION FELT
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {REFLECTION_TAGS.map((tag) => {
                    const selected = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className="rounded-full border px-3 py-1.25 text-[11.5px] font-semibold transition-colors duration-150"
                        style={
                          selected
                            ? { color: '#2fdc7e', borderColor: '#2fdc7e', background: '#2fdc7e14' }
                            : { color: 'var(--muted-foreground)', borderColor: 'var(--border)' }
                        }
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="mt-4 flex cursor-pointer items-center gap-2.5 border-t border-border pt-4">
                <input
                  type="checkbox"
                  checked={highlight}
                  onChange={(event) => setHighlight(event.target.checked)}
                  className="accent-primary"
                />
                <Sparkles size={14} className="text-[#85a3d6]" />
                <span className="text-[12.5px] font-semibold text-foreground">
                  Keep as a highlight
                </span>
              </label>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  closeSessionEpilogueReview();
                  navigate(`/games/${epilogue.gameId}`);
                }}
                className="text-[12.5px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Open game
              </button>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  disabled={resolveEpilogue.isPending}
                  onClick={() => void resolve('dismissed')}
                  className="rounded-[9px] border border-input bg-white/[0.03] px-4 py-2.25 text-[12.5px] font-semibold text-foreground hover:bg-white/[0.06]"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={resolveEpilogue.isPending || setSessionNote.isPending}
                  onClick={() => void resolve('completed')}
                  className="rounded-[9px] px-5 py-2.25 text-[12.5px] font-bold disabled:opacity-50"
                  style={accentGradientStyle}
                >
                  {resolveEpilogue.isPending || setSessionNote.isPending
                    ? 'Saving…'
                    : 'Save reflection'}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
