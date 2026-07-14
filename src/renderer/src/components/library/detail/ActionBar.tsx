import { ImagePlus, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useAddIteration } from '../../../hooks/iterations';
import { useAddSession, useCloseSession } from '../../../hooks/sessions';
import { useAddStateEvent } from '../../../hooks/stateEvents';
import { AddSpendPopover } from './AddSpendPopover';

type ActionBarProps = {
  game: GameDetail;
  liveSessionId: number | null;
  onEdit: () => void;
  onChangeCover: () => void;
  onDelete: () => void;
};

const outlineButtonClass =
  'flex items-center gap-2 rounded-[11px] border border-input bg-white/[0.03] px-4.5 text-[14px] font-semibold text-foreground hover:bg-white/[0.06]';

// SPEC 10.7 — Play/Stop (según haya sesión activa), Edit, Añadir gasto,
// Cambiar carátula/hero, Delete. El prototipo solo tiene Play/Edit/Delete —
// Add spend y Change cover se añaden con el mismo lenguaje visual (Edit =
// outline neutro, Delete = cuadrado rojo) por indicación explícita, ya que
// no existían todavía cuando se hizo el prototipo.
export const ActionBar = ({
  game,
  liveSessionId,
  onEdit,
  onChangeCover,
  onDelete,
}: ActionBarProps): React.JSX.Element => {
  const addIteration = useAddIteration();
  const addSession = useAddSession();
  const addStateEvent = useAddStateEvent();
  const closeSession = useCloseSession();
  const isLive = liveSessionId !== null;
  const isBusy =
    addIteration.isPending ||
    addSession.isPending ||
    addStateEvent.isPending ||
    closeSession.isPending;

  const handleTogglePlay = async (): Promise<void> => {
    if (isLive && liveSessionId !== null) {
      await closeSession.mutateAsync({ id: liveSessionId, endedAt: new Date() });
      return;
    }

    const activeIteration = game.iterations.find((it) => it.currentState === 'started');
    let iterationId = activeIteration?.id;
    // Anclar "Started" si la iteración destino aún no tiene sesión de inicio;
    // si ya la tiene (on_hold/resting reanudado), su fecha original no se pisa.
    let needsStartAnchor = activeIteration != null && activeIteration.startSessionId == null;
    if (!iterationId) {
      const lastIteration = game.iterations[game.iterations.length - 1];
      // SPEC 4 — retomar el juego (Play) después de un final (Beaten/
      // Dropped) es un playthrough nuevo, no una reapertura del anterior;
      // on_hold/resting sí reutilizan la misma iteración, solo estaba en
      // pausa (misma regla que StatusCard.tsx para el cambio manual).
      const lastIsTerminal =
        lastIteration != null &&
        (lastIteration.currentState === 'completed' || lastIteration.currentState === 'dropped');

      if (!lastIteration || lastIsTerminal) {
        const iteration = await addIteration.mutateAsync({
          gameId: game.id,
          playedPlatform: game.officialPlatforms?.[0] ?? 'PC',
          origin: 'Purchased',
          format: 'digital',
        });
        iterationId = iteration.id;
        needsStartAnchor = true;
      } else {
        iterationId = lastIteration.id;
        // Un Playthrough recién creado por Add Game (Unplayed) que nunca se
        // tocó no tiene sesión de inicio → esta la ancla.
        needsStartAnchor = lastIteration.startSessionId == null;
      }
      await addStateEvent.mutateAsync({
        iterationId,
        type: 'started',
        occurredAt: new Date(),
        datePrecision: 'datetime',
        note: null,
      });
    }

    await addSession.mutateAsync({
      iterationId,
      startedAt: new Date(),
      endedAt: null,
      durationSec: null,
      datePrecision: 'datetime',
      milestone: null,
      // Ancla "Started" al momento del Play cuando la iteración no tenía inicio
      // (nueva, o un Playthrough sin tocar); si se reanuda un on_hold/resting
      // ya iniciado, su fecha original no debe pisarse.
      ...(needsStartAnchor ? { anchorAs: 'start' as const } : {}),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        onClick={handleTogglePlay}
        disabled={isBusy}
        className="flex items-center gap-2.25 rounded-[11px] px-7.5 py-3 text-[15px] font-bold shadow-[0_6px_18px_rgba(0,0,0,.28)] disabled:cursor-not-allowed disabled:opacity-60"
        style={
          isLive
            ? {
                background: 'rgba(47,220,126,.14)',
                color: '#2fdc7e',
                border: '1px solid rgba(47,220,126,.5)',
              }
            : {
                background: 'linear-gradient(135deg,#2fdc7e,#16a35a)',
                color: '#08120c',
                border: '1px solid transparent',
              }
        }
      >
        {isLive ? <Pause size={16} fill="#2fdc7e" /> : <Play size={16} fill="#08120c" />}
        <span>{isLive ? 'Stop' : 'Play'}</span>
      </button>

      <button type="button" onClick={onEdit} className={`${outlineButtonClass} py-3`}>
        <Pencil size={16} />
        Edit
      </button>

      <AddSpendPopover gameId={game.id} />

      <button
        type="button"
        onClick={onChangeCover}
        title="Change cover / hero"
        className="flex h-11.5 w-11.5 flex-none items-center justify-center rounded-[11px] border border-input bg-white/[0.03] hover:bg-white/[0.06]"
      >
        <ImagePlus size={17} />
      </button>

      <button
        type="button"
        onClick={onDelete}
        title="Delete game"
        className="flex h-11.5 w-11.5 flex-none items-center justify-center rounded-[11px] border border-destructive/40 bg-destructive/8 hover:bg-destructive/18"
      >
        <Trash2 size={17} className="text-destructive" />
      </button>
    </div>
  );
};
