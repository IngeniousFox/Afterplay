import { Joystick, Link2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { PendingSession } from '../../../../shared/types';
import { usePendingSessions } from '../../hooks/sessions';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision, formatElapsed, formatHours, formatTime } from '../../lib/format';
import { AddGameModal } from '../library/AddGameModal';
import { buttonSize, iconButtonClass, primaryButtonClass } from '../shell/controls';
import { AssignSessionModal } from './AssignSessionModal';
import { DeleteSessionDialog } from './DeleteSessionDialog';

type PendingSessionCardProps = {
  session: PendingSession;
  timeFormat: '12h' | '24h';
  onAssign: () => void;
  onDiscard: () => void;
};

// Aparte para que useLiveTimer (un tick/segundo) solo re-renderice la fila
// que de verdad está en directo, no la bandeja entera.
const PendingSessionCard = ({
  session,
  timeFormat,
  onAssign,
  onDiscard,
}: PendingSessionCardProps): React.JSX.Element => {
  const isLive = session.endedAt === null;
  const elapsedSeconds = useLiveTimer(isLive ? session.startedAt : null);

  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3.5 first:border-t-0">
      <span className="flex size-10 flex-none items-center justify-center rounded-sm border border-phosphor/30 bg-phosphor-tint">
        <Joystick aria-hidden size={17} className="text-phosphor" />
      </span>
      <div className="w-44 min-w-0">
        <div className="text-body font-semibold text-bone">{session.emulatorName}</div>
        <div className="text-small text-dust">Emulator session</div>
      </div>

      {/* Cuándo: en directo, LIVE en rojo (es lo único que sigue en marcha) y
          el cronómetro; cerrada, la franja y lo que duró. */}
      <div className="min-w-48 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-small text-bone tabular-nums">
          {isLive && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-live">
              <span
                aria-hidden
                className="size-2 flex-none animate-led-live rounded-full bg-live motion-reduce:animate-none"
              />
              Live
            </span>
          )}
          <span>
            {formatByPrecision(session.startedAt, 'datetime', timeFormat)}
            {session.endedAt !== null && ` to ${formatTime(session.endedAt, timeFormat)}`}
          </span>
        </div>
        <div className="mt-0.5 text-small text-dust tabular-nums">
          {isLive
            ? `Running for ${formatElapsed(elapsedSeconds)}`
            : formatHours((session.durationSec ?? 0) / 3600)}
        </div>
      </div>

      <div className="ml-auto flex flex-none items-center gap-2">
        <button type="button" onClick={onAssign} className={cn(primaryButtonClass, buttonSize.md)}>
          <Link2 aria-hidden size={15} />
          Assign
        </button>
        {/* La papelera solo con la sesión terminada: una en marcha se volvería
            a abrir sola al ciclo siguiente del watcher. Hueco fijo para que
            los Assign queden alineados. */}
        <span className="size-8.5 flex-none">
          {!isLive && (
            <button
              type="button"
              onClick={onDiscard}
              aria-label="Discard session"
              title="Discard (e.g. you only opened the emulator to configure it)"
              className={cn(iconButtonClass, 'hover:bg-live/10 hover:text-live')}
            >
              <Trash2 aria-hidden size={15} />
            </button>
          )}
        </span>
      </div>
    </li>
  );
};

// EMULADORES.md §6 — la bandeja de sesiones de emulador sin asignar, arriba
// del todo de la vista de Sesiones. Solo existe si hay algo pendiente: con
// cero huérfanas la vista se ve exactamente como siempre. Filo Phosphor =
// "requiere tu atención" sin parecer un error (el rojo queda para lo que está
// en marcha y lo destructivo), y sin pulso — pendiente, no vivo.
export const PendingSessionsSection = (): React.JSX.Element | null => {
  const { data: pending = [] } = usePendingSessions();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [assigning, setAssigning] = useState<PendingSession | null>(null);
  // "+ Add new game" desde el modal de asignar: se cierra ese y se abre el
  // Add Game con isEmulated premarcado; al crear el juego, la sesión que
  // estaba en curso de asignación se asigna sola al recién creado.
  const [addingFor, setAddingFor] = useState<PendingSession | null>(null);
  // Descartar una pendiente pasa por el MISMO diálogo de confirmación que las
  // sesiones normales.
  const [discarding, setDiscarding] = useState<PendingSession | null>(null);

  if (pending.length === 0 && !addingFor) return null;

  return (
    <section aria-label="Pending sessions">
      {pending.length > 0 && (
        <div className="mb-7 overflow-hidden rounded-md border border-l-2 border-line border-l-phosphor bg-panel">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-phosphor/4 px-5 py-4">
            <h2 className="font-display text-title font-bold text-bone">Pending sessions</h2>
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-phosphor px-1.5 font-display text-[16px] leading-none font-bold text-ink tabular-nums">
              {pending.length}
            </span>
            <p className="text-small text-dust">
              Emulator time that isn&apos;t linked to a game yet. Assign it to the game you were
              playing.
            </p>
          </header>
          <ul>
            {pending.map((session) => (
              <PendingSessionCard
                key={session.id}
                session={session}
                timeFormat={timeFormat}
                onAssign={() => setAssigning(session)}
                onDiscard={() => setDiscarding(session)}
              />
            ))}
          </ul>
        </div>
      )}

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
    </section>
  );
};
