import { RefreshCw, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useAchievementsActivity,
  useAchievementsStatus,
  useRetryFailedAchievements,
  useStopAchievements,
  useSyncAchievements,
} from '../../hooks/achievements';
import { ACHIEVEMENT_SOURCE_LABEL } from '../../lib/achievementSources';
import { missingKeyHint } from '../../lib/settingsTabs';
import { buttonSize, primaryButtonClass, secondaryButtonClass } from '../shell/controls';
import { SettingsCard, StatusLine } from './SettingsCard';

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
      return missingKeyHint('Steam API key or your RetroAchievements login');
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

  // Las cifras de cada catálogo por separado (R-11): un 100 % de Steam y uno
  // de RetroAchievements son hitos distintos, y la suma de arriba no dice
  // cuántos juegos tienes completos en cada uno. Solo las fuentes con algún
  // juego sincronizado; con la pasada en marcha manda la línea de progreso.
  const sourceLines =
    status && !running
      ? (['steam', 'ra'] as const)
          .filter((source) => status.bySource[source].syncedGames > 0)
          .map((source) => {
            const numbers = status.bySource[source];
            const perfect = numbers.perfectGames > 0 ? ` · ${numbers.perfectGames} at 100%` : '';
            return {
              source,
              text: `${ACHIEVEMENT_SOURCE_LABEL[source]}: ${numbers.unlockedAchievements} of ${numbers.totalAchievements} in ${numbers.syncedGames} game${numbers.syncedGames === 1 ? '' : 's'}${perfect}`,
            };
          })
      : [];

  // Las tres cifras de cabecera (estados-ajustes-achievements.png): las
  // mismas que la línea de estado, en Big Shoulders. Solo con datos y sin la
  // pasada en marcha, que entonces manda la línea de progreso.
  const figures =
    status && !running && (hasKey || hasRa)
      ? [
          {
            value: status.syncedGames,
            label: `games synced of ${status.eligibleGames.toLocaleString()}`,
            accent: true,
          },
          { value: status.unlockedAchievements, label: 'achievements unlocked', accent: false },
          { value: status.failedGames, label: 'games failed', accent: false },
        ]
      : [];

  return (
    <SettingsCard
      title="Achievements"
      description="Pulls each game's achievements from Steam and RetroAchievements and matches your unlocks against your play sessions, so a trophy becomes a moment in your history, not just a checkbox."
      extra={
        <>
          {statusLine && <StatusLine tone={running ? 'active' : 'muted'}>{statusLine}</StatusLine>}
          {/* Ni sync.isError ni retry.isError se miraban antes: un rechazo
              (clave revocada, sin red) antes del primer evento de progreso
              volvía el botón a su reposo sin dejar ni rastro de por qué. */}
          {(sync.error ?? retry.error) && (
            <StatusLine tone="error">
              Couldn&apos;t start: {(sync.error ?? retry.error)?.message}
            </StatusLine>
          )}
        </>
      }
      action={
        <>
          {/* Reintentar solo los fallidos: repetir los 300 y pico por 3 que
              fallaron es minutos de espera para nada. */}
          {!running && (status?.failedGames ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => retry.mutate()}
              className={cn(
                secondaryButtonClass,
                buttonSize.md,
                'border-phosphor/60 text-phosphor hover:border-phosphor',
              )}
            >
              <RotateCcw aria-hidden size={15} />
              Retry {status?.failedGames}
            </button>
          )}
          <button
            type="button"
            onClick={() => (running ? stop.mutate() : sync.mutate(true))}
            disabled={!hasKey && !hasRa}
            className={cn(running ? secondaryButtonClass : primaryButtonClass, buttonSize.md)}
          >
            <RefreshCw
              aria-hidden
              size={15}
              className={cn(running && 'animate-spin motion-reduce:animate-none')}
            />
            {running ? 'Stop' : 'Sync now'}
          </button>
        </>
      }
      flush={figures.length > 0 || sourceLines.length > 0}
    >
      {(figures.length > 0 || sourceLines.length > 0) && (
        <>
          {figures.length > 0 && (
            <dl className="grid grid-cols-3">
              {figures.map((figure) => (
                <div
                  key={figure.label}
                  className="flex flex-col-reverse gap-1 border-l border-line px-5 py-4 first:border-l-0"
                >
                  <dt className="text-small text-dust">{figure.label}</dt>
                  <dd
                    className={cn(
                      'font-display text-title font-bold tabular-nums',
                      figure.accent ? 'text-phosphor' : 'text-bone',
                    )}
                  >
                    {figure.value.toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {/* Las cifras de cada catálogo por separado (R-11): un 100 % de
              Steam y uno de RetroAchievements son hitos distintos. */}
          {sourceLines.map((line) => (
            <div
              key={line.source}
              className="border-t border-line px-5 py-3 text-small text-bone tabular-nums"
            >
              {line.text}
            </div>
          ))}
        </>
      )}
    </SettingsCard>
  );
};
