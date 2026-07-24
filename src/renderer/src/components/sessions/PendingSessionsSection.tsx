import { Joystick, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PendingSession } from '../../../../shared/types';
import { usePendingSessions } from '../../hooks/sessions';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useTimeFormat } from '../../hooks/settings';
import { AMBER } from '../../lib/colors';
import { formatByPrecision, formatElapsed } from '../../lib/format';
import { accentGradientStyle } from '../../lib/styles';
import { AddGameModal } from '../library/AddGameModal';
import { AssignSessionModal } from './AssignSessionModal';
import { DeleteSessionDialog } from './DeleteSessionDialog';

type PendingSessionCardProps = {
  session: PendingSession;
  timeFormat: '12h' | '24h';
  onAssign: () => void;
  onDiscard: () => void;
};

// Aparte para que useLiveTimer (un tick/segundo) solo re-renderice la card
// que de verdad está en directo, no la sección de pendientes entera — mismo
// motivo que GameCard/HeroBanner.
const PendingSessionCard = ({
  session,
  timeFormat,
  onAssign,
  onDiscard,
}: PendingSessionCardProps): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const elapsedSeconds = useLiveTimer(isLive ? session.startedAt : null);

  return (
    <div
      className="flex items-center gap-3.5 rounded-[12px] border bg-card px-4 py-3"
      style={{ borderColor: `${AMBER}66` }}
    >
      <div
        className="flex h-9.5 w-9.5 flex-none items-center justify-center rounded-[9px]"
        style={{ background: `${AMBER}1a` }}
      >
        <Joystick size={17} color={AMBER} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-foreground">{session.emulatorName}</div>
        <div className="mt-0.25 text-[12px] text-muted-foreground">
          {formatByPrecision(session.startedAt, 'datetime', timeFormat)}
          {isLive ? (
            <span className="ml-1.5 inline-flex items-center gap-1.5">
              <span className="font-extrabold tracking-[.08em] text-primary">LIVE</span>
              <span className="font-bold text-primary tabular-nums">
                {formatElapsed(elapsedSeconds)}
              </span>
            </span>
          ) : (
            ` · ${formatElapsed(session.durationSec ?? 0)}`
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onAssign}
        className="flex-none rounded-[9px] px-4 py-2 text-[12.5px] font-bold"
        style={accentGradientStyle}
      >
        Assign
      </button>
      {!isLive && (
        <button
          type="button"
          onClick={onDiscard}
          title="Discard (e.g. you only opened the emulator to configure it)"
          className="flex-none rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};

// EMULADORES.md §6 — la bandeja de sesiones de emulador sin asignar, arriba
// del todo de la vista de Sesiones. Solo existe si hay algo pendiente: con
// cero huérfanas la vista se ve exactamente como siempre. Borde ámbar =
// "requiere tu atención" sin parecer un error (el rojo queda para
// destructivo), y sin pulso — pendiente, no vivo.
export const PendingSessionsSection = (): React.JSX.Element | null => {
  const { data: pending = [] } = usePendingSessions();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [assigning, setAssigning] = useState<PendingSession | null>(null);
  // "+ Add new game" desde el modal de asignar: se cierra ese y se abre el
  // Add Game con isEmulated premarcado; al crear el juego, la sesión que
  // estaba en curso de asignación se asigna sola al recién creado.
  const [addingFor, setAddingFor] = useState<PendingSession | null>(null);
  // Descartar una pendiente ahora pasa por el MISMO diálogo de confirmación
  // que las sesiones normales (antes borraba directo, sin avisar).
  const [discarding, setDiscarding] = useState<PendingSession | null>(null);

  if (pending.length === 0 && !addingFor) return null;

  return (
    <div className="mb-6.5">
      <div
        className="mb-2.5 text-[11px] font-bold tracking-[.13em] uppercase"
        style={{ color: AMBER }}
      >
        Pending — needs assignment
      </div>
      <div className="flex flex-col gap-2.5">
        {pending.map((session) => (
          <PendingSessionCard
            key={session.id}
            session={session}
            timeFormat={timeFormat}
            onAssign={() => setAssigning(session)}
            onDiscard={() => setDiscarding(session)}
          />
        ))}
      </div>

      {assigning && (
        <AssignSessionModal
          session={assigning}
          open
          onOpenChange={(next) => {
            if (!next) setAssigning(null);
          }}
          onAddNewGame={() => {
            setAddingFor(assigning);
            setAssigning(null);
          }}
        />
      )}

      {addingFor && (
        <AddGameModal
          open
          onOpenChange={(next) => {
            if (!next) setAddingFor(null);
          }}
          defaultEmulated
          assignSessionId={addingFor.id}
        />
      )}

      {/* Mismo diálogo de confirmación que las sesiones normales, en modo
          pending (descarta con deletePending, sin tocar ningún juego). */}
      <DeleteSessionDialog
        session={
          discarding
            ? {
                id: discarding.id,
                label: `${discarding.emulatorName} — ${formatByPrecision(
                  discarding.startedAt,
                  'day',
                  timeFormat,
                )} · ${formatElapsed(discarding.durationSec ?? 0)}`,
              }
            : null
        }
        onClose={() => setDiscarding(null)}
        pending
      />
    </div>
  );
};
