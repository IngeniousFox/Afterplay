import { Newspaper, RefreshCw } from 'lucide-react';
import { useCredentials } from '../../hooks/settings';
import { useRatingsStatus, useRefreshAllRatings } from '../../hooks/igdb';
import { TEAL } from '../../lib/colors';
import { SettingsCard } from './SettingsCard';

// Ajustes → Ratings: el "Refresh all" que pone al día las notas de crítica y
// jugadores (IGDB) de TODA la biblioteca de una vez. Existe sobre todo por
// los juegos dados de alta ANTES de que existieran las notas — nacieron sin
// ninguna, y pedirlas ficha a ficha con el botoncito de la card Details
// sería un peregrinaje. A diferencia de la pasada de logros (minutos, con
// progreso y botón de parar), esto son 1-2 peticiones por lotes y termina en
// segundos: un solo botón basta.
export const RatingsSection = (): React.JSX.Element => {
  const { data: creds } = useCredentials();
  const { data: status } = useRatingsStatus();
  const refresh = useRefreshAllRatings();

  // Las notas salen de IGDB, así que sin sus claves no hay nada que pedir —
  // mismo aviso-en-línea que Trivia con la de Anthropic.
  const hasKey = Boolean(creds?.twitchClientId && creds?.twitchClientSecret);

  const statusLine = ((): string | null => {
    if (refresh.isPending) return 'Refreshing ratings for your whole library…';
    if (!hasKey) return 'Add your IGDB keys in Connections to turn this on.';
    if (refresh.data) {
      const { withRatings, total, updated } = refresh.data;
      const skipped = total - updated;
      return `Done — ${withRatings} of ${total} games have ratings now.${
        skipped > 0 ? ` ${skipped} no longer in IGDB's catalog, kept as they were.` : ''
      }`;
    }
    if (!status) return null;
    const base = `${status.withRatings} of ${status.total} games have ratings.`;
    // Los nunca-preguntados son el motivo de que este botón exista: dilo.
    return status.neverChecked > 0
      ? `${base} ${status.neverChecked} added before ratings existed — refresh to fill them in.`
      : base;
  })();

  return (
    <SettingsCard
      layout="row"
      title="Ratings"
      description="Critic and player scores from IGDB, shown side by side in each game's Details — critics cover modern releases, players cover the classics. This refreshes every game in one go."
      textClassName="min-w-0 flex-1"
      extra={
        <>
          {statusLine && (
            <div
              className="mt-1 text-[11px] font-semibold"
              style={{ color: refresh.isPending ? TEAL : 'var(--muted-foreground)' }}
            >
              {statusLine}
            </div>
          )}
          {refresh.isError && (
            <div className="mt-1 text-[11px] font-semibold text-destructive">
              Couldn&apos;t refresh — {refresh.error.message}
            </div>
          )}
        </>
      }
      icon={Newspaper}
      color={TEAL}
    >
      <button
        type="button"
        onClick={() => refresh.mutate()}
        disabled={!hasKey || refresh.isPending}
        className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : undefined} />
        {refresh.isPending ? 'Refreshing…' : 'Refresh all'}
      </button>
    </SettingsCard>
  );
};
