import { Lightbulb, Sparkles } from 'lucide-react';
import {
  useCuriositiesActivity,
  useCuriositiesStatus,
  useRunCuriositiesBackfill,
} from '../../hooks/curiosities';
import { useCredentials } from '../../hooks/settings';
import { TEAL } from '../../lib/colors';
import { revealClass, revealStyle } from '../../lib/styles';
import { SettingsCard } from './SettingsCard';

// Ajustes → Game trivia: el botón que genera las curiosidades de los juegos
// que aún no tienen (los nuevos se generan solos al añadirlos). Es una
// operación de una vez —cada juego se paga UNA vez en la vida— y por eso es
// un botón y no algo de fondo: gastar la clave del usuario sin que lo pida no
// va con esta app.
export const TriviaSection = (): React.JSX.Element => {
  const { data: creds } = useCredentials();
  const { data: status } = useCuriositiesStatus();
  const runBackfill = useRunCuriositiesBackfill();
  const progress = useCuriositiesActivity();

  const hasKey = Boolean(creds?.anthropicApiKey);
  // El evento en vivo manda sobre la query: la pasada puede llevar minutos y
  // el status solo se refetchea con cada invalidación.
  const running = progress?.running ?? status?.running ?? false;
  const pending = status ? status.totalGames - status.generatedGames : 0;

  const statusLine = ((): string | null => {
    if (running && progress) {
      const who = progress.currentTitle ? ` · ${progress.currentTitle}` : '';
      return `Generating ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${who}`;
    }
    if (!hasKey) return 'Add your Anthropic key in API & Sync to turn this on.';
    if (status && pending === 0 && status.totalGames > 0)
      return 'Every game has its trivia already. New games get theirs on arrival.';
    if (progress && !progress.running && progress.failed > 0)
      return `Done — ${progress.failed} of ${progress.total} failed, they stay pending for the next run.`;
    if (status && pending > 0)
      return `${status.generatedGames} of ${status.totalGames} games have trivia so far.`;
    return null;
  })();

  return (
    <SettingsCard
      layout="row"
      title="Game trivia"
      description="Real stories about your games — written once from each game's Wikipedia article and mixed into ambient mode, next to your own memories."
      textClassName="min-w-0 flex-1"
      extra={
        <>
          {statusLine && (
            <div
              className="mt-1 text-[11px] font-semibold"
              style={{ color: running ? TEAL : 'var(--muted-foreground)' }}
            >
              {statusLine}
            </div>
          )}
          {/* Antes runBackfill.isError no se miraba en ningún sitio: un
              rechazo ANTES del primer evento de progreso (clave mala, sin
              red) devolvía el botón a su reposo con statusLine sin cambiar
              — parecía que el clic no había hecho nada. */}
          {runBackfill.isError && (
            <div className="mt-1 text-[11px] font-semibold text-destructive">
              Couldn&apos;t start — {runBackfill.error.message}
            </div>
          )}
        </>
      }
      icon={Lightbulb}
      color={TEAL}
      className={revealClass}
      style={revealStyle(7)}
    >
      <button
        type="button"
        onClick={() => runBackfill.mutate()}
        disabled={!hasKey || running || pending === 0}
        className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sparkles size={14} className={running ? 'animate-pulse' : undefined} />
        {running
          ? 'Generating…'
          : pending > 0
            ? `Generate for ${pending} game${pending === 1 ? '' : 's'}`
            : 'Generate'}
      </button>
    </SettingsCard>
  );
};
