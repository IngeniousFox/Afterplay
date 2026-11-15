import { AlertTriangle, HardDrive } from 'lucide-react';
import { toast } from 'sonner';
import { useDeviceContext } from '../../../hooks/devices';
import { useGameInstallInfo, useUpdateGame } from '../../../hooks/games';
import { shouldShowInstalledOn } from '../../../../../shared/devices';
import type { GameId } from '../../../../../shared/entityIds';

type InstallNoticeProps = {
  gameId: GameId;
};

// Lo que la ficha dice de las instalaciones del juego (AFTERPLAY-2.0.md §11):
//
//  · "The executable is no longer at this path" (§11.3). El ejecutable de ESTE
//    PC consta en la base pero el fichero ya no está (se movió o se
//    desinstaló). No se escribe nada ni se borra la instalación por esto: es
//    una comprobación del disco, y la acción es elegir otro ejecutable.
//  · "Installed on: PC-A, PC-B" (§11.4), sin rutas: solo con más de un
//    dispositivo conocido, o cuando el juego no está aquí pero sí en otro (que
//    explica por qué Play está apagado).
//
// No pinta nada mientras carga ni cuando no hay nada que decir.
export const InstallNotice = ({ gameId }: InstallNoticeProps): React.JSX.Element | null => {
  const { data: info } = useGameInstallInfo(gameId);
  const { devices } = useDeviceContext();
  const updateGame = useUpdateGame();

  if (!info) return null;

  const handleChooseAnother = async (): Promise<void> => {
    const path = await window.api.dialog.pickExecutable();
    if (!path) return;
    try {
      await updateGame.mutateAsync({ id: gameId, patch: { executablePath: path } });
    } catch (error) {
      toast.error(`Couldn't change the executable: ${(error as Error).message}`);
    }
  };

  const showInstalledOn = shouldShowInstalledOn(info.installedOn, devices.length);
  if (info.executable !== 'missing' && !showInstalledOn) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {info.executable === 'missing' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-[#e3b24a]">
          <span className="flex items-center gap-2">
            <AlertTriangle size={13} className="flex-none" />
            The executable is no longer at this path
          </span>
          <button
            type="button"
            onClick={() => void handleChooseAnother()}
            disabled={updateGame.isPending}
            className="rounded-[8px] border border-input bg-white/[0.04] px-2.5 py-1 text-[12px] font-bold text-foreground transition-colors duration-150 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            Choose another…
          </button>
        </div>
      )}

      {showInstalledOn && (
        <div className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
          <HardDrive size={13} className="mt-0.5 flex-none" />
          <span>
            Installed on:{' '}
            <span className="font-semibold text-foreground">
              {info.installedOn
                .map((install) =>
                  install.isThisDevice ? `${install.deviceName} (this PC)` : install.deviceName,
                )
                .join(', ')}
            </span>
          </span>
        </div>
      )}
    </div>
  );
};
