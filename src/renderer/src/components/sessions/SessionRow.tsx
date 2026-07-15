import { Gamepad2 } from 'lucide-react';
import type { SessionWithGame } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import {
  formatByPrecision,
  formatElapsed,
  formatHours,
  formatSessionEndTime,
} from '../../lib/format';

type SessionRowProps = {
  session: SessionWithGame;
};

// Bloque 5A / prototipo (Backlog.html, panel "ALL SESSIONS") — carátula,
// título del juego, fecha, y duración (o el contador en vivo si es la
// sesión activa). A diferencia de SessionHistoryList (detalle de un juego,
// SPEC 10.7), aquí no hay barra proporcional ni distinción de marcador: el
// prototipo de esta vista global no la lleva, y getAllSessions() ya excluye
// los marcadores de borde (duración 0) antes de que lleguen aquí. La
// duración en reposo va en "Xh Ym" (fmtH del prototipo) — NO en HH:MM:SS,
// que es solo para el contador en vivo (fmtTimer); SessionHistoryList usa
// HH:MM:SS para las dos cosas, pero ese es un componente distinto.
export const SessionRow = ({ session }: SessionRowProps): React.JSX.Element => {
  const coverSrc = useImageSrc(session.coverUrl, 'covers');
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const endTime = formatSessionEndTime(session.endedAt, session.datePrecision, timeFormat);

  return (
    <div
      className="flex items-center gap-4 rounded-[13px] border px-4.5 py-3.5"
      style={
        isLive
          ? { borderColor: 'rgba(47,220,126,.4)', background: 'rgba(47,220,126,.05)' }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.024)' }
      }
    >
      <div className="h-15 w-11.5 flex-none overflow-hidden rounded-[8px] border border-border">
        {coverSrc ? (
          <img src={coverSrc} loading="lazy" alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Gamepad2 size={16} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-foreground">{session.gameTitle}</div>
        <div className="mt-0.75 text-[12.5px] text-muted-foreground">
          {formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}
        </div>
        {endTime && (
          <div className="mt-0.25 text-[12.5px] text-muted-foreground/70">→ {endTime}</div>
        )}
      </div>
      {isLive ? (
        <div
          className="flex flex-none items-center gap-1.75 rounded-[9px] border px-3 py-1.5"
          style={{ borderColor: 'rgba(47,220,126,.5)' }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-primary"
            style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
          />
          <span className="text-xs font-bold text-primary tabular-nums">
            {formatElapsed(liveSeconds)}
          </span>
        </div>
      ) : (
        <div className="flex-none text-[15px] font-bold text-foreground tabular-nums">
          {formatHours((session.durationSec ?? 0) / 3600)}
        </div>
      )}
    </div>
  );
};
