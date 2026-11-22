import { AlertTriangle, Link2, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useDeviceContext } from '../../../hooks/devices';
import { useGameInstallInfo, useUpdateGame } from '../../../hooks/games';
import { shouldShowInstalledOn } from '../../../../../shared/devices';
import { secondaryButtonClass } from '../../shell/controls';
import type { GameId } from '../../../../../shared/entityIds';

// Lo que la ficha dice de las instalaciones del juego (AFTERPLAY-2.0.md §11):
//
//  · "The executable is no longer at this path" (§11.3). El ejecutable de ESTE
//    PC consta en la base pero el fichero ya no está (se movió o se
//    desinstaló). No se escribe nada ni se borra la instalación por esto: es
//    una comprobación del disco, y la acción es elegir otro ejecutable.
//  · "Installed on" (§11.4), sin rutas: solo con más de un dispositivo
//    conocido, o cuando el juego no está aquí pero sí en otro (que explica por
//    qué Play está apagado).
//
// No pintan nada mientras carga ni cuando no hay nada que decir.

const usePickExecutable = (gameId: GameId): { pick: () => Promise<void>; pending: boolean } => {
  const updateGame = useUpdateGame();
  const pick = async (): Promise<void> => {
    const path = await window.api.dialog.pickExecutable();
    if (!path) return;
    try {
      await updateGame.mutateAsync({ id: gameId, patch: { executablePath: path } });
    } catch (error) {
      toast.error(`Couldn't change the executable: ${(error as Error).message}`);
    }
  };
  return { pick, pending: updateGame.isPending };
};

export const ExecutableMissingNotice = ({
  gameId,
}: {
  gameId: GameId;
}): React.JSX.Element | null => {
  const { data: info } = useGameInstallInfo(gameId);
  const { pick, pending } = usePickExecutable(gameId);
  if (info?.executable !== 'missing') return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-phosphor/35 bg-phosphor-tint px-4 py-2.5 text-body text-phosphor">
      <span className="flex items-center gap-2">
        <AlertTriangle size={15} className="flex-none" />
        The executable is no longer at this path
      </span>
      <button
        type="button"
        onClick={() => void pick()}
        disabled={pending}
        className={cn(secondaryButtonClass, 'h-7 px-2.5 text-small')}
      >
        Choose another…
      </button>
    </div>
  );
};

export const InstalledOnPanel = ({
  gameId,
  isEmulated,
}: {
  gameId: GameId;
  isEmulated: boolean;
}): React.JSX.Element | null => {
  const { data: info } = useGameInstallInfo(gameId);
  const { devices } = useDeviceContext();
  const { pick, pending } = usePickExecutable(gameId);

  if (!info || !shouldShowInstalledOn(info.installedOn, devices.length)) return null;
  const here = info.installedOn.some((install) => install.isThisDevice);
  const thisDevice = devices.find((device) => device.isThisDevice);

  return (
    <section>
      <h2 className="mb-3 text-small font-semibold text-dust">Installed on</h2>
      <ul className="flex flex-col gap-2.5">
        {!here && (
          <li className="flex flex-col gap-2.5">
            <div className="flex items-start gap-3">
              <Monitor size={16} className="mt-0.5 flex-none text-dust" />
              <div className="min-w-0 flex-1">
                <div className="text-body text-bone">{thisDevice?.name ?? 'This PC'}</div>
                <div className="text-small text-phosphor">Not installed on this PC</div>
              </div>
              <span className="text-small text-dust">This PC</span>
            </div>
            {!isEmulated && (
              <button
                type="button"
                onClick={() => void pick()}
                disabled={pending}
                title="Pick this game's executable on this PC"
                className={cn(
                  secondaryButtonClass,
                  'h-9 w-full border-phosphor/55 bg-transparent text-body text-phosphor hover:border-phosphor hover:bg-phosphor-tint',
                )}
              >
                <Link2 size={15} />
                Link installation
              </button>
            )}
          </li>
        )}
        {info.installedOn.map((install) => (
          <li key={install.deviceId} className="flex items-center gap-3">
            <Monitor size={16} className="flex-none text-dust" />
            <span className="min-w-0 flex-1 text-body text-bone [overflow-wrap:anywhere]">
              {install.deviceName}
            </span>
            {install.isThisDevice && <span className="text-small text-dust">This PC</span>}
          </li>
        ))}
      </ul>
    </section>
  );
};
