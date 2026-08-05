import { RefreshCw, RotateCcw, Trophy } from 'lucide-react';
import {
  useAchievementsActivity,
  useAchievementsStatus,
  useRetryFailedAchievements,
  useStopAchievements,
  useSyncAchievements,
} from '../../hooks/achievements';
import { AMBER } from '../../lib/colors';
import { SettingsCard } from './SettingsCard';

// Ajustes → Achievements: la pasada que trae el catálogo de logros de tus
// juegos y tus desbloqueos — de Steam (con los emuladores de cracks detrás)
// y de RetroAchievements para lo emulado retro.
//
// A diferencia de las curiosidades (que se pagan UNA vez por juego en la
// vida), esto se puede repetir cuantas veces quieras: no cuesta dinero, solo
// peticiones a APIs gratuitas. Por eso el botón dice "Sync" y no "Generate",
// y por eso tiene botón de parar: una pasada de 300 juegos son varios minutos.
export const AchievementsSettingsSection = (): React.JSX.Element => {
  const { data: status } = useAchievementsStatus();
  const sync = useSyncAchievements();
  const stop = useStopAchievements();
  const retry = useRetryFailedAchievements();
  const progress = useAchievementsActivity();

  // El evento en vivo manda sobre la query: la pasada puede llevar minutos y
  // el status solo se refetchea con cada invalidación.
  const running = progress?.running ?? status?.running ?? false;
  const hasKey = status?.hasApiKey ?? false;
  const hasUserId = status?.hasUserId ?? false;
  const hasRa = status?.hasRaCredentials ?? false;

  const statusLine = ((): string | null => {
    if (running && progress) {
      const who = progress.currentTitle ? ` · ${progress.currentTitle}` : '';
      return `Syncing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}${who}`;
    }
    // Con CUALQUIERA de las dos fuentes configuradas ya hay trabajo que
    // hacer; solo sin ninguna está esto de verdad apagado.
    if (!hasKey && !hasRa) {
      return 'Add your Steam API key or your RetroAchievements login in API & Sync to turn this on.';
    }
    if (!status) return null;
    // Los fallidos mandan sobre el resumen normal: es lo único que pide una
    // acción tuya, y decirlo con el conteo real (no con el del último evento)
    // hace que siga siendo cierto tras reabrir Ajustes.
    if (status.failedGames > 0) {
      return `${status.failedGames} game${status.failedGames === 1 ? '' : 's'} failed to sync — retry just those, no need to redo the rest.`;
    }

    // "games with achievements", sin apellido: el denominador ya suma Steam
    // Y RetroAchievements, y decir "Steam games" era mentir a medias.
    const base = `${status.unlockedAchievements} of ${status.totalAchievements} achievements unlocked, across ${status.syncedGames} of ${status.eligibleGames} games with achievements.`;
    // Sin SteamID hay catálogo pero cero desbloqueos de Steam — y un "0 de
    // 4.000" sin explicación parece un fallo en vez de configuración a medias.
    return !hasKey || hasUserId
      ? base
      : `${base} Add your SteamID64 to read which ones you've unlocked.`;
  })();

  return (
    <SettingsCard
      layout="row"
      title="Achievements"
      description="Pulls each game's achievements from Steam and RetroAchievements and matches your unlocks against your play sessions — so a trophy becomes a moment in your history, not just a checkbox."
      textClassName="min-w-0 flex-1"
      extra={
        <>
          {statusLine && (
            <div
              className="mt-1 text-[11px] font-semibold"
              style={{ color: running ? AMBER : 'var(--muted-foreground)' }}
            >
              {statusLine}
            </div>
          )}
          {/* Ni sync.isError ni retry.isError se miraban antes: un rechazo
              (clave revocada, sin red) antes del primer evento de progreso
              volvía el botón a su reposo sin dejar ni rastro de por qué. */}
          {(sync.error ?? retry.error) && (
            <div className="mt-1 text-[11px] font-semibold text-destructive">
              Couldn&apos;t start — {(sync.error ?? retry.error)?.message}
            </div>
          )}
        </>
      }
      icon={Trophy}
      color={AMBER}
    >
      <div className="flex flex-none items-center gap-2">
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
          disabled={!hasKey && !hasRa}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : undefined} />
          {running ? 'Stop' : 'Sync now'}
        </button>
      </div>
    </SettingsCard>
  );
};
