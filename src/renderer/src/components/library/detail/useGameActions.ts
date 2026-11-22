import { useState } from 'react';
import { toast } from 'sonner';
import type { GameDetail, Session } from '../../../../../shared/types';
import { useDeviceContext } from '../../../hooks/devices';
import { useRefreshGame } from '../../../hooks/useRefreshGame';
import {
  useGameInstallInfo,
  useLaunchExecutable,
  useOpenInstallDirectory,
  useUpdateGame,
} from '../../../hooks/games';
import { useCloseSession, useStartGameSession } from '../../../hooks/sessions';
import { canStopLiveSession } from '../../../../../shared/liveSession';
import type { SessionId } from '../../../../../shared/entityIds';

// LAS ACCIONES DE LA FICHA (SPEC 10.7, AFTERPLAY-2.0.md §10 y §11.4).
//
// La cabecera las pinta dos veces (banner y banda compacta), así que el estado
// —qué se está lanzando, el último error— vive en useGameActions, por encima
// de las dos, y los botones solo lo leen.

export type GameActionsState = {
  isLive: boolean;
  isBusy: boolean;
  canPlay: boolean;
  launching: boolean;
  togglePlay: () => Promise<void>;
  openInstallFolder: () => Promise<void>;
  openingFolder: boolean;
  refresh: () => void;
  refreshing: boolean;
  linkInstallation: () => Promise<void>;
  linking: boolean;
  launchError: string | null;
  dirError: string | null;
  closeSession: ReturnType<typeof useCloseSession>;
};

export const useGameActions = (
  game: GameDetail,
  ownLiveSessionId: SessionId | null,
): GameActionsState => {
  const closeSession = useCloseSession();
  const startGameSession = useStartGameSession();
  const launchExecutable = useLaunchExecutable();
  const openInstallDirectory = useOpenInstallDirectory();
  const refreshGame = useRefreshGame(game.id, game.title);
  const updateGame = useUpdateGame();
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [dirError, setDirError] = useState<string | null>(null);
  const isLive = ownLiveSessionId !== null;
  const isBusy = closeSession.isPending || startGameSession.isPending || launchExecutable.isPending;
  // "Play" solo con instalación en ESTE dispositivo (§11.4): game.executablePath
  // es el de la instalación local, sin ella es null.
  const canPlay = isLive || game.executablePath !== null;

  const openInstallFolder = async (): Promise<void> => {
    if (!game.installDirectory) return;
    setDirError(null);
    const result = await openInstallDirectory.mutateAsync(game.id);
    if (!result.ok) {
      setDirError(
        result.reason === 'missing'
          ? 'Couldn’t find the install folder — it may have been moved or deleted. Check the path in Edit.'
          : result.reason === 'not_installed'
            ? 'This game isn’t installed on this PC.'
            : `Couldn't open the folder — ${result.message}`,
      );
    }
  };

  const togglePlay = async (): Promise<void> => {
    if (isLive && ownLiveSessionId !== null) {
      await closeSession.mutateAsync({ id: ownLiveSessionId, endedAt: new Date() });
      return;
    }

    // El botón ya está deshabilitado sin instalación local (ver canPlay) — esto
    // es cinturón y tirantes por si acaso. El main resuelve la ruta por gameId.
    if (!game.executablePath) return;

    setLaunchError(null);
    const result = await launchExecutable.mutateAsync(game.id);
    if (!result.ok) {
      // Si el .exe no arranca no hay nada que trackear — abortar ANTES de
      // abrir sesión, o quedaría una sesión "Playing" abierta para un juego
      // que en realidad no se ha abierto.
      setLaunchError(
        result.reason === 'missing'
          ? 'Couldn’t find the executable — it may have been moved or uninstalled. Check the path in Edit.'
          : result.reason === 'not_installed'
            ? 'Not installed on this PC.'
            : `Couldn't launch the game — ${result.message}`,
      );
      return;
    }

    // startGameSession (misma función que usa el watcher al detectar un
    // arranque él solo) decide qué playthrough usar/crear y ancla su inicio.
    // Un Play que lanza el .exe de verdad es tan automático como lo que
    // detecta el watcher, y debe contar igual.
    await startGameSession.mutateAsync(game.id);
  };

  // "Link installation" (§11.4): el mismo gesto que elegir el ejecutable en
  // Edit — la ruta que se guarda es la de ESTE PC.
  const linkInstallation = async (): Promise<void> => {
    const path = await window.api.dialog.pickExecutable();
    if (!path) return;
    try {
      await updateGame.mutateAsync({ id: game.id, patch: { executablePath: path } });
    } catch (error) {
      toast.error(`Couldn't link the installation: ${(error as Error).message}`);
    }
  };

  return {
    isLive,
    isBusy,
    canPlay,
    launching: launchExecutable.isPending,
    togglePlay,
    openInstallFolder,
    openingFolder: openInstallDirectory.isPending,
    refresh: refreshGame.refresh,
    refreshing: refreshGame.refreshing,
    linkInstallation,
    linking: updateGame.isPending,
    launchError,
    dirError,
    closeSession,
  };
};

// ¿Este PC no tiene el juego pero otro sí? Es la variante "sin instalación"
// de la ficha (§11.4): aviso en la cabecera y "Link installation" junto a Play.
export const useNotInstalledHere = (game: GameDetail): boolean => {
  const { data: info } = useGameInstallInfo(game.id);
  if (!info || game.isEmulated || game.executablePath !== null) return false;
  return info.installedOn.length > 0 && !info.installedOn.some((install) => install.isThisDevice);
};

// Hook pequeño para el Stop de un cronómetro remoto (solo un cronómetro se
// para desde otro PC; sessions:close cierra con closedBy 'user').
export const useRemoteStop = (
  remoteLiveSession: Session | null,
  state: GameActionsState,
): (() => void) | undefined => {
  const { thisDeviceId } = useDeviceContext();
  if (remoteLiveSession === null || !canStopLiveSession(remoteLiveSession, thisDeviceId)) {
    return undefined;
  }
  return () =>
    void state.closeSession.mutateAsync({ id: remoteLiveSession.id, endedAt: new Date() });
};
