import { ArrowRight, ImagePlus, NotebookPen, Pin, PinOff, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AchievementsSection } from '../components/library/detail/AchievementsSection';
import { ChangeCoverModal } from '../components/library/detail/ChangeCoverModal';
import { DeleteGameDialog } from '../components/library/detail/DeleteGameDialog';
import { AboutCard } from '../components/library/detail/AboutCard';
import {
  DetailLayout,
  DetailMeta,
  DetailStatus,
  HeaderUtilityButton,
} from '../components/library/detail/DetailHeader';
import { SagaSection } from '../components/library/detail/SagaSection';
import { DetailsCard } from '../components/library/detail/DetailsCard';
import { RatingsCard } from '../components/library/detail/RatingsCard';
import { EditNotesModal } from '../components/library/detail/EditNotesModal';
import { HistoryList } from '../components/library/detail/HistoryList';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { NotesSection } from '../components/library/detail/NotesSection';
import { PlannedPanel } from '../components/library/detail/PlannedPanel';
import { ScreenshotsCarousel } from '../components/library/detail/ScreenshotsCarousel';
import { AddGameModal } from '../components/library/AddGameModal';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { primaryButtonClass, secondaryButtonClass } from '../components/shell/controls';
import type { TabItem } from '../components/ui/tabs';
import { useGameAchievements } from '../hooks/achievements';
import { useGame, useSetPlanPinned } from '../hooks/games';
import { useRefreshGame } from '../hooks/useRefreshGame';
import type { GameDetail as GameDetailData } from '../../../shared/types';
import type { GameId } from '../../../shared/entityIds';

type PlanGameDetailProps = {
  gameId: GameId;
  onBack: () => void;
  // Tras pasar el juego a la biblioteca: su ficha ya no vive en /plan.
  onPromoted: () => void;
};

type PlanTab = 'overview' | 'achievements' | 'notes';

// Ficha de un juego de Plan to Play — la misma estructura que la de un juego
// normal (banner, cabecera compacta, pestañas) quitando lo que un planeado no
// tiene por definición: ni cifras, ni estado, ni sesiones, ni playthroughs, ni
// partidas guardadas. Play se sustituye por "Add to library", que abre el
// modal normal de Add Game prellenado (modo promote).
export const PlanGameDetail = ({
  gameId,
  onBack,
  onPromoted,
}: PlanGameDetailProps): React.JSX.Element => {
  const { data: game, isLoading, isError } = useGame(gameId);
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
  return <PlanGameDetailView key={game.id} game={game} onBack={onBack} onPromoted={onPromoted} />;
};

const PlanGameDetailView = ({
  game,
  onBack,
  onPromoted,
}: {
  game: GameDetailData;
  onBack: () => void;
  onPromoted: () => void;
}): React.JSX.Element => {
  const setPinned = useSetPlanPinned();
  const refreshGame = useRefreshGame(game.id, game.title);
  const { data: achievements } = useGameAchievements(game.id);
  const [tab, setTab] = useState<PlanTab>('overview');
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [changeCoverOpen, setChangeCoverOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editNotesOpen, setEditNotesOpen] = useState(false);

  const unlocked = achievements?.entries.filter((entry) => entry.unlockedAt !== null).length ?? 0;
  const tabs: TabItem<PlanTab>[] = [
    { key: 'overview', label: 'Overview' },
    {
      key: 'achievements',
      label: 'Achievements',
      count: achievements?.entries.length ? `${unlocked}/${achievements.entries.length}` : null,
    },
    { key: 'notes', label: 'Notes' },
  ];

  const togglePinned = (): void => {
    const next = !game.planPinnedAt;
    setPinned.mutate(
      { id: game.id, pinned: next },
      {
        onSuccess: () => toast.success(next ? 'Pinned to Up next' : 'Removed from Up next'),
        onError: () => toast.error("Couldn't update Up next."),
      },
    );
  };

  return (
    <DetailLayout
      game={game}
      tabs={tabs}
      tab={tab}
      onTabChange={setTab}
      bannerTab="overview"
      status={<DetailStatus game={game} />}
      meta={<DetailMeta game={game} />}
      actions={(compact) => {
        const size = compact ? 'h-9 px-4 text-body' : 'h-11 px-5 text-lead';
        return (
          <>
            <button
              type="button"
              onClick={() => setPromoteOpen(true)}
              className={cn(primaryButtonClass, size)}
            >
              Add to library
              <ArrowRight size={compact ? 14 : 16} />
            </button>
            {/* "Up next" (PLAN-TO-PLAY.md §2.2) también desde la ficha: el
                estado del botón ES la respuesta a "¿está en Up next?", así que
                va encendido (Tube, el color del Plan) mientras está fijado. */}
            <button
              type="button"
              onClick={togglePinned}
              disabled={setPinned.isPending}
              aria-pressed={Boolean(game.planPinnedAt)}
              title={game.planPinnedAt ? 'Remove from Up next' : 'Pin to Up next'}
              className={cn(
                secondaryButtonClass,
                size,
                game.planPinnedAt && 'border-tube/55 bg-tube/10 text-tube hover:border-tube',
              )}
            >
              {game.planPinnedAt ? (
                <PinOff size={compact ? 14 : 16} />
              ) : (
                <Pin size={compact ? 14 : 16} />
              )}
              {game.planPinnedAt ? 'Up next' : 'Pin to Up next'}
            </button>
            <button
              type="button"
              onClick={() => setEditNotesOpen(true)}
              title="Edit notes"
              className={cn(secondaryButtonClass, size)}
            >
              <NotebookPen size={compact ? 14 : 16} />
              Notes
            </button>
          </>
        );
      }}
      utilities={
        <>
          <HeaderUtilityButton
            icon={ImagePlus}
            label="Change cover / hero"
            onClick={() => setChangeCoverOpen(true)}
          />
          {/* Un planeado es justo el juego cuyos datos envejecen solos — sale,
              estrena fecha, acumula reseñas y entra por fin en Steam. */}
          <HeaderUtilityButton
            icon={RefreshCw}
            label="Refresh everything for this game"
            title="Refresh everything for this game — ratings, how long to beat, Steam tags and achievements"
            onClick={refreshGame.refresh}
            disabled={refreshGame.refreshing}
            spinning={refreshGame.refreshing}
          />
          <HeaderUtilityButton
            icon={Trash2}
            label="Delete game"
            onClick={() => setDeleteOpen(true)}
            danger
          />
        </>
      }
      overlays={
        <>
          {/* Montado solo al abrirse — el prellenado del modo promote vive en
              los inicializadores de estado del modal. */}
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
        </>
      }
    >
      {tab === 'overview' && (
        <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-9">
            {/* Arriba y abierta, al revés que en la biblioteca: aquí el juego
                no lo has jugado, y la sinopsis contesta "qué era esto que
                apunté hace ocho meses". */}
            <AboutCard game={game} />
            <NotesSection notes={game.notes} onEdit={() => setEditNotesOpen(true)} />
            {game.igdbId !== null && <ScreenshotsCarousel igdbId={game.igdbId} />}
            {/* Ver que el 1 y el 2 los tienes terminados es justo el contexto
                que decide si este sube en la lista. */}
            <SagaSection game={game} />
            <HistoryList
              stateHistory={game.stateHistory}
              spendHistory={game.spendHistory}
              planHistory={game.planHistory}
            />
          </div>
          <aside className="flex min-w-0 flex-col gap-8">
            <PlannedPanel game={game} />
            <HowLongToBeatCard game={game} markerHours={0} markerScope="total" />
            {/* Cuánto dura y si vale la pena, una debajo de la otra, ANTES de
                comprometerte a jugarlo. */}
            <RatingsCard game={game} />
            <DetailsCard game={game} />
          </aside>
        </div>
      )}

      {/* Sí, también en un planeado: el catálogo de Steam responde tengas el
          juego o no. */}
      {tab === 'achievements' &&
        (achievements && achievements.entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-5 py-6 text-body text-dust">
            No achievements found for this game.
          </p>
        ) : (
          <AchievementsSection gameId={game.id} />
        ))}

      {tab === 'notes' && (
        <div className="max-w-240">
          <NotesSection notes={game.notes} onEdit={() => setEditNotesOpen(true)} variant="full" />
        </div>
      )}
    </DetailLayout>
  );
};
