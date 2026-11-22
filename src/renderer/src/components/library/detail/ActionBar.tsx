import {
  AlertTriangle,
  BookmarkPlus,
  FolderOpen,
  ImagePlus,
  Link2,
  Pencil,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GameDetail, Session } from '../../../../../shared/types';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { useNoSignalText } from '../../../hooks/sessionDevice';
import { formatElapsed } from '../../../lib/format';
import { liveButtonClass, primaryButtonClass, secondaryButtonClass } from '../../shell/controls';
import { GlowText } from '../../fx/GlowText';
import { PressButton } from '../../fx/PressButton';
import { Odometer } from '../../fx/Ticker';
import { AddSpendPopover } from './AddSpendPopover';
import { HeaderUtilityButton } from './DetailHeader';
import type { GameActionsState } from './useGameActions';

// Los botones de la cabecera de la ficha. El estado vive en useGameActions.

type GameHeaderActionsProps = {
  game: GameDetail;
  state: GameActionsState;
  compact: boolean;
  notInstalledHere: boolean;
  onEdit: () => void;
  movingToPlan: boolean;
  onMoveToPlan: () => void;
};

// Play (o Stop en Live con la sesión de este PC), Link installation si toca,
// Edit, Move to Plan y Add spend.
export const GameHeaderActions = ({
  game,
  state,
  compact,
  notInstalledHere,
  onEdit,
  movingToPlan,
  onMoveToPlan,
}: GameHeaderActionsProps): React.JSX.Element => {
  const size = compact ? 'h-9 px-4 text-body' : 'h-11 px-5 text-lead';
  return (
    <>
      {/* Play y Stop se hunden al pulsar y sueltan un anillo con destello:
          ámbar al encender, Live al apagar. */}
      <PressButton
        burst={state.isLive ? 'live' : 'phosphor'}
        onClick={() => void state.togglePlay()}
        disabled={state.isBusy || !state.canPlay}
        title={
          state.canPlay
            ? undefined
            : game.isEmulated
              ? 'Emulated games start from their emulator'
              : 'Not installed on this PC'
        }
        className={cn(
          state.isLive ? liveButtonClass : primaryButtonClass,
          size,
          compact ? 'min-w-24' : 'min-w-28',
          // Sin instalación: gris y sin hover, no un ámbar apagado.
          'disabled:border disabled:border-line-strong disabled:bg-raised disabled:text-dust disabled:opacity-100 disabled:hover:bg-raised',
        )}
      >
        {state.isLive ? (
          <Square size={compact ? 13 : 15} fill="currentColor" />
        ) : (
          <Play size={compact ? 14 : 16} fill="currentColor" />
        )}
        <span>{state.isLive ? 'Stop' : state.launching ? 'Launching…' : 'Play'}</span>
      </PressButton>

      {notInstalledHere && (
        <button
          type="button"
          onClick={() => void state.linkInstallation()}
          disabled={state.linking}
          title="Pick this game's executable on this PC"
          className={cn(
            secondaryButtonClass,
            size,
            'border-phosphor/55 bg-phosphor-tint text-phosphor hover:border-phosphor hover:bg-phosphor/16',
          )}
        >
          <Link2 size={compact ? 14 : 16} />
          Link installation
        </button>
      )}

      <button type="button" onClick={onEdit} className={cn(secondaryButtonClass, size)}>
        <Pencil size={compact ? 14 : 16} />
        Edit
      </button>

      {game.canMoveToPlan && (
        <button
          type="button"
          onClick={onMoveToPlan}
          disabled={movingToPlan}
          className={cn(secondaryButtonClass, size, 'disabled:cursor-wait')}
        >
          <BookmarkPlus size={compact ? 14 : 16} />
          {movingToPlan ? 'Moving…' : 'Move to Plan'}
        </button>
      )}

      <AddSpendPopover gameId={game.id} triggerClassName={cn(secondaryButtonClass, size)} />
    </>
  );
};

type GameUtilitiesProps = {
  game: GameDetail;
  state: GameActionsState;
  onChangeCover: () => void;
  onDelete: () => void;
};

// Las cuatro utilidades de icono: carátula/banner, carpeta de instalación,
// refrescar todo y borrar (que se tiñe de Live al pasar el ratón).
export const GameUtilities = ({
  game,
  state,
  onChangeCover,
  onDelete,
}: GameUtilitiesProps): React.JSX.Element => (
  <>
    <HeaderUtilityButton icon={ImagePlus} label="Change cover / hero" onClick={onChangeCover} />
    <HeaderUtilityButton
      icon={FolderOpen}
      label="Open install folder"
      title={game.installDirectory ? 'Open install folder' : 'No install folder set (Edit)'}
      onClick={() => void state.openInstallFolder()}
      disabled={!game.installDirectory || state.openingFolder}
    />
    {/* Actualizar este juego ENTERO — lo que cada card refresca por su
        cuenta (notas de IGDB, HowLongToBeat, logros) más el appid de Steam
        y, con él, sus etiquetas y sus reseñas. */}
    <HeaderUtilityButton
      icon={RefreshCw}
      label="Refresh everything for this game"
      title="Refresh everything for this game — ratings, how long to beat, Steam tags and achievements"
      onClick={state.refresh}
      disabled={state.refreshing}
      spinning={state.refreshing}
    />
    <HeaderUtilityButton icon={Trash2} label="Delete game" onClick={onDelete} danger />
  </>
);

// "Playing on Living room PC · 0:42:10" (§10.8): la sesión abierta en OTRO PC.
// No es un botón; solo un cronómetro se puede parar desde aquí ("Stop timer").
export const RemoteLivePill = ({
  session,
  deviceName,
  compact,
  onStop,
  stopping,
}: {
  session: Session;
  deviceName: string;
  compact: boolean;
  onStop?: () => void;
  stopping: boolean;
}): React.JSX.Element => {
  const elapsed = useLiveTimer(session.startedAt);
  const noSignal = useNoSignalText(session);
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-live/40 bg-live/10 pr-2 pl-3.5',
        compact ? 'min-h-9 py-1' : 'min-h-11 py-1.5',
      )}
    >
      <span className="flex items-center gap-2 text-body font-semibold text-bone">
        <span
          aria-hidden
          className={cn(
            'size-2 flex-none rounded-full',
            noSignal === null
              ? 'animate-led-live bg-live motion-reduce:animate-none'
              : 'bg-st-dropped',
          )}
        />
        Playing on {deviceName}
      </span>
      <span
        className={cn(
          'font-display leading-none font-bold text-live tabular-nums',
          compact ? 'text-[20px]' : 'text-[24px]',
        )}
      >
        {formatElapsed(elapsed)}
      </span>
      {noSignal !== null && <span className="text-small text-dust">{noSignal}</span>}
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          title="Stop this timer"
          className="flex h-7 items-center gap-1.5 rounded-sm border border-line-strong bg-raised px-2.5 text-small font-semibold text-bone transition-colors duration-150 enabled:hover:border-live/60 enabled:hover:text-live disabled:opacity-50"
        >
          <Square size={11} fill="currentColor" />
          {stopping ? 'Stopping…' : 'Stop timer'}
        </button>
      )}
    </div>
  );
};

// La sesión de ESTE PC en marcha: LED rojo y el cronómetro junto a Stop.
export const OwnLivePill = ({
  since,
  compact,
}: {
  since: Date;
  compact: boolean;
}): React.JSX.Element => {
  const elapsed = useLiveTimer(since);
  return (
    <div className="flex items-center gap-2.5 pr-1">
      <span
        aria-hidden
        className="size-2 flex-none animate-led-live rounded-full bg-live motion-reduce:animate-none"
      />
      <span className="sr-only">Playing now for</span>
      {/* El cronómetro vivo: bloom que respira y dígitos que caen al cambiar. */}
      <GlowText
        breathe
        className={cn(
          'font-display leading-none font-bold text-phosphor tabular-nums',
          compact ? 'text-[24px]' : 'text-[34px]',
        )}
      >
        <Odometer value={formatElapsed(elapsed)} />
      </GlowText>
    </div>
  );
};

// Los errores de lanzar o de abrir la carpeta, bajo la cabecera.
export const GameActionErrors = ({
  state,
}: {
  state: GameActionsState;
}): React.JSX.Element | null => {
  if (!state.launchError && !state.dirError) return null;
  return (
    <div className="mb-5 flex flex-col gap-1.5">
      {[state.launchError, state.dirError].filter(Boolean).map((message) => (
        <div key={message} className="flex items-center gap-2 text-small text-live">
          <AlertTriangle size={14} className="flex-none" />
          {message}
        </div>
      ))}
    </div>
  );
};
