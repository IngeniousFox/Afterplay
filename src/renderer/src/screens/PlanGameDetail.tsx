import { ArrowRight, ImagePlus, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AchievementsSection } from '../components/library/detail/AchievementsSection';
import { ChangeCoverModal } from '../components/library/detail/ChangeCoverModal';
import { DeleteGameDialog } from '../components/library/detail/DeleteGameDialog';
import { AboutCard } from '../components/library/detail/AboutCard';
import { SagaSection } from '../components/library/detail/SagaSection';
import { DetailsCard } from '../components/library/detail/DetailsCard';
import { RatingsCard } from '../components/library/detail/RatingsCard';
import { EditNotesModal } from '../components/library/detail/EditNotesModal';
import { HeroBanner } from '../components/library/detail/HeroBanner';
import { HistoryList } from '../components/library/detail/HistoryList';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { NotesSection } from '../components/library/detail/NotesSection';
import { PlannedPanel } from '../components/library/detail/PlannedPanel';
import { ScreenshotsCarousel } from '../components/library/detail/ScreenshotsCarousel';
import { AddGameModal } from '../components/library/AddGameModal';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { useGame, useSetPlanPinned } from '../hooks/games';
import { STATUS_META } from '../lib/gameStatus';
import {
  accentGradientStyle,
  destructiveIconButtonClass,
  heroCtaButtonClass,
  revealClass,
  revealStyle,
  squareIconButtonClass,
} from '../lib/styles';

const PLAN_COLOR = STATUS_META.plan.color;

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
  const setPinned = useSetPlanPinned();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [addPlannedOpen, setAddPlannedOpen] = useState(false);
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
      <HeroBanner
        game={game}
        liveSince={null}
        onBack={onBack}
        backLabel="Back to plan"
        onAddGame={() => setAddPlannedOpen(true)}
        addGameLabel="Plan a game"
      />

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
                className={heroCtaButtonClass}
                style={{
                  ...accentGradientStyle,
                  border: '1px solid transparent',
                }}
              >
                <span>Add to library</span>
                <ArrowRight size={16} />
              </button>

              {/* "Up next" (PLAN-TO-PLAY.md §2.2) también desde la ficha —
                  hasta ahora solo se podía fijar desde la fila de la lista, y
                  la ficha es justo donde uno acaba de decidir "este va el
                  primero". Mismo lenguaje que su gemelo en PlanRow: tintado y
                  ENCENDIDO siempre que está fijado (no solo al pasar el
                  ratón, a diferencia del resto de botones cuadrados de esta
                  fila) — el estado del botón ES la respuesta a "¿está en Up
                  next?", no hace falta ir a mirar la lista. */}
              <button
                type="button"
                onClick={() => {
                  const next = !game.planPinnedAt;
                  setPinned.mutate(
                    { id: game.id, pinned: next },
                    {
                      onSuccess: () =>
                        toast.success(next ? 'Pinned to Up next' : 'Removed from Up next'),
                      onError: () => toast.error("Couldn't update Up next."),
                    },
                  );
                }}
                disabled={setPinned.isPending}
                title={game.planPinnedAt ? 'Remove from Up next' : 'Pin to Up next'}
                className={squareIconButtonClass}
                style={
                  game.planPinnedAt
                    ? {
                        color: PLAN_COLOR,
                        borderColor: `${PLAN_COLOR}47`,
                        background: `${PLAN_COLOR}1c`,
                      }
                    : undefined
                }
              >
                {game.planPinnedAt ? <PinOff size={17} /> : <Pin size={17} />}
              </button>

              <button
                type="button"
                onClick={() => setChangeCoverOpen(true)}
                title="Change cover / hero"
                className={squareIconButtonClass}
              >
                <ImagePlus size={17} />
              </button>

              <button
                type="button"
                onClick={() => setEditNotesOpen(true)}
                title="Edit notes"
                className={squareIconButtonClass}
              >
                <Pencil size={17} />
              </button>

              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                title="Delete game"
                className={destructiveIconButtonClass}
              >
                <Trash2 size={17} className="text-destructive" />
              </button>
            </div>

            {/* Arriba y abierta, al reves que en la biblioteca: aqui el
                juego no lo has jugado, y esta es la que contesta "que era
                esto que apunte hace ocho meses". Es la primera pregunta de
                la ficha de un planeado, no una nota al pie. */}
            <div className={`mt-5 ${revealClass}`} style={revealStyle(1)}>
              <AboutCard game={game} />
            </div>

            <div className={revealClass} style={revealStyle(2)}>
              <NotesSection notes={game.notes} onEdit={() => setEditNotesOpen(true)} />
            </div>
            <div className={revealClass} style={revealStyle(3)}>
              <ScreenshotsCarousel igdbId={game.igdbId} />
            </div>
            {/* Y aqui vale doble: mirando un planeado, ver que el 1 y el 2
                los tienes terminados es justo el contexto que decide si este
                sube en la lista o se queda esperando. */}
            <div className={revealClass} style={revealStyle(4)}>
              <SagaSection game={game} />
            </div>

            <div className={`mt-7.5 ${revealClass}`} style={revealStyle(4)}>
              <HistoryList stateHistory={game.stateHistory} spendHistory={game.spendHistory} />
            </div>

            {/* Sí, también en un planeado: el catálogo de Steam responde
                tengas el juego o no, así que "esto tiene 34 logros" es
                información válida de algo que aún no has jugado. */}
            <div className={revealClass} style={revealStyle(5)}>
              <AchievementsSection gameId={gameId} />
            </div>
          </div>

          <div className="flex w-92 min-w-70 flex-none flex-col gap-4.5">
            <div className={revealClass} style={revealStyle(1)}>
              <PlannedPanel game={game} />
            </div>
            <div className={revealClass} style={revealStyle(2)}>
              <HowLongToBeatCard game={game} markerHours={0} markerScope="total" />
            </div>
            {/* En un planeado, las notas son directamente material de
                decisión: cuánto dura y si vale la pena, una debajo de la
                otra, ANTES de comprometerte a jugarlo. */}
            <div className={revealClass} style={revealStyle(3)}>
              <RatingsCard game={game} />
            </div>
            <div className={revealClass} style={revealStyle(4)}>
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
      {/* Alta desde la propia ficha, en modo 'plan': lo que se añade aquí
          nace planeado, igual que el botón de la lista — desde Plan to Play
          no se entra nunca a la biblioteca por la puerta de atrás.
          onCreated con un toast y no una navegación (a diferencia de
          GameListScreen, que sí navega a la ficha nueva): aquí el usuario
          está viendo OTRO juego planeado, y llevárselo de golpe al que
          acaba de añadir sería más confuso que útil. Sin ningún onCreated
          antes, el modal se cerraba sin dejar ni rastro de que el alta
          hubiera funcionado — había que ir a /plan a comprobarlo a ciegas. */}
      <AddGameModal
        open={addPlannedOpen}
        onOpenChange={setAddPlannedOpen}
        mode="plan"
        onCreated={() => toast.success('Added to your Plan to play')}
      />
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
