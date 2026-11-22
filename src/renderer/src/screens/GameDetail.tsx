import { AlertTriangle, Trophy } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { AchievementsSection } from '../components/library/detail/AchievementsSection';
import {
  GameActionErrors,
  GameHeaderActions,
  GameUtilities,
  OwnLivePill,
  RemoteLivePill,
} from '../components/library/detail/ActionBar';
import {
  useGameActions,
  useNotInstalledHere,
  useRemoteStop,
} from '../components/library/detail/useGameActions';
import { ChangeCoverModal } from '../components/library/detail/ChangeCoverModal';
import { ConcurrentPlaythroughsNotice } from '../components/library/detail/ConcurrentPlaythroughsNotice';
import { DeleteGameDialog } from '../components/library/detail/DeleteGameDialog';
import { AboutCard } from '../components/library/detail/AboutCard';
import {
  DetailLayout,
  DetailMeta,
  DetailStatus,
  MetaSeparator,
} from '../components/library/detail/DetailHeader';
import { SagaSection } from '../components/library/detail/SagaSection';
import { DetailsCard } from '../components/library/detail/DetailsCard';
import { EditNotesModal } from '../components/library/detail/EditNotesModal';
import { EndlessBadge } from '../components/library/detail/EndlessBadge';
import { HistoryList } from '../components/library/detail/HistoryList';
import { HowLongToBeatCard } from '../components/library/detail/HowLongToBeatCard';
import {
  ExecutableMissingNotice,
  InstalledOnPanel,
} from '../components/library/detail/InstallNotice';
import { MetricsRow } from '../components/library/detail/MetricsRow';
import { NotesSection, SessionNotesList } from '../components/library/detail/NotesSection';
import { PlaythroughPanel } from '../components/library/detail/PlaythroughPanel';
import { RatingsCard } from '../components/library/detail/RatingsCard';
import { SavesSection } from '../components/library/detail/SavesSection';
import { ScreenshotsCarousel } from '../components/library/detail/ScreenshotsCarousel';
import { RecentSessions, SessionsTab } from '../components/library/detail/SessionHistoryList';
import { StatusCard } from '../components/library/detail/StatusCard';
import { EditGameModal } from '../components/library/EditGameModal';
import { QueryStatePlaceholder } from '../components/layout/QueryStatePlaceholder';
import type { TabItem } from '../components/ui/tabs';
import { useGameAchievements } from '../hooks/achievements';
import { useDeviceContext } from '../hooks/devices';
import { useGame, useMoveToPlan } from '../hooks/games';
import { useGameSaves, useSavesStatus } from '../hooks/saves';
import { getPendingSessionFlash, subscribeSessionFlash } from '../hooks/useSessionClosedToast';
import { getPendingAchievementFlash, subscribeAchievementFlash } from '../lib/achievementFlash';
import { lastIteration } from '../lib/iterations';
import { isOwnLiveSession } from '../../../shared/liveSession';
import type { GameDetail as GameDetailData, SaveSyncState } from '../../../shared/types';
import type { GameId, IterationId } from '../../../shared/entityIds';

type GameDetailProps = {
  gameId: GameId;
  onBack: () => void;
  onMovedToPlan: () => void;
};

type DetailTab = 'overview' | 'sessions' | 'achievements' | 'saves' | 'notes';

// El punto de atención de la pestaña Saves (README-ficha.md): ámbar con cambios
// sin copiar, Tube si hay una versión más nueva o disponible, Live si
// divergieron. El resto de estados no piden nada.
const SAVES_ATTENTION: Partial<
  Record<SaveSyncState['status'], { className: string; label: string }>
> = {
  'local-changes': {
    className: 'bg-phosphor shadow-[0_0_8px_rgb(255_179_71/0.7)]',
    label: 'Saves have changes that are not backed up',
  },
  behind: {
    className: 'bg-tube shadow-[0_0_8px_rgb(95_211_224/0.7)]',
    label: 'A newer save is available',
  },
  available: {
    className: 'bg-tube shadow-[0_0_8px_rgb(95_211_224/0.7)]',
    label: 'A save from another PC is available',
  },
  diverged: {
    className: 'bg-live shadow-[0_0_8px_rgb(255_94_87/0.7)]',
    label: 'Saves have gone different ways',
  },
};

export const GameDetail = ({
  gameId,
  onBack,
  onMovedToPlan,
}: GameDetailProps): React.JSX.Element => {
  const { data: game, isLoading, isError } = useGame(gameId);
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
  return <GameDetailView key={game.id} game={game} onBack={onBack} onMovedToPlan={onMovedToPlan} />;
};

const GameDetailView = ({
  game,
  onBack,
  onMovedToPlan,
}: {
  game: GameDetailData;
  onBack: () => void;
  onMovedToPlan: () => void;
}): React.JSX.Element => {
  const gameId = game.id;
  const moveToPlan = useMoveToPlan();
  const { thisDeviceId, nameOf } = useDeviceContext();
  const [editOpen, setEditOpen] = useState(false);
  const [changeCoverOpen, setChangeCoverOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editNotesOpen, setEditNotesOpen] = useState(false);

  // Los aterrizajes (lib/achievementFlash, useSessionClosedToast): un trofeo
  // pulsado lleva a la pestaña Achievements y el aviso de cierre de sesión a
  // Sessions. Se lee como valor externo y la pestaña se ajusta durante el
  // render cuando llega una petición nueva.
  const pendingAchievement = useSyncExternalStore(
    subscribeAchievementFlash,
    getPendingAchievementFlash,
  );
  const pendingSession = useSyncExternalStore(subscribeSessionFlash, getPendingSessionFlash);
  const sessionIsMine =
    pendingSession !== null &&
    game.iterations.some((iteration) => iteration.sessions.some((s) => s.id === pendingSession));
  const [tab, setTab] = useState<DetailTab>(
    pendingAchievement !== null ? 'achievements' : sessionIsMine ? 'sessions' : 'overview',
  );
  const [seenAchievement, setSeenAchievement] = useState(pendingAchievement);
  if (pendingAchievement !== seenAchievement) {
    setSeenAchievement(pendingAchievement);
    if (pendingAchievement !== null) setTab('achievements');
  }
  const [seenSession, setSeenSession] = useState(sessionIsMine ? pendingSession : null);
  if (sessionIsMine && pendingSession !== seenSession) {
    setSeenSession(pendingSession);
    setTab('sessions');
  }

  // Qué playthrough está eligiendo el dropdown de PlaythroughPanel — vive
  // aquí porque HowLongToBeatCard también lo necesita, para mover su marcador
  // al cambiar de playthrough. Si aparece uno nuevo (el watcher lo creó con la
  // ficha abierta) la selección salta a él; elegir a mano uno anterior se
  // respeta.
  const newestId = lastIteration(game.iterations)?.id;
  const [selectedIterationId, setSelectedIterationId] = useState<IterationId | null>(
    newestId ?? null,
  );
  const [seenNewestId, setSeenNewestId] = useState(newestId);
  if (newestId !== seenNewestId) {
    setSeenNewestId(newestId);
    setSelectedIterationId(newestId ?? null);
  }

  const allSessions = game.iterations
    .flatMap((iteration) => iteration.sessions)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  // Sesiones abiertas (§10.8): la de ESTE PC es la que se puede parar y la que
  // deshabilita Play; la de otro PC se pinta "Playing on PC-A". Puede haber una
  // de cada (§10.4: una por dispositivo), y entonces mandan las dos.
  const openSessions = allSessions.filter((session) => session.endedAt === null);
  const ownLiveSession = openSessions.find((s) => isOwnLiveSession(s, thisDeviceId)) ?? null;
  const remoteLiveSession = openSessions.find((s) => !isOwnLiveSession(s, thisDeviceId)) ?? null;
  const liveSession = ownLiveSession ?? remoteLiveSession;
  const selectedIteration =
    game.iterations.find((it) => it.id === selectedIterationId) ?? lastIteration(game.iterations);

  const actions = useGameActions(game, ownLiveSession?.id ?? null);
  const notInstalledHere = useNotInstalledHere(game);
  const remoteStop = useRemoteStop(remoteLiveSession, actions);

  // Las cifras de las pestañas. Las dos consultas son las mismas que piden sus
  // secciones: react-query las comparte.
  const { data: achievements } = useGameAchievements(gameId);
  const { data: savesStatus } = useSavesStatus();
  const { data: saves } = useGameSaves(gameId, Boolean(savesStatus));
  const unlocked = achievements?.entries.filter((entry) => entry.unlockedAt !== null).length ?? 0;
  const savesAttention = saves ? SAVES_ATTENTION[saves.sync.status] : undefined;

  const tabs: TabItem<DetailTab>[] = [
    { key: 'overview', label: 'Overview' },
    {
      key: 'sessions',
      label: 'Sessions',
      count: allSessions.length ? String(allSessions.length) : null,
    },
    {
      key: 'achievements',
      label: 'Achievements',
      count: achievements?.entries.length ? `${unlocked}/${achievements.entries.length}` : null,
    },
    {
      key: 'saves',
      label: 'Saves',
      count: saves?.cloud.length ? String(saves.cloud.length) : null,
      attentionClass: savesAttention?.className,
      attentionLabel: savesAttention?.label,
    },
    { key: 'notes', label: 'Notes' },
  ];

  const handleMoveToPlan = (): void => {
    void moveToPlan
      .mutateAsync(game.id)
      .then(() => {
        toast.success('Moved to Plan to Play');
        onMovedToPlan();
      })
      .catch(() => toast.error("Couldn't move this game to Plan to Play."));
  };

  const history = (
    <HistoryList
      stateHistory={game.stateHistory}
      spendHistory={game.spendHistory}
      addedAt={game.addedAt}
      planHistory={game.planHistory}
    />
  );

  return (
    <DetailLayout
      game={game}
      tabs={tabs}
      tab={tab}
      onTabChange={setTab}
      bannerTab="overview"
      status={<DetailStatus game={game} live={liveSession !== null} />}
      meta={
        <DetailMeta
          game={game}
          extra={
            notInstalledHere && (
              <>
                <MetaSeparator />
                <span className="flex items-center gap-1.5 font-semibold text-phosphor">
                  <AlertTriangle size={14} className="flex-none" />
                  Not installed on this PC
                </span>
              </>
            )
          }
        />
      }
      live={
        remoteLiveSession && !ownLiveSession ? (
          <RemoteLivePill
            session={remoteLiveSession}
            deviceName={nameOf(remoteLiveSession.deviceId)}
            compact={false}
            onStop={remoteStop}
            stopping={actions.closeSession.isPending}
          />
        ) : ownLiveSession ? (
          <OwnLivePill since={ownLiveSession.startedAt} compact={false} />
        ) : null
      }
      actions={(compact) => (
        <GameHeaderActions
          game={game}
          state={actions}
          compact={compact}
          notInstalledHere={notInstalledHere}
          onEdit={() => setEditOpen(true)}
          movingToPlan={moveToPlan.isPending}
          onMoveToPlan={handleMoveToPlan}
        />
      )}
      utilities={
        <GameUtilities
          game={game}
          state={actions}
          onChangeCover={() => setChangeCoverOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      }
      overlays={
        <>
          <EditGameModal game={game} open={editOpen} onOpenChange={setEditOpen} />
          <EditNotesModal game={game} open={editNotesOpen} onOpenChange={setEditNotesOpen} />
          <ChangeCoverModal game={game} open={changeCoverOpen} onOpenChange={setChangeCoverOpen} />
          <DeleteGameDialog
            game={game}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={onBack}
          />
        </>
      }
    >
      <GameActionErrors state={actions} />
      <ExecutableMissingNotice gameId={gameId} />
      {/* Con dos sesiones abiertas (aquí y en otro PC) la remota sigue a la
          vista aunque Stop ocupe el sitio de Play. */}
      {ownLiveSession && remoteLiveSession && (
        <div className="mb-5 flex">
          <RemoteLivePill
            session={remoteLiveSession}
            deviceName={nameOf(remoteLiveSession.deviceId)}
            compact
            onStop={remoteStop}
            stopping={actions.closeSession.isPending}
          />
        </div>
      )}

      {tab === 'overview' && (
        <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-9">
            <MetricsRow game={game} liveSince={liveSession?.startedAt ?? null} />
            <NotesSection notes={game.notes} onEdit={() => setEditNotesOpen(true)} />
            <RecentSessions sessions={allSessions} onSeeAll={() => setTab('sessions')} />
            {/* StatusCard inicializa su dropdown/nota con useState desde
                `game`: la vista entera se remonta por juego (key en
                GameDetail), así el "pending" de un juego no se pega a otro. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-6">
              <StatusCard game={game} />
              {history}
            </div>
            {/* Sin id de IGDB no hay capturas ni tráiler que pedir. */}
            {game.igdbId !== null && <ScreenshotsCarousel igdbId={game.igdbId} />}
            <SagaSection game={game} />
          </div>

          <aside className="flex min-w-0 flex-col gap-8">
            <HowLongToBeatCard
              game={game}
              markerHours={
                game.endless ? game.totalHours : (selectedIteration?.hours ?? game.totalHours)
              }
              markerScope={game.endless ? 'total' : 'playthrough'}
            />
            {/* §10.7 — solo existe cuando dos PCs abrieron cada uno su
                playthrough. */}
            <div className="empty:hidden">
              <ConcurrentPlaythroughsNotice gameId={game.id} />
            </div>
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
            <InstalledOnPanel gameId={gameId} isEmulated={game.isEmulated} />
            <RatingsCard game={game} />
            <DetailsCard game={game} />
            <AboutCard game={game} />
          </aside>
        </div>
      )}

      {tab === 'sessions' && (
        <SessionsTab gameId={gameId} iterations={game.iterations} aside={history} />
      )}

      {tab === 'achievements' &&
        (achievements && achievements.entries.length === 0 ? (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-line-strong px-5 py-6 text-body text-dust">
            <Trophy size={16} className="flex-none" />
            {game.steamAppId === null
              ? 'No achievements yet. Afterplay finds them through the game’s Steam App ID (see Details).'
              : 'No achievements found for this game.'}
          </div>
        ) : (
          <AchievementsSection gameId={gameId} />
        ))}

      {/* PARTIDAS-GUARDADAS.md §10.4 — el único sitio de la app desde el que
          se restaura una partida. No hay restauración automática. */}
      {tab === 'saves' && <SavesSection gameId={gameId} gameTitle={game.title} />}

      {tab === 'notes' && (
        <div className="grid items-start gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_400px]">
          <NotesSection notes={game.notes} onEdit={() => setEditNotesOpen(true)} variant="full" />
          <aside>
            <SessionNotesList sessions={allSessions} />
          </aside>
        </div>
      )}
    </DetailLayout>
  );
};
