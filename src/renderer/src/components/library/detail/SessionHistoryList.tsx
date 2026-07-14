import { ArrowRight, Flag, Timer } from 'lucide-react';
import type { Session } from '../../../../../shared/types';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { formatByPrecision, formatElapsed } from '../../../lib/format';

type SessionHistoryListProps = {
  sessions: Session[];
};

const VISIBLE_LIMIT = 5;

// SPEC 10.7 / prototipo — icono + fecha + subtítulo (Manual/Live) + barra
// proporcional a la duración (relativa a la más larga de ESTA lista) +
// duración a la derecha (contador en vivo si es la sesión activa). Máximo
// 5 filas — el botón "ver todas" está pensado para llevar a una pestaña de
// Sesiones filtrada por este juego (SPEC), que todavía no existe (Bloque
// 5), así que hoy no hace nada — no expande en sitio, es un placeholder.
const SessionRow = ({
  session,
  maxDurationSec,
}: {
  session: Session;
  maxDurationSec: number;
}): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  const durationSec = isLive ? liveSeconds : (session.durationSec ?? 0);
  const barPercent = Math.max(4, maxDurationSec > 0 ? (durationSec / maxDurationSec) * 100 : 4);
  // Las sesiones de borde (inicio/fin de un playthrough manual, ver
  // createGameWithDetails.ts/EditGameModal.tsx) siempre llevan duración 0 a
  // propósito — son solo un marcador de fecha, nunca una partida real. Un
  // "00:00:00" ahí parece un bug; un icono de marcador + guión deja claro
  // que es intencional.
  const isMarker = !isLive && durationSec === 0;

  return (
    <div
      className="flex items-center gap-4 rounded-xl border px-4.5 py-3.5"
      style={
        isLive
          ? { borderColor: 'rgba(47,220,126,.4)', background: 'rgba(47,220,126,.06)' }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.024)' }
      }
    >
      <div className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-white/5">
        {isMarker ? (
          <Flag size={14} className="text-muted-foreground" />
        ) : (
          <Timer size={15} className="text-muted-foreground" />
        )}
      </div>
      <div className="w-37.5 flex-none">
        <div className="text-[13.5px] font-semibold text-foreground">
          {formatByPrecision(session.startedAt, session.datePrecision)}
        </div>
        <div
          className="mt-0.5 text-xs"
          style={{ color: isLive ? '#2fdc7e' : 'var(--muted-foreground)' }}
        >
          {isLive
            ? 'Live now'
            : isMarker
              ? 'Manual Session'
              : session.isManual
                ? 'Manual'
                : 'Tracked'}
        </div>
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        {!isMarker && (
          <div
            className="h-full rounded-full"
            style={{
              width: `${barPercent}%`,
              background: isLive
                ? 'linear-gradient(90deg,#16a35a,#2fdc7e)'
                : 'rgba(255,255,255,.28)',
            }}
          />
        )}
      </div>
      <div
        className="w-20 flex-none text-right text-[13px] font-semibold tabular-nums"
        style={{ color: isLive ? '#2fdc7e' : 'var(--foreground)' }}
      >
        {isMarker ? '—' : formatElapsed(durationSec)}
      </div>
    </div>
  );
};

export const SessionHistoryList = ({
  sessions,
}: SessionHistoryListProps): React.JSX.Element | null => {
  if (sessions.length === 0) return null;

  const maxDurationSec = Math.max(
    ...sessions.map((session) => session.durationSec ?? (session.endedAt === null ? 1 : 0)),
    1,
  );
  const visible = sessions.slice(0, VISIBLE_LIMIT);

  return (
    <div className="mt-7.5">
      <div className="mb-3.25 text-[11px] font-bold tracking-[.13em] text-muted-foreground">
        SESSION HISTORY
      </div>
      <div className="flex flex-col gap-2.25">
        {visible.map((session) => (
          <SessionRow key={session.id} session={session} maxDurationSec={maxDurationSec} />
        ))}
        {sessions.length > VISIBLE_LIMIT && (
          <button
            type="button"
            disabled
            title="Coming soon — will open the Sessions tab filtered by this game"
            className="flex w-fit cursor-not-allowed items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-4 py-2.25 text-[13px] font-semibold text-foreground opacity-60"
          >
            <span>View all {sessions.length} sessions</span>
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
