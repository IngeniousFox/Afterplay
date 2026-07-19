import { Flame } from 'lucide-react';
import type { SessionWithGame } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import {
  formatByPrecision,
  formatElapsed,
  formatHours,
  formatSessionEndTime,
} from '../../lib/format';
import { GameCover } from '../GameCover';

type SessionRowProps = {
  session: SessionWithGame;
  // Duración de la sesión más larga del filtro activo — la fila lleva un
  // relleno proporcional a ella (estilo Most Played: la fila ES la barra),
  // así el ojo compara duraciones sin leer un solo número. 0 = sin barra.
  maxDurationSec?: number;
  // ¿Es LA sesión más larga del filtro? — llamita al lado de la duración.
  isRecord?: boolean;
};

// Bloque 5A / prototipo (Backlog.html, panel "ALL SESSIONS") — carátula,
// título del juego, fecha, y duración (o el contador en vivo si es la
// sesión activa), sobre una pista con relleno verde proporcional a la
// duración. La duración en reposo va en "Xh Ym" (fmtH del prototipo) — NO
// en HH:MM:SS, que es solo para el contador en vivo (fmtTimer);
// SessionHistoryList usa HH:MM:SS para las dos cosas, pero es otro
// componente.
export const SessionRow = ({
  session,
  maxDurationSec = 0,
  isRecord = false,
}: SessionRowProps): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const endTime = formatSessionEndTime(session.endedAt, session.datePrecision, timeFormat);

  // Las vivas no llevan relleno proporcional (su duración aún crece) — ya
  // van teñidas enteras de verde por su propio estilo de borde/fondo.
  const fillPct =
    !isLive && maxDurationSec > 0
      ? Math.max(2, ((session.durationSec ?? 0) / maxDurationSec) * 100)
      : 0;

  return (
    <div
      className="relative flex items-center gap-4 overflow-hidden rounded-[13px] border px-4.5 py-3.5"
      style={
        isLive
          ? { borderColor: 'rgba(47,220,126,.4)', background: 'rgba(47,220,126,.05)' }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.024)' }
      }
    >
      {fillPct > 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            width: `${fillPct}%`,
            background: 'linear-gradient(90deg, rgba(47,220,126,.08), rgba(47,220,126,.02))',
            borderRight: '1.5px solid rgba(47,220,126,.28)',
          }}
        />
      )}
      <GameCover
        url={session.coverUrl}
        className="relative z-1 h-15 w-11.5 flex-none overflow-hidden rounded-[8px] border border-border"
        iconSize={16}
      />
      <div className="relative z-1 min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-foreground">{session.gameTitle}</div>
        <div className="mt-0.75 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <span>{formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}</span>
          {session.isManual && (
            <span className="rounded border border-input bg-white/[0.04] px-1.25 py-0.25 text-[9px] font-bold tracking-[.08em] text-muted-foreground">
              MANUAL
            </span>
          )}
        </div>
        {endTime && (
          <div className="mt-0.25 text-[12.5px] text-muted-foreground/70">→ {endTime}</div>
        )}
      </div>
      {isLive ? (
        <div
          className="relative z-1 flex flex-none items-center gap-1.75 rounded-[9px] border px-3 py-1.5"
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
        <div className="relative z-1 flex flex-none items-center gap-1.5">
          {/* La más larga del filtro activo — misma llama (y rojo) que la
              métrica LONGEST SESSION de arriba. */}
          {isRecord && <Flame size={14} color="#e85d72" />}
          <span className="text-[15px] font-bold text-foreground tabular-nums">
            {formatHours((session.durationSec ?? 0) / 3600)}
          </span>
        </div>
      )}
    </div>
  );
};
