import { ArrowRight, Flame, Timer, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AchievementEntry, Session } from '../../../../../shared/types';
import { useGameAchievements } from '../../../hooks/achievements';
import { SessionAchievements } from '../../sessions/SessionAchievements';
import { useTimeFormat } from '../../../hooks/settings';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import {
  consumeSessionFlash,
  getPendingSessionFlash,
  subscribeSessionFlash,
} from '../../../hooks/useSessionClosedToast';
import { formatByPrecision, formatElapsed, formatSessionEndTime } from '../../../lib/format';
import { revealClass, revealStyle } from '../../../lib/styles';
import { DeleteSessionDialog } from '../../sessions/DeleteSessionDialog';
import { SessionNote } from '../../sessions/SessionNote';
import { SectionLabel } from './SectionLabel';

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
  flash,
  achievements,
  onDelete,
}: {
  session: Session;
  maxDurationSec: number;
  isRecord: boolean;
  // Parpadeo dorado al llegar desde el aviso de cierre: "esta es la sesión de
  // la que te hablaba". Dos pulsos y se acaba (ver main.css).
  flash: boolean;
  // Los logros que cayeron EN esta sesión (LOGROS-IDEAS.md §2.1) — ya
  // cruzados por el main (sessionId en cada desbloqueo); aquí solo se pintan.
  achievements: AchievementEntry[];
  // Solo llega para sesiones CERRADAS — una viva se para con Stop, no se
  // borra (el watcher la reabriría al ciclo siguiente).
  onDelete?: () => void;
}): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const liveSeconds = useLiveTimer(isLive ? session.startedAt : null);
  const durationSec = isLive ? liveSeconds : (session.durationSec ?? 0);
  const { data: timeFormat = '24h' } = useTimeFormat();
  const endTime = formatSessionEndTime(session.endedAt, session.datePrecision, timeFormat);
  // Modelo v2: toda sesión es tiempo jugado real — los marcadores de borde
  // de duración 0 ya no existen (las fechas viven en el historial).
  const fillPct =
    !isLive && maxDurationSec > 0 ? Math.max(3, (durationSec / maxDurationSec) * 100) : 0;

  // El parpadeo no sirve de nada si pasa fuera de pantalla: al llegar desde
  // el aviso, la ficha se abre arriba del todo (hero, acciones…) y el
  // historial de sesiones queda mucho más abajo. Así que primero se lleva la
  // fila a la vista y SOLO DESPUÉS empieza a parpadear.
  const rowRef = useRef<HTMLDivElement>(null);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (!flash) return;
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Margen para que el desplazamiento haya llegado (o casi) antes del
    // primer pulso — si no, el destello se gasta mientras la fila todavía
    // está entrando en pantalla.
    const timer = setTimeout(() => {
      setFlashing(true);
      // Se consume AQUÍ y no antes: consumir vuelve `flash` a false y eso
      // dispara la limpieza de este efecto — hacerlo al entrar cancelaría el
      // temporizador y el parpadeo no llegaría a empezar nunca.
      consumeSessionFlash();
    }, 450);
    return () => clearTimeout(timer);
  }, [flash]);

  return (
    <div
      ref={rowRef}
      className={`group/session relative flex items-center gap-4 overflow-hidden rounded-[13px] border px-4.5 py-3.5 ${flashing ? 'afterplay-flash-gold' : ''}`}
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
        <Timer size={15} className="text-muted-foreground" />
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
          {isLive ? 'Live now' : session.isManual ? 'Manual' : 'Tracked'}
        </div>

        {/* Los trofeos de la noche (LOGROS-IDEAS.md §2.1): la misma pieza
            que las filas de la pantalla de Sesiones y el aviso de cierre —
            píldora teñida del más raro + los iconos de verdad. */}
        <SessionAchievements entries={achievements} />

        {/* Diario de sesión: "dónde lo dejé" — ver SessionNote. */}
        <SessionNote sessionId={session.id} note={session.note} />
      </div>
      <div className="relative z-1 flex flex-none items-center gap-1.5">
        {isRecord && <Flame size={13} color="#e85d72" />}
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{ color: isLive ? '#2fdc7e' : 'var(--foreground)' }}
        >
          {formatElapsed(durationSec)}
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
  // Qué sesión resaltar por haber llegado desde el aviso de cierre. Vive
  // fuera de React (el aviso puede llegar en cualquier pantalla), así que se
  // lee con useSyncExternalStore — que además cubre el caso de estar YA en
  // esta ficha, donde no hay remontaje. Quien lo consume es la propia fila,
  // en cuanto arranca el parpadeo.
  const flashSessionId = useSyncExternalStore(subscribeSessionFlash, getPendingSessionFlash);

  // Los logros del juego, agrupados por la sesión en la que cayeron — el
  // cruce ya viene hecho del main (placeUnlock); esto solo lo indexa. Los
  // que no cayeron en ninguna sesión trackeada (sessionId null: anteriores a
  // la app, u otro PC) simplemente no aparecen en ninguna fila — regla 3 de
  // LOGROS-IDEAS.md: lo sesional solo cuenta lo sesional.
  const { data: achievementsData } = useGameAchievements(gameId);
  const achievementsBySession = new Map<number, AchievementEntry[]>();
  for (const entry of achievementsData?.entries ?? []) {
    if (entry.sessionId === null || entry.unlockedAt === null) continue;
    const list = achievementsBySession.get(entry.sessionId) ?? [];
    list.push(entry);
    achievementsBySession.set(entry.sessionId, list);
  }

  if (sessions.length === 0) return null;

  const maxDurationSec = Math.max(
    ...sessions.map((session) => session.durationSec ?? (session.endedAt === null ? 1 : 0)),
    1,
  );
  const visible = sessions.slice(0, VISIBLE_LIMIT);
  const realSessionsCount = sessions.length;

  return (
    <div className="mt-7.5">
      <SectionLabel className="mb-3.25">SESSION HISTORY</SectionLabel>
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
              flash={session.id === flashSessionId}
              achievements={achievementsBySession.get(session.id) ?? []}
              onDelete={session.endedAt !== null ? () => setPendingDelete(session) : undefined}
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
