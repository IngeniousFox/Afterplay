import { Gamepad2, Play } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { GameListItem } from '../../../../shared/types';
import { isLiveElsewhere } from '../../../../shared/liveSession';
import { useDeviceContext } from '../../hooks/devices';
import { useLaunchExecutable } from '../../hooks/games';
import { useStartGameSession } from '../../hooks/sessions';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { DAY_MS, humanizeSpan, startOfDayMs } from '../../lib/dateMath';
import { formatElapsed, formatHours } from '../../lib/format';
import { statusKeyOf as gameStatusKey } from '../../lib/gameFilters';
import { STATUS_META } from '../../lib/gameStatus';
import { Grain, ScanBeam, ScanLines, Vignette } from '../fx/Backdrop';
import { GlowText } from '../fx/GlowText';
import { PressButton } from '../fx/PressButton';
import { Odometer, Ticker } from '../fx/Ticker';
import { StatusLed } from '../library/statusLed';
import { buttonSize, primaryButtonClass, secondaryButtonClass } from '../shell/controls';

// La tarjeta grande de Home: el juego en marcha o, sin sesión, el último que
// jugaste, con su botón Play. Solo cifras que ya existen: el cronómetro de la
// sesión, las horas totales y el número de sesiones.
//
// Es el héroe de la app, así que lleva la energía (components/fx): el arte
// con Ken Burns lento, scanlines que reptan, un haz que barre cada 9 s, grano
// y viñeta; el título se enciende con bloom; las cifras entran contando; Play
// se hunde y suelta un anillo con destello.

const lastPlayedText = (at: Date): string => {
  const days = Math.round((startOfDayMs(new Date()) - startOfDayMs(at)) / DAY_MS);
  if (days <= 0) return 'Last played today';
  if (days === 1) return 'Last played yesterday';
  return `Last played ${humanizeSpan(days)} ago`;
};

// Cifra con la unidad pequeña en Dust (README-sistema, principio 7):
// "23h 15m" se pinta como 23 h 15 m con las letras a 0.45 em.
const Figure = ({ value, className }: { value: string; className?: string }): React.JSX.Element => (
  <span className={cn('font-display leading-none font-bold tabular-nums', className)}>
    {value.split(/(\d+)/).map((part, index) =>
      /\d/.test(part) ? (
        <span key={index}>{part}</span>
      ) : part.trim() === '' ? null : (
        <span key={index} className="ml-px text-[0.45em] font-semibold text-dust">
          {part.trim()}
        </span>
      ),
    )}
  </span>
);

export const ContinueCard = ({ game }: { game: GameListItem }): React.JSX.Element => {
  const navigate = useNavigate();
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const elapsed = useLiveTimer(game.isLive ? game.liveSince : null);
  const { thisDeviceId, nameOf } = useDeviceContext();
  const remote = game.isLive && isLiveElsewhere(game, thisDeviceId);
  const deviceName = game.isLive
    ? remote && game.liveDeviceId
      ? nameOf(game.liveDeviceId)
      : thisDeviceId
        ? nameOf(thisDeviceId)
        : 'this PC'
    : null;
  const status = gameStatusKey(game);

  // Play: lo mismo que el botón de la ficha (ActionBar). Lanzar el .exe y,
  // solo si arrancó, abrir la sesión con la misma función que el watcher.
  const launchExecutable = useLaunchExecutable();
  const startGameSession = useStartGameSession();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const busy = launchExecutable.isPending || startGameSession.isPending;
  const canPlay = !game.isLive && game.executablePath !== null;

  const handlePlay = async (): Promise<void> => {
    setLaunchError(null);
    const result = await launchExecutable.mutateAsync(game.id);
    if (!result.ok) {
      setLaunchError(
        result.reason === 'missing'
          ? 'Couldn’t find the executable. It may have been moved or uninstalled. Check the path in Edit.'
          : result.reason === 'not_installed'
            ? 'Not installed on this PC.'
            : `Couldn't launch the game: ${result.message}`,
      );
      return;
    }
    await startGameSession.mutateAsync(game.id);
  };

  const openGame = (): void => {
    navigate(`/games/${game.id}`);
  };

  return (
    <article
      aria-label={game.isLive ? 'Now playing' : 'Continue'}
      className="grid min-h-65 overflow-hidden rounded-md border border-line bg-panel md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]"
    >
      {/* El arte: el banner del juego o, sin él, su carátula desenfocada. */}
      <div className="relative min-h-45 overflow-hidden bg-raised">
        {heroSrc ? (
          <img
            src={heroSrc}
            alt=""
            className="absolute inset-0 h-full w-full animate-ken-burns object-cover motion-reduce:animate-none"
          />
        ) : coverSrc ? (
          <img
            src={coverSrc}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg brightness-75"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Gamepad2 aria-hidden size={40} strokeWidth={1.5} className="text-dust/50" />
          </div>
        )}
        <ScanLines crawl />
        <Grain />
        <Vignette />
        <ScanBeam every={9} />
        <div
          aria-hidden
          className="absolute inset-0 bg-linear-to-r from-transparent via-transparent to-panel/70"
        />
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-5 px-7 py-6">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-dust">
            {game.isLive ? (
              <>
                <span aria-hidden className="relative inline-flex size-2.5 flex-none">
                  {!remote && (
                    <span className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden" />
                  )}
                  <span
                    className={cn(
                      'relative size-2.5 rounded-full',
                      remote ? 'border-2 border-tube' : 'bg-live',
                    )}
                  />
                </span>
                <span className={cn(remote && 'text-tube')}>Session running on {deviceName}</span>
              </>
            ) : (
              <>
                <StatusLed status={status} />
                <span>{STATUS_META[status].label}</span>
                {game.lastPlayedAt && <span>· {lastPlayedText(game.lastPlayedAt)}</span>}
              </>
            )}
          </div>
          {/* Bloom fijo, sin parpadeo: Home se visita muchas veces al día y
              un título que parpadea cada vez cansa. */}
          <GlowText as="h2" tone="bone" className="mt-2 font-display text-page font-bold text-bone">
            {game.title}
          </GlowText>
        </div>

        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {game.isLive && (
            <div className="flex flex-col-reverse">
              <dt className="mt-1 text-small text-dust">this session</dt>
              <dd>
                <GlowText
                  breathe
                  className="font-display text-[34px] leading-none font-bold text-phosphor"
                >
                  <Odometer value={formatElapsed(elapsed)} />
                </GlowText>
              </dd>
            </div>
          )}
          <div className="flex flex-col-reverse">
            <dt className="mt-1 text-small text-dust">total played</dt>
            <dd>
              <Ticker
                value={game.totalHours}
                format={formatHours}
                render={(hours) => (
                  <Figure value={formatHours(hours)} className="text-[34px] text-bone" />
                )}
              />
            </dd>
          </div>
          <div className="flex flex-col-reverse">
            <dt className="mt-1 text-small text-dust">
              {game.sessionCount === 1 ? 'session' : 'sessions'}
            </dt>
            <dd>
              <Ticker
                value={game.sessionCount}
                render={(count) => (
                  <Figure value={String(Math.round(count))} className="text-[34px] text-bone" />
                )}
              />
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2.5">
          {canPlay ? (
            <>
              <PressButton
                burst="phosphor"
                onClick={() => void handlePlay()}
                disabled={busy}
                aria-busy={busy}
                className={cn(primaryButtonClass, buttonSize.md)}
              >
                <Play aria-hidden size={15} fill="currentColor" />
                {launchExecutable.isPending ? 'Launching…' : 'Play'}
              </PressButton>
              <button
                type="button"
                onClick={openGame}
                className={cn(secondaryButtonClass, buttonSize.md)}
              >
                Open game
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={openGame}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              Open game
            </button>
          )}
        </div>
        {launchError && (
          <p role="alert" className="text-small text-live">
            {launchError}
          </p>
        )}
      </div>
    </article>
  );
};
