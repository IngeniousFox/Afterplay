import { ArrowRight, ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ChangeCoverModal } from '../components/library/detail/ChangeCoverModal';
import { DeleteGameDialog } from '../components/library/detail/DeleteGameDialog';
import { DetailsCard } from '../components/library/detail/DetailsCard';
import { EditNotesModal } from '../components/library/detail/EditNotesModal';
import { HeroBanner } from '../components/library/detail/HeroBanner';
import { HistoryList } from '../components/library/detail/HistoryList';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { NotesSection } from '../components/library/detail/NotesSection';
import { PlannedPanel } from '../components/library/detail/PlannedPanel';
import { ScreenshotsCarousel } from '../components/library/detail/ScreenshotsCarousel';
import { AddGameModal } from '../components/library/AddGameModal';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { useGame } from '../hooks/games';
import { accentGradientStyle, revealClass, revealStyle } from '../lib/styles';

type PlanGameDetailProps = {
  gameId: number;
  onBack: () => void;
  // Tras pasar el juego a la biblioteca: su ficha ya no vive en /plan.
  onPromoted: () => void;
};

// Ficha de un juego de Plan to Play — la misma que la de un juego normal
// pero quitando lo que un juego planeado no tiene por definición: ni cards
// de métricas, ni StatusCard, ni sesiones, ni playthroughs. Se quedan el
// hero, las notas, las capturas, el historial (con su entrada de cuándo lo
// planeaste), el How Long to Beat y los detalles técnicos. El botón de Play
// se sustituye por "Add to library", que abre el modal normal de Add Game
// prellenado (modo promote).
export const PlanGameDetail = ({
  gameId,
  onBack,
  onPromoted,
}: PlanGameDetailProps): React.JSX.Element => {
  const { data: game, isLoading, isError } = useGame(gameId);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [changeCoverOpen, setChangeCoverOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editNotesOpen, setEditNotesOpen] = useState(false);

  if (isLoading || isError || !game) {
    return (
      <QueryStatePlaceholder
        isLoading={isLoading}
        errorText="Couldn't load this game."
        backLabel="Back to plan"
        onBack={onBack}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <HeroBanner game={game} liveSince={null} onBack={onBack} backLabel="Back to plan" />

      <div key={game.id} className="mx-auto max-w-345 px-7.5 pt-6 pb-15">
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <div
              className={`flex flex-wrap items-center gap-2.5 ${revealClass}`}
              style={revealStyle(0)}
            >
              <button
                type="button"
                onClick={() => setPromoteOpen(true)}
                className="flex items-center gap-2.25 rounded-[11px] px-7.5 py-3 text-[15px] font-bold shadow-[0_6px_18px_rgba(0,0,0,.28)]"
                style={{
                  ...accentGradientStyle,
                  border: '1px solid transparent',
                }}
              >
                <span>Add to library</span>
                <ArrowRight size={16} />
              </button>

              <button
                type="button"
                onClick={() => setChangeCoverOpen(true)}
                title="Change cover / hero"
                className="flex h-11.5 w-11.5 flex-none items-center justify-center rounded-[11px] border border-input bg-white/[0.03] hover:bg-white/[0.06]"
              >
                <ImagePlus size={17} />
              </button>

              <button
                type="button"
                onClick={() => setEditNotesOpen(true)}
                title="Edit notes"
                className="flex h-11.5 w-11.5 flex-none items-center justify-center rounded-[11px] border border-input bg-white/[0.03] hover:bg-white/[0.06]"
              >
                <Pencil size={17} />
              </button>

              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                title="Delete game"
                className="flex h-11.5 w-11.5 flex-none items-center justify-center rounded-[11px] border border-destructive/40 bg-destructive/8 hover:bg-destructive/18"
              >
                <Trash2 size={17} className="text-destructive" />
              </button>
            </div>

            <div className={revealClass} style={revealStyle(1)}>
              <NotesSection notes={game.notes} onEdit={() => setEditNotesOpen(true)} />
            </div>
            <div className={revealClass} style={revealStyle(2)}>
              <ScreenshotsCarousel igdbId={game.igdbId} />
            </div>

            <div className={`mt-7.5 ${revealClass}`} style={revealStyle(3)}>
              <HistoryList stateHistory={game.stateHistory} spendHistory={game.spendHistory} />
            </div>
          </div>

          <div className="flex w-92 min-w-70 flex-none flex-col gap-4.5">
            <div className={revealClass} style={revealStyle(1)}>
              <PlannedPanel game={game} />
            </div>
            <div className={revealClass} style={revealStyle(2)}>
              <HowLongToBeatCard game={game} markerHours={0} markerScope="total" />
            </div>
            <div className={revealClass} style={revealStyle(3)}>
              <DetailsCard game={game} />
            </div>
          </div>
        </div>
      </div>

      {/* Montado solo al abrirse — el prellenado del modo promote vive en
          los inicializadores de estado del modal, así que necesita montarse
          de cero cada vez con el juego ya cargado. */}
      {promoteOpen && (
        <AddGameModal
          open
          onOpenChange={(next) => {
            if (!next) setPromoteOpen(false);
          }}
          promoteGame={game}
          onPromoted={onPromoted}
        />
      )}
      <ChangeCoverModal game={game} open={changeCoverOpen} onOpenChange={setChangeCoverOpen} />
      <EditNotesModal game={game} open={editNotesOpen} onOpenChange={setEditNotesOpen} />
      <DeleteGameDialog
        game={game}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onBack}
      />
    </div>
  );
};
