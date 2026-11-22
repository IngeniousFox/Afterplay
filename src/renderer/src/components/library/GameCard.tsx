import { cn } from '@/lib/utils';
import type { GameListItem } from '../../../../shared/types';
import { isLiveElsewhere } from '../../../../shared/liveSession';
import { useDeviceContext } from '../../hooks/devices';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useNearViewport } from '../../hooks/useNearViewport';
import { useOffscreenAnimation } from '../../hooks/useOffscreenAnimation';
import { formatElapsed, formatHours } from '../../lib/format';
import { focusRing } from '../shell/controls';
import { TiltCover, TiltGlare } from '../fx/TiltCover';
import { statusKeyOf as gameStatusKey } from '../../lib/gameFilters';
import { STATUS_META } from '../../lib/gameStatus';
import { StatusLed } from './statusLed';

// LA PORTADA DE LA BIBLIOTECA (Fósforo, library.png y sistema-medios.png).
//
// Carátula 3:4 con radio de 4 px, el LED de estado en la esquina y la franja
// de horas al pie; el título debajo, entero (sin recortar). Es un botón: se
// abre con clic, Enter o Espacio, y la rejilla mueve el foco con las flechas.
//
// En marcha: el LED pasa a rojo con pulso y la franja enseña el cronómetro;
// en otro PC, anillo cian y el nombre del PC (§10.8). El resto de la ficha
// (géneros, HLTB, sesiones) vive en la ficha, no en la tarjeta.
//
// Al pasar el ratón la portada se inclina hacia él con un reflejo y el LED
// brilla más (fx/TiltCover). No hay listener por tarjeta: uno solo, delegado,
// en el <main> de RootLayout; en reposo la tarjeta no lleva transform.

type GameCardProps = {
  game: GameListItem;
  onSelect: () => void;
  // El último juego abierto desde la rejilla: borde Phosphor al volver.
  selected?: boolean;
};

export const GameCard = ({
  game,
  onSelect,
  selected = false,
}: GameCardProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  // Suelta la carátula descodificada cuando la tarjeta se aleja de la vista:
  // la rejilla monta toda la biblioteca y recorrerla entera dejaría una
  // imagen viva por juego. La caja no cambia de tamaño.
  const { observe: observeCard, near: cardNear } = useNearViewport();
  // El pulso del LED en marcha se pausa fuera de la vista.
  const { observe: observeLive, playState: livePlayState } = useOffscreenAnimation();
  const elapsedSeconds = useLiveTimer(game.isLive ? game.liveSince : null);
  const { thisDeviceId, nameOf } = useDeviceContext();
  const remote = game.isLive && isLiveElsewhere(game, thisDeviceId);
  const status = gameStatusKey(game);

  const strip = game.isLive
    ? remote && game.liveDeviceId
      ? `On ${nameOf(game.liveDeviceId)}`
      : formatElapsed(elapsedSeconds)
    : game.totalHours > 0
      ? formatHours(game.totalHours)
      : 'Not played';

  return (
    <button
      type="button"
      onClick={onSelect}
      data-game-card={game.id}
      aria-label={`${game.title}. ${game.isLive ? (remote ? 'Playing on another PC' : 'Playing now') : STATUS_META[status].label}. ${strip}`}
      className={cn(
        'group block w-full rounded-sm text-left',
        focusRing,
        'focus-visible:outline-offset-3',
      )}
    >
      <TiltCover className="rounded-sm">
        <span
          ref={observeCard}
          className={cn(
            'relative block aspect-3/4 overflow-hidden rounded-sm bg-raised ring-1 transition-[transform,box-shadow] duration-180 ease-out',
            'group-hover:-translate-y-0.5 group-hover:shadow-lift motion-reduce:group-hover:translate-y-0',
            selected ? 'ring-2 ring-phosphor' : 'ring-line group-hover:ring-bone/30',
          )}
        >
          {!cardNear ? null : coverSrc ? (
            <img
              src={coverSrc}
              loading="lazy"
              alt=""
              className="block h-full w-full object-cover transition-transform duration-180 ease-out group-hover:scale-104 motion-reduce:group-hover:scale-100"
            />
          ) : (
            // Sin carátula: placa Raised con las iniciales en Big Shoulders.
            <span className="flex h-full w-full items-center justify-center bg-[repeating-linear-gradient(135deg,transparent_0_10px,rgb(233_228_216/0.03)_10px_11px)] px-3 text-center font-display text-[32px] leading-none font-bold text-dust">
              {initialsOf(game.title)}
            </span>
          )}

          <TiltGlare />

          {/* El LED: 9 px a 7 px de la esquina, con anillo Cabinet. */}
          {game.isLive ? (
            <span
              ref={observeLive}
              aria-hidden
              className="absolute top-1.75 right-1.75 flex size-2.25 items-center justify-center"
            >
              {!remote && (
                <span
                  className="absolute inset-0 animate-led-ring rounded-full bg-live motion-reduce:hidden"
                  style={{ animationPlayState: livePlayState }}
                />
              )}
              <span
                className={cn(
                  'relative size-2.25 rounded-full ring-2 ring-cabinet',
                  remote ? 'border-2 border-tube bg-cabinet' : 'bg-live',
                )}
              />
            </span>
          ) : (
            <StatusLed
              status={status}
              className="absolute top-1.75 right-1.75 size-2.25 ring-2 ring-cabinet transition-[filter] duration-200 group-data-tilting/tilt:brightness-150"
            />
          )}

          {/* La franja de horas: 20 px, Cabinet al 80 %. */}
          <span
            className={cn(
              'absolute inset-x-0 bottom-0 flex h-5 items-center bg-cabinet/80 px-2 text-micro font-medium tabular-nums',
              game.isLive ? (remote ? 'text-tube' : 'text-live') : 'text-bone',
            )}
          >
            {strip}
          </span>
        </span>
      </TiltCover>
      <span className="mt-2 block text-small text-bone">{game.title}</span>
    </button>
  );
};

const initialsOf = (title: string): string =>
  title
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word[0] ?? ''))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
