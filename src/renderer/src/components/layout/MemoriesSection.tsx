import { BookOpen, RefreshCw, Sparkles, Square } from 'lucide-react';
import {
  useMemoriesActivity,
  useMemoriesStatus,
  useRegenerateStaleMemories,
  useRunMemoriesBackfill,
  useStopMemories,
} from '../../hooks/memories';
import { useCredentials } from '../../hooks/settings';
import { VIOLET } from '../../lib/colors';
import { revealClass, revealStyle } from '../../lib/styles';
import { SettingsCard } from './SettingsCard';

// Ajustes → Your story (AFTERPLAY-LOOP.md §3.6): la tarjeta de los recaps,
// junto a la de curiosidades y con su misma gramática. Lo AUTOMÁTICO (el mes
// que acaba de cerrar) no necesita esta tarjeta para nada — aquí viven las
// decisiones que cuestan dinero y por eso son botones: el backfill del pasado
// histórico y regenerar lo que corregiste (§7.2). Nada se paga por sorpresa.

const buttonClass =
  'flex flex-none items-center justify-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50';

export const MemoriesSection = (): React.JSX.Element => {
  const { data: creds } = useCredentials();
  const { data: status } = useMemoriesStatus();
  const runBackfill = useRunMemoriesBackfill();
  const regenerateStale = useRegenerateStaleMemories();
  const stopQueue = useStopMemories();
  const progress = useMemoriesActivity();

  const hasKey = Boolean(creds?.anthropicApiKey);
  // El evento en vivo manda sobre la query: la pasada puede llevar minutos y
  // el status solo se refetchea con cada invalidación.
  const running = progress?.running ?? status?.running ?? false;
  const missing = status?.missing ?? 0;
  const stale = status?.stale ?? 0;

  const statusLine = ((): string | null => {
    if (running && progress) {
      const which = progress.currentLabel ? ` · ${progress.currentLabel}` : '';
      return `Writing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${which}`;
    }
    if (!hasKey) return 'Add your Anthropic key in API & Sync to turn this on.';
    if (progress && !progress.running && progress.failed > 0)
      return `Done — ${progress.failed} of ${progress.total} failed, they stay pending for the next run.`;
    if (!status) return null;
    if (missing === 0 && stale === 0) {
      return status.current > 0
        ? 'Every closed month and year has its story. New ones write themselves.'
        : 'When a month with play time closes, its story gets written on its own.';
    }
    const parts = [`${status.current} told`];
    if (missing > 0) parts.push(`${missing} waiting`);
    if (stale > 0) parts.push(`${stale} out of date`);
    return parts.join(' · ');
  })();

  return (
    <SettingsCard
      layout="row"
      title="Your story"
      description="Each month and year of your playing, told back to you in a few lines — written when the period closes and kept in your Journey."
      textClassName="min-w-0 flex-1"
      extra={
        <>
          {statusLine && (
            <div
              className="mt-1 text-[11px] font-semibold"
              style={{ color: running ? VIOLET : 'var(--muted-foreground)' }}
            >
              {statusLine}
            </div>
          )}
          {/* Ni runBackfill.isError ni regenerateStale.isError se miraban
              antes: un rechazo previo al primer evento de progreso volvía el
              botón a su reposo sin decir nada de lo que había pasado. */}
          {(runBackfill.error ?? regenerateStale.error) && (
            <div className="mt-1 text-[11px] font-semibold text-destructive">
              Couldn&apos;t start — {(runBackfill.error ?? regenerateStale.error)?.message}
            </div>
          )}
        </>
      }
      icon={BookOpen}
      color={VIOLET}
      className={revealClass}
      style={revealStyle(8)}
    >
      <div className="flex flex-none flex-col items-stretch gap-1.5">
        {running ? (
          <button type="button" onClick={() => stopQueue.mutate()} className={buttonClass}>
            <Square size={13} />
            Stop after this one
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => runBackfill.mutate()}
              disabled={!hasKey || missing === 0}
              className={buttonClass}
            >
              <Sparkles size={14} />
              {missing > 0 ? `Write ${missing} ${missing === 1 ? 'story' : 'stories'}` : 'Write'}
            </button>
            {stale > 0 && (
              <button
                type="button"
                onClick={() => regenerateStale.mutate()}
                disabled={!hasKey}
                className={buttonClass}
              >
                <RefreshCw size={13} />
                {`Refresh ${stale} outdated`}
              </button>
            )}
          </>
        )}
      </div>
    </SettingsCard>
  );
};
