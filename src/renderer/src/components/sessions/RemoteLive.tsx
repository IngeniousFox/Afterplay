import { Square, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNoSignalText } from '../../hooks/sessionDevice';
import { buttonSize, secondaryButtonClass } from '../shell/controls';
import type { LiveSessionSignal } from '../../../../shared/liveSession';

// UNA SESIÓN EN VIVO EN OTRO DISPOSITIVO (AFTERPLAY-2.0.md §10.8): "Playing on
// PC-A", sin botón Stop salvo que sea un cronómetro, y "No signal for X" si
// lleva más de 3 minutos callada. La regla vive en shared/liveSession.ts; aquí
// solo se pinta, para que ficha, tarjeta de "now playing", listas y TV digan
// lo mismo de la misma manera.

type PlayingOnNoticeProps = {
  deviceName: string;
  session: LiveSessionSignal;
  // Solo si se puede parar desde aquí (un cronómetro). Sin él no hay botón.
  onStop?: () => void;
  stopping?: boolean;
};

// El aviso completo de la ficha: punto, "Playing on PC-A", la falta de señal si
// la hay y, para un cronómetro, el Stop. Envuelve en vez de truncar: el nombre
// del dispositivo y el "No signal for…" son información, no adorno.
export const PlayingOnNotice = ({
  deviceName,
  session,
  onStop,
  stopping = false,
}: PlayingOnNoticeProps): React.JSX.Element => {
  const noSignal = useNoSignalText(session);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-panel px-3.5 py-2.5 text-small">
      {/* Otro PC: anillo Tube hueco (no el pulso rojo, que es "aquí"); sin
          señal, todo en gris con el triángulo — el icono lleva el
          significado, no solo el color. */}
      <span
        className={cn(
          'flex items-center gap-2 font-semibold',
          noSignal === null ? 'text-tube' : 'text-dust',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-2 flex-none rounded-full border-2',
            noSignal === null ? 'border-tube' : 'border-dust',
          )}
        />
        Playing on {deviceName}
      </span>
      {noSignal !== null && (
        <span className="flex items-center gap-1 font-semibold text-dust">
          <TriangleAlert aria-hidden size={13} className="flex-none" />
          {noSignal}
        </span>
      )}
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          title="Stop this timer"
          className={cn(
            secondaryButtonClass,
            buttonSize.sm,
            'ml-auto hover:border-live/50 hover:text-live',
          )}
        >
          <Square aria-hidden size={11} fill="currentColor" />
          {stopping ? 'Stopping…' : 'Stop timer'}
        </button>
      )}
    </div>
  );
};
