import { ArrowRight, Flag, Flame, Timer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../../../../../shared/types';
import { useTimeFormat } from '../../../hooks/settings';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { formatByPrecision, formatElapsed, formatSessionEndTime } from '../../../lib/format';
import { revealClass, revealStyle } from '../../../lib/styles';
import { DeleteSessionDialog } from '../../sessions/DeleteSessionDialog';

type SessionHistoryListProps = {
  sessions: Session[];
  gameId: number;
};

const VISIBLE_LIMIT = 5;

// SPEC 10.7 / prototipo — icono + fecha + subtítulo (Manual/Live/marcador) +
// relleno proporcional a la duración (relativa a la más larga de ESTA
// lista) DETRÁS de la fila entera (mismo lenguaje que la vista global de
// Sesiones: la fila ES la barra, no una barra suelta al lado) + duración a
// la derecha, con llama si es la más larga (contador en vivo si es la
// sesión activa). Máximo 5 filas — el botón "ver todas" lleva a la pestaña
// de Sesiones (Bloque 5A) filtrada por este juego.
const SessionRow = ({
  session,
  maxDurationSec,
  isRecord,
  onDelete,
}: {
  session: Session;
  maxDurationSec: number;
  isRecord: boolean;
  // Solo llega para sesiones reales CERRADAS — ni las vivas (se paran con
  // Stop) ni los marcadores (se gestionan desde Edit) se borran desde aquí.
  onDelete?: () => void;
}): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  const durationSec = isLive ? liveSeconds : (session.durationSec ?? 0);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const endTime = formatSessionEndTime(session.endedAt, session.datePrecision, timeFormat);
  // Las sesiones de borde (inicio/fin de un playthrough manual, ver
  // createGameWithDetails.ts/EditGameModal.tsx) siempre llevan duración 0 a
  // propósito — son solo un marcador de fecha, nunca una partida real. Un
  // "00:00:00" ahí parece un bug; un icono de marcador + guión deja claro
  // que es intencional. Sin relleno tampoco: no hay duración que proporcionar.
  const isMarker = !isLive && durationSec === 0;
  const fillPct =
    !isMarker && !isLive && maxDurationSec > 0
      ? Math.max(3, (durationSec / maxDurationSec) * 100)
      : 0;

  return (
    <div
      className="group/session relative flex items-center gap-4 overflow-hidden rounded-[13px] border px-4.5 py-3.5"
      style={
        isLive
          ? { borderColor: 'rgba(47,220,126,.4)', background: 'rgba(47,220,126,.06)' }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.024)' }
      }
    >
      {fillPct > 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            width: `${fillPct}%`,
            background: 'linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.01))',
            borderRight: '1.5px solid rgba(255,255,255,.14)',
          }}
        />
      )}
      <div className="relative z-1 flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] bg-white/5">
        {isMarker ? (
          <Flag size={14} className="text-muted-foreground" />
        ) : (
          <Timer size={15} className="text-muted-foreground" />
        )}
      </div>
      <div className="relative z-1 min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-foreground">
          {formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}
        </div>
        {endTime && (
          <div className="mt-0.25 text-[11.5px] text-muted-foreground/70">→ {endTime}</div>
        )}
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
      <div className="relative z-1 flex flex-none items-center gap-1.5">
        {isRecord && <Flame size={13} color="#e85d72" />}
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{ color: isLive ? '#2fdc7e' : 'var(--foreground)' }}
        >
          {isMarker ? '—' : formatElapsed(durationSec)}
        </span>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete session"
          className="relative z-1 flex-none rounded-md p-1.5 text-muted-foreground opacity-0 group-hover/session:opacity-100 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};

export const SessionHistoryList = ({
  sessions,
  gameId,
}: SessionHistoryListProps): React.JSX.Element | null => {
  const navigate = useNavigate();
  // Sesión pendiente de confirmación de borrado (null = diálogo cerrado).
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const { data: timeFormat = '24h' } = useTimeFormat();
  if (sessions.length === 0) return null;

  const maxDurationSec = Math.max(
    ...sessions.map((session) => session.durationSec ?? (session.endedAt === null ? 1 : 0)),
    1,
  );
  const visible = sessions.slice(0, VISIBLE_LIMIT);
  // La vista de Sesiones (Bloque 5A) no cuenta los marcadores de borde — el
  // número del botón debe prometer lo mismo que ahí se va a ver, aunque esta
  // lista de aquí SÍ siga mostrando los marcadores (con su icono de bandera).
  const realSessionsCount = sessions.filter((session) => session.milestone === null).length;

  return (
    <div className="mt-7.5">
      <div className="mb-3.25 text-[11px] font-bold tracking-[.13em] text-muted-foreground">
        SESSION HISTORY
      </div>
      <div className="flex flex-col gap-2.25">
        {visible.map((session, index) => (
          <div key={session.id} className={revealClass} style={revealStyle(index)}>
            <SessionRow
              session={session}
              maxDurationSec={maxDurationSec}
              isRecord={
                session.endedAt !== null &&
                session.durationSec !== null &&
                session.durationSec > 0 &&
                session.durationSec === maxDurationSec
              }
              onDelete={
                session.endedAt !== null && session.milestone === null
                  ? () => setPendingDelete(session)
                  : undefined
              }
            />
          </div>
        ))}
        {sessions.length > VISIBLE_LIMIT && (
          <button
            type="button"
            onClick={() => navigate(`/sessions?game=${gameId}`)}
            className="flex w-fit items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-4 py-2.25 text-[13px] font-semibold text-foreground hover:bg-white/[0.06]"
          >
            <span>View all {realSessionsCount} sessions</span>
            <ArrowRight size={14} />
          </button>
        )}
      </div>

      <DeleteSessionDialog
        session={
          pendingDelete
            ? {
                id: pendingDelete.id,
                label: `${formatByPrecision(pendingDelete.startedAt, pendingDelete.datePrecision, timeFormat)} · ${formatElapsed(pendingDelete.durationSec ?? 0)}`,
              }
            : null
        }
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
};
