import { Square } from 'lucide-react';
import { useNoSignalText } from '../../hooks/sessionDevice';
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[11px] border border-border bg-bone/[0.02] px-3.5 py-2.5 text-[13px]">
      <span className="flex items-center gap-2 font-semibold text-foreground">
        <span
          className={
            noSignal === null
              ? 'h-1.75 w-1.75 flex-none animate-[afterplay-pulse-dot_1.4s_infinite] rounded-full bg-live'
              : 'h-1.75 w-1.75 flex-none rounded-full bg-phosphor'
          }
        />
        Playing on {deviceName}
      </span>
      {noSignal !== null && <span className="font-semibold text-phosphor">{noSignal}</span>}
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          title="Stop this timer"
          className="ml-auto flex items-center gap-1.5 rounded-[8px] border border-input bg-bone/[0.04] px-2.5 py-1.25 text-[12px] font-bold text-muted-foreground transition-colors duration-150 hover:border-destructive/45 hover:text-destructive focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        >
          <Square size={11} fill="currentColor" />
          {stopping ? 'Stopping…' : 'Stop timer'}
        </button>
      )}
    </div>
  );
};
