import { useState } from 'react';
import { AddGameModal } from '../components/library/AddGameModal';
import { ActionBar } from '../components/library/detail/ActionBar';
import { ChangeCoverModal } from '../components/library/detail/ChangeCoverModal';
import { DeleteGameDialog } from '../components/library/detail/DeleteGameDialog';
import { DetailsCard } from '../components/library/detail/DetailsCard';
import { EndlessBadge } from '../components/library/detail/EndlessBadge';
import { HeroBanner } from '../components/library/detail/HeroBanner';
import { HistoryList } from '../components/library/detail/HistoryList';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import { MetricsRow } from '../components/library/detail/MetricsRow';
import { NotesSection } from '../components/library/detail/NotesSection';
import { PlaythroughPanel } from '../components/library/detail/PlaythroughPanel';
import { ScreenshotsCarousel } from '../components/library/detail/ScreenshotsCarousel';
import { SessionHistoryList } from '../components/library/detail/SessionHistoryList';
import { StatusCard } from '../components/library/detail/StatusCard';
import { EditGameModal } from '../components/library/EditGameModal';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import { useGame } from '../hooks/games';
import { lastIteration } from '../lib/iterations';

type GameDetailProps = {
  gameId: number;
  onBack: () => void;
};

export const GameDetail = ({ gameId, onBack }: GameDetailProps): React.JSX.Element => {
  const { data: game, isLoading, isError } = useGame(gameId);
  const [editOpen, setEditOpen] = useState(false);
  const [changeCoverOpen, setChangeCoverOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addGameOpen, setAddGameOpen] = useState(false);

  // Qué playthrough está eligiendo el dropdown de PlaythroughPanel — vive
  // aquí (no dentro de ese componente) porque HowLongToBeatCard también lo
  // necesita, para mover su marcador al cambiar de playthrough. La más
  // reciente = la última creada (getGameById ordena las iteraciones por id
  // ascendente).
  const newestId = lastIteration(game?.iterations ?? [])?.id;
  const [selectedIterationId, setSelectedIterationId] = useState<number | null>(newestId ?? null);
  // Al entrar se muestra la más reciente, y si aparece una nueva (p.ej. el
  // watcher creó un playthrough con el detalle abierto) la selección salta a
  // ella. Patrón de "ajustar estado durante el render" (compatible con React
  // Compiler, sin useEffect). Elegir a mano una anterior en el dropdown se
  // respeta: eso no cambia `newestId`, así que no se reajusta.
  const [seenNewestId, setSeenNewestId] = useState(newestId);
  if (newestId !== seenNewestId) {
    setSeenNewestId(newestId);
    setSelectedIterationId(newestId ?? null);
  }

  if (isLoading || isError || !game) {
    return (
      <QueryStatePlaceholder
        isLoading={isLoading}
        errorText="Couldn't load this game."
        backLabel="Back to library"
        onBack={onBack}
      />
    );
  }

  const allSessions = game.iterations
    .flatMap((iteration) => iteration.sessions)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const liveSession = allSessions.find((session) => session.endedAt === null);
  const selectedIteration =
    game.iterations.find((it) => it.id === selectedIterationId) ?? lastIteration(game.iterations);

  return (
    <div className="h-full overflow-y-auto">
      <HeroBanner
        game={game}
        liveSince={liveSession?.startedAt ?? null}
        onBack={onBack}
        onAddGame={() => setAddGameOpen(true)}
      />

      <div className="mx-auto max-w-345 px-7.5 pt-6 pb-15">
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">
            <ActionBar
              game={game}
              liveSessionId={liveSession?.id ?? null}
              onEdit={() => setEditOpen(true)}
              onChangeCover={() => setChangeCoverOpen(true)}
              onDelete={() => setDeleteOpen(true)}
            />

            <div className="mt-6">
              <MetricsRow game={game} liveSince={liveSession?.startedAt ?? null} />
            </div>

            <NotesSection notes={game.notes} />
            <ScreenshotsCarousel igdbId={game.igdbId} />

            <div className="mt-7.5 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4.5">
              <StatusCard game={game} />
              <HistoryList
                stateHistory={game.stateHistory}
                spendHistory={game.spendHistory}
                addedAt={game.addedAt}
              />
            </div>

            <SessionHistoryList sessions={allSessions} gameId={gameId} />
          </div>

          <div className="flex w-92 min-w-70 flex-none flex-col gap-4.5">
            <HowLongToBeatCard
              game={game}
              markerHours={
                game.endless ? game.totalHours : (selectedIteration?.hours ?? game.totalHours)
              }
              markerScope={game.endless ? 'total' : 'playthrough'}
            />
            {game.endless ? (
              <EndlessBadge />
            ) : (
              selectedIteration && (
                <PlaythroughPanel
                  game={game}
                  selectedIteration={selectedIteration}
                  onSelectIteration={setSelectedIterationId}
                />
              )
            )}
            <DetailsCard game={game} />
          </div>
        </div>
      </div>

      <EditGameModal game={game} open={editOpen} onOpenChange={setEditOpen} />
      <AddGameModal open={addGameOpen} onOpenChange={setAddGameOpen} />
      <ChangeCoverModal game={game} open={changeCoverOpen} onOpenChange={setChangeCoverOpen} />
      <DeleteGameDialog
        game={game}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onBack}
      />
    </div>
  );
};
