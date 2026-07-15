import { AlertTriangle, ImagePlus, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useLaunchExecutable } from '../../../hooks/games';
import { useCloseSession, useStartGameSession } from '../../../hooks/sessions';
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
  const closeSession = useCloseSession();
  const startGameSession = useStartGameSession();
  const launchExecutable = useLaunchExecutable();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const isLive = liveSessionId !== null;
  const isBusy = closeSession.isPending || startGameSession.isPending || launchExecutable.isPending;
  const canPlay = isLive || game.executablePath !== null;

  const handleTogglePlay = async (): Promise<void> => {
    if (isLive && liveSessionId !== null) {
      await closeSession.mutateAsync({ id: liveSessionId, endedAt: new Date() });
      return;
    }

    // El botón ya está deshabilitado sin executablePath (ver canPlay) — esto
    // es cinturón y tirantes por si acaso.
    if (!game.executablePath) return;

    setLaunchError(null);
    const result = await launchExecutable.mutateAsync(game.executablePath);
    if (!result.ok) {
      // Si el .exe no arranca no hay nada que trackear — abortar ANTES de
      // abrir sesión, o quedaría una sesión "Playing" abierta para un juego
      // que en realidad no se ha abierto.
      setLaunchError(
        result.reason === 'missing'
          ? 'Couldn’t find the executable — it may have been moved or uninstalled. Check the path in Edit.'
          : `Couldn't launch the game — ${result.message}`,
      );
      return;
    }

    // startGameSession (misma función que usa el watcher al detectar un
    // arranque él solo) decide qué playthrough usar/crear y ancla su inicio
    // — toda la lógica que antes vivía aquí a mano, repartida en 2-3
    // mutations sueltas (no atómicas entre sí, y con isManual:true SIEMPRE
    // por venir de addManualSession — un Play que lanza el .exe de verdad es
    // tan automático como lo que detecta el watcher).
    await startGameSession.mutateAsync(game.id);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={handleTogglePlay}
          disabled={isBusy || !canPlay}
          title={canPlay ? undefined : 'Set an executable path (Edit) to launch this game'}
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
          <span>{isLive ? 'Stop' : launchExecutable.isPending ? 'Launching…' : 'Play'}</span>
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

      {launchError && (
        <div className="flex items-center gap-2 text-[12.5px] text-destructive">
          <AlertTriangle size={13} className="flex-none" />
          {launchError}
        </div>
      )}
    </div>
  );
};
