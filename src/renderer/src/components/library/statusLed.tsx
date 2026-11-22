import { cn } from '@/lib/utils';
import type { StatusKey } from '../../lib/gameStatus';

// El LED de estado de Fósforo: el único sitio con cinco tonos, y siempre junto
// a su palabra (aquí o en la ficha). Las clases van literales para que
// Tailwind las encuentre.
//
// La app tiene siete estados y el LED cinco colores: On Hold comparte el ámbar
// de Playing pero hueco (un juego en pausa sigue "en curso"), y Plan to play
// usa el cian de Backlog en hueco.
const LED_CLASS: Record<StatusKey, string> = {
  playing: 'bg-st-playing',
  on_hold: 'border-2 border-st-playing',
  beaten: 'bg-st-beaten',
  unplayed: 'bg-st-backlog',
  resting: 'bg-st-resting',
  dropped: 'bg-st-dropped',
  plan: 'border-2 border-st-backlog',
};

export const StatusLed = ({
  status,
  className,
}: {
  status: StatusKey;
  className?: string;
}): React.JSX.Element => (
  <span
    aria-hidden
    className={cn('inline-block size-2 flex-none rounded-full', LED_CLASS[status], className)}
  />
);
