import { Play, RefreshCw, RotateCcw, Trophy } from 'lucide-react';
import { useState } from 'react';
import {
  useAchievementsActivity,
  useAchievementsStatus,
  useRetryFailedAchievements,
  useStopAchievements,
  useSyncAchievements,
  useToggleAchievementDemo,
} from '../../hooks/achievements';
import { AMBER, VIOLET } from '../../lib/colors';
import { revealClass, revealStyle } from '../../lib/styles';
import { SettingsCard } from './SettingsCard';

// Ajustes → Achievements: la pasada que trae de Steam el catálogo de logros
// de tus juegos y tus desbloqueos.
//
// A diferencia de las curiosidades (que se pagan UNA vez por juego en la
// vida), esto se puede repetir cuantas veces quieras: no cuesta dinero, solo
// peticiones a una API gratuita. Por eso el botón dice "Sync" y no "Generate",
// y por eso tiene botón de parar: una pasada de 300 juegos son varios minutos.
export const AchievementsSettingsSection = (): React.JSX.Element => {
  const { data: status } = useAchievementsStatus();
  const sync = useSyncAchievements();
  const stop = useStopAchievements();
  const retry = useRetryFailedAchievements();
  const progress = useAchievementsActivity();
  // ⚠️ TEMPORAL — estado del modo de prueba del aviso (ver el botón abajo).
  const demo = useToggleAchievementDemo();
  const [demoOn, setDemoOn] = useState(false);

  // El evento en vivo manda sobre la query: la pasada puede llevar minutos y
  // el status solo se refetchea con cada invalidación.
  const running = progress?.running ?? status?.running ?? false;
  const hasKey = status?.hasApiKey ?? false;
  const hasUserId = status?.hasUserId ?? false;

  const statusLine = ((): string | null => {
    if (running && progress) {
      const who = progress.currentTitle ? ` · ${progress.currentTitle}` : '';
      return `Syncing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${who}`;
    }
    if (!hasKey) return 'Add your Steam API key in API & Sync to turn this on.';
    if (!status) return null;
    // Los fallidos mandan sobre el resumen normal: es lo único que pide una
    // acción tuya, y decirlo con el conteo real (no con el del último evento)
    // hace que siga siendo cierto tras reabrir Ajustes.
    if (status.failedGames > 0) {
      return `${status.failedGames} game${status.failedGames === 1 ? '' : 's'} failed to sync — retry just those, no need to redo the rest.`;
    }

    const base = `${status.unlockedAchievements} of ${status.totalAchievements} achievements unlocked, across ${status.syncedGames} of ${status.eligibleGames} Steam games.`;
    // Sin SteamID hay catálogo pero cero desbloqueos — y un "0 de 4.000"
    // sin explicación parece un fallo en vez de una configuración a medias.
    return hasUserId ? base : `${base} Add your SteamID64 to read which ones you've unlocked.`;
  })();

  return (
    <SettingsCard
      layout="row"
      title="Achievements"
      description="Pulls each game's achievements from Steam and matches your unlocks against your play sessions — so a trophy becomes a moment in your history, not just a checkbox."
      textClassName="min-w-0 flex-1"
      extra={
        statusLine && (
          <div
            className="mt-1 text-[11px] font-semibold"
            style={{ color: running ? AMBER : 'var(--muted-foreground)' }}
          >
            {statusLine}
          </div>
        )
      }
      icon={Trophy}
      color={AMBER}
      className={revealClass}
      style={revealStyle(8)}
    >
      <div className="flex flex-none items-center gap-2">
        {/* ⚠️ TEMPORAL — enciende una ronda de avisos de prueba con logros
            reales de la biblioteca, para poder mirar la tarjeta flotante en
            distintos momentos sin ponerse a jugar. Quitar este botón (y su
            hook, su método de preload y su handler) cuando el diseño del
            aviso esté cerrado. */}
        <button
          type="button"
          onClick={() => demo.mutate(undefined, { onSuccess: setDemoOn })}
          title="Preview the in-game achievement popup"
          className="flex flex-none items-center gap-1.75 rounded-[9px] border px-3.25 py-2 text-[12.5px] font-semibold transition-colors duration-150"
          style={
            demoOn
              ? { borderColor: `${VIOLET}66`, color: VIOLET, background: `${VIOLET}14` }
              : {
                  borderColor: 'var(--input)',
                  color: 'var(--muted-foreground)',
                  background: 'rgba(255,255,255,.03)',
                }
          }
        >
          <Play size={13} />
          {demoOn ? 'Stop preview' : 'Preview'}
        </button>

        {/* Reintentar solo los fallidos: repetir los 300 y pico por 3 que
            fallaron es minutos de espera para nada. */}
        {!running && (status?.failedGames ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => retry.mutate()}
            className="flex flex-none items-center gap-1.75 rounded-[9px] border px-3.25 py-2 text-[12.5px] font-semibold transition-colors duration-150"
            style={{ borderColor: `${AMBER}55`, color: AMBER, background: `${AMBER}12` }}
          >
            <RotateCcw size={14} />
            Retry {status?.failedGames}
          </button>
        )}
        <button
          type="button"
          onClick={() => (running ? stop.mutate() : sync.mutate(true))}
          disabled={!hasKey}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : undefined} />
          {running ? 'Stop' : 'Sync now'}
        </button>
      </div>
    </SettingsCard>
  );
};
