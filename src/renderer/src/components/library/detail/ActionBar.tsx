import {
  AlertTriangle,
  BookmarkPlus,
  FolderOpen,
  ImagePlus,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { GameDetail, Session } from '../../../../../shared/types';
import { useDeviceContext } from '../../../hooks/devices';
import { useRefreshGame } from '../../../hooks/useRefreshGame';
import { useLaunchExecutable, useOpenInstallDirectory } from '../../../hooks/games';
import { useCloseSession, useStartGameSession } from '../../../hooks/sessions';
import {
  accentGradientStyle,
  destructiveIconButtonClass,
  heroCtaButtonClass,
  squareIconButtonClass,
} from '../../../lib/styles';
import { canStopLiveSession } from '../../../../../shared/liveSession';
import { PlayingOnNotice } from '../../sessions/RemoteLive';
import { AddSpendPopover } from './AddSpendPopover';
import { InstallNotice } from './InstallNotice';
import type { SessionId } from '../../../../../shared/entityIds';

type ActionBarProps = {
  game: GameDetail;
  // La sesión abierta de ESTE PC: la que Stop cierra y la que apaga Play.
  ownLiveSessionId: SessionId | null;
  // Una sesión abierta de OTRO dispositivo (§10.8): "Playing on PC-A", sin
  // Stop (solo su dueño la cierra) salvo que sea un cronómetro. No impide
  // Play: dos PCs pueden jugar el mismo juego, una sesión por PC (§10.4).
  remoteLiveSession: Session | null;
  onEdit: () => void;
  onChangeCover: () => void;
  onDelete: () => void;
  movingToPlan: boolean;
  onMoveToPlan: () => void;
};

// Nombre propio (no "outlineButtonClass"): ese nombre ya lo exporta
// lib/styles.ts con un estilo distinto (Sessions/GameStats) — tenerlos
// iguales de nombre pero distintos de contenido hacía que el botón Edit de
// aquí se viera distinto a cualquier otro "outline" de la app sin que se
// notara por qué (colisión de nombre real, encontrada en auditoría).
const editButtonClass =
  'flex items-center gap-2 rounded-[11px] border border-line-strong bg-raised px-4.5 text-[14px] font-semibold text-foreground hover:bg-raised-hover';

// describeRefresh y el gesto entero viven en components/RefreshGameButton.tsx
// desde que las filas del Plan ofrecen el mismo botón: los planeados no
// tienen ficha, así que no pueden llegar a esta barra.

// SPEC 10.7 — Play/Stop (según haya sesión activa), Edit, Añadir gasto,
// Cambiar carátula/hero, Delete. El prototipo solo tiene Play/Edit/Delete —
// Add spend y Change cover se añaden con el mismo lenguaje visual (Edit =
// outline neutro, Delete = cuadrado rojo) por indicación explícita, ya que
// no existían todavía cuando se hizo el prototipo.
export const ActionBar = ({
  game,
  ownLiveSessionId,
  remoteLiveSession,
  onEdit,
  onChangeCover,
  onDelete,
  movingToPlan,
  onMoveToPlan,
}: ActionBarProps): React.JSX.Element => {
  const closeSession = useCloseSession();
  const startGameSession = useStartGameSession();
  const launchExecutable = useLaunchExecutable();
  const openInstallDirectory = useOpenInstallDirectory();
  const { refresh: handleRefreshEverything, refreshing } = useRefreshGame(game.id, game.title);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [dirError, setDirError] = useState<string | null>(null);
  const { thisDeviceId, nameOf } = useDeviceContext();
  const isLive = ownLiveSessionId !== null;
  const isBusy = closeSession.isPending || startGameSession.isPending || launchExecutable.isPending;
  // "Play" solo con instalación en ESTE dispositivo (§11.4): game.executablePath
  // es el de la instalación local, sin ella es null.
  const canPlay = isLive || game.executablePath !== null;
  const remoteStop =
    remoteLiveSession !== null && canStopLiveSession(remoteLiveSession, thisDeviceId);

  const handleOpenInstallDirectory = async (): Promise<void> => {
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

  const handleTogglePlay = async (): Promise<void> => {
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
    // arranque él solo) decide qué playthrough usar/crear y ancla su inicio
    // — toda la lógica que antes vivía aquí a mano, repartida en 2-3
    // mutations sueltas (no atómicas entre sí, y que además marcaban la
    // sesión como manual: un Play que lanza el .exe de verdad es tan
    // automático como lo que detecta el watcher, y debe contar igual).
    await startGameSession.mutateAsync(game.id);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={handleTogglePlay}
          disabled={isBusy || !canPlay}
          title={
            canPlay
              ? undefined
              : game.isEmulated
                ? 'Emulated games start from their emulator'
                : 'Not installed on this PC'
          }
          className={`${heroCtaButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
          style={
            isLive
              ? {
                  background: 'rgba(255,179,71,.14)',
                  color: '#ffb347',
                  border: '1px solid rgba(255,179,71,.5)',
                }
              : {
                  ...accentGradientStyle,
                  border: '1px solid transparent',
                }
          }
        >
          {isLive ? <Pause size={16} fill="#ffb347" /> : <Play size={16} fill="#1a1100" />}
          <span>{isLive ? 'Stop' : launchExecutable.isPending ? 'Launching…' : 'Play'}</span>
        </button>

        <button type="button" onClick={onEdit} className={`${editButtonClass} py-3`}>
          <Pencil size={16} />
          Edit
        </button>

        {game.canMoveToPlan && (
          <button
            type="button"
            onClick={onMoveToPlan}
            disabled={movingToPlan}
            className={`${editButtonClass} py-3 disabled:cursor-wait disabled:opacity-60`}
          >
            <BookmarkPlus size={16} />
            {movingToPlan ? 'Moving…' : 'Move to Plan'}
          </button>
        )}

        <AddSpendPopover gameId={game.id} />

        <button
          type="button"
          onClick={onChangeCover}
          title="Change cover / hero"
          className={squareIconButtonClass}
        >
          <ImagePlus size={17} />
        </button>

        <button
          type="button"
          onClick={handleOpenInstallDirectory}
          disabled={!game.installDirectory || openInstallDirectory.isPending}
          title={game.installDirectory ? 'Open install folder' : 'No install folder set (Edit)'}
          className={`${squareIconButtonClass} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-raised`}
        >
          <FolderOpen size={17} />
        </button>

        {/* Actualizar este juego ENTERO — lo que cada card refresca por su
            cuenta (notas de IGDB, HowLongToBeat, logros) más lo que hasta
            ahora no tenía botón por juego en ninguna parte: el appid de Steam
            y, con él, sus etiquetas y sus reseñas. Aquí y no dentro de una
            card porque no es de ninguna: es del juego. */}
        <button
          type="button"
          onClick={handleRefreshEverything}
          disabled={refreshing}
          title="Refresh everything for this game — ratings, how long to beat, Steam tags and achievements"
          aria-label="Refresh everything for this game"
          className={`${squareIconButtonClass} disabled:cursor-default disabled:opacity-60 disabled:hover:bg-raised`}
        >
          <RefreshCw size={17} className={refreshing ? 'animate-spin' : undefined} />
        </button>

        <button
          type="button"
          onClick={onDelete}
          title="Delete game"
          className={destructiveIconButtonClass}
        >
          <Trash2 size={17} className="text-destructive" />
        </button>
      </div>

      {remoteLiveSession !== null && (
        <PlayingOnNotice
          deviceName={nameOf(remoteLiveSession.deviceId)}
          session={remoteLiveSession}
          // Solo un cronómetro se para desde otro PC; sessions:close cierra con
          // closedBy 'user', que es lo que la regla de la puerta admite.
          onStop={
            remoteStop
              ? () =>
                  void closeSession.mutateAsync({
                    id: remoteLiveSession.id,
                    endedAt: new Date(),
                  })
              : undefined
          }
          stopping={closeSession.isPending}
        />
      )}

      <InstallNotice gameId={game.id} />

      {launchError && (
        <div className="flex items-center gap-2 text-[12.5px] text-destructive">
          <AlertTriangle size={13} className="flex-none" />
          {launchError}
        </div>
      )}

      {dirError && (
        <div className="flex items-center gap-2 text-[12.5px] text-destructive">
          <AlertTriangle size={13} className="flex-none" />
          {dirError}
        </div>
      )}
    </div>
  );
};
