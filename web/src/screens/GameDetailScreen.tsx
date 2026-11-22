import { useQuery } from '@tanstack/react-query';
import { Bookmark, ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiFailure,
  fetchAchievements,
  fetchCuriosities,
  fetchGame,
  fetchMedia,
  fetchSaga,
} from '../api';
import type { GameDetail } from '../api';
import { AchievementsSection } from '../components/detail/AchievementsSection';
import { HistorySection, SessionHistorySection } from '../components/detail/HistorySections';
import { HowLongToBeat } from '../components/detail/HowLongToBeat';
import { ScreenshotsSection, SagaSection } from '../components/detail/media';
import { EndlessBadge, PlaythroughPanel } from '../components/detail/PlaythroughPanel';
import { DetailCard, FigureCell } from '../components/detail/primitives';
import { TimerButton } from '../components/detail/TimerButton';
import {
  AboutCard,
  CuriositiesSection,
  DetailsCard,
  NotesSection,
  RatingsCard,
} from '../components/detail/sections';
import { Cover } from '../components/Cover';
import { Led, LiveDot } from '../components/Figure';
import { LiveBadge, LiveTimer } from '../components/LiveBadge';
import { ErrorState, Loading } from '../components/States';
import { useLiveSeconds } from '../hooks/useLiveSeconds';
import { cn } from '../lib/cn';
import { formatHours, formatMoney, relativeDay } from '../lib/format';
import { statusOf } from '../lib/status';
import { revealClass, statusTextClass } from '../lib/styles';

// A partir de cuántos píxeles de scroll la barra de arriba se vuelve sólida y
// enseña el título: más o menos cuando el título grande del héroe se va.
const COMPACT_AFTER = 200;

const useScrolledPast = (threshold: number): boolean => {
  const [past, setPast] = useState(() => window.scrollY > threshold);
  useEffect(() => {
    const onScroll = (): void => setPast(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return past;
};

// La barra de arriba de la ficha: atrás siempre; el título (y el punto vivo)
// aparecen al bajar, cuando el del héroe ya no se ve.
const TopBar = ({
  title,
  live,
  onBack,
}: {
  title?: string;
  live?: boolean;
  onBack: () => void;
}): React.JSX.Element => {
  const compact = useScrolledPast(COMPACT_AFTER);
  return (
    <div
      className={cn(
        'fixed inset-x-0 top-[env(safe-area-inset-top)] z-30 border-b transition-colors duration-200',
        compact ? 'border-line bg-cabinet' : 'border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-14 max-w-lg items-center gap-1 px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className={cn(
            'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-bone transition-colors duration-200',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor active:bg-bone/11',
            compact ? 'bg-transparent' : 'bg-inset/60 backdrop-blur-sm',
          )}
        >
          <ChevronLeft size={22} />
        </button>
        <span
          aria-hidden={!compact}
          className={cn(
            'min-w-0 flex-1 truncate text-body font-semibold text-bone transition-opacity duration-200',
            compact ? 'opacity-100' : 'opacity-0',
          )}
        >
          {title}
        </span>
        {live && compact && <LiveDot className="mr-3" />}
      </div>
    </div>
  );
};

// La fila de cifras: Played, Sessions, Spent y Per hour, separadas por líneas
// finas. Mientras hay sesión en vivo, las horas dicen cuánto lleva esta.
const FiguresRow = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const liveSeconds = useLiveSeconds(game.isLive ? game.liveSince : null);
  const sessionCount = game.iterations.reduce(
    (sum, iteration) => sum + iteration.sessions.length,
    0,
  );

  return (
    <div className="flex border-y border-line py-3">
      <FigureCell
        value={formatHours(game.totalHours)}
        label="Played"
        accent
        hint={game.isLive ? `+${Math.floor(liveSeconds / 60)}m now` : undefined}
      />
      <FigureCell value={String(sessionCount)} label="Sessions" />
      <FigureCell value={formatMoney(game.totalSpend)} label="Spent" />
      <FigureCell
        value={game.costPerHour !== null ? formatMoney(game.costPerHour) : '—'}
        label="Per hour"
      />
    </div>
  );
};

// Lo que sustituye a las cifras en un juego del Plan: no hay nada que medir
// todavía, así que se dice desde cuándo lo tienes apuntado.
const PlanBanner = ({ addedAt }: { addedAt: number }): React.JSX.Element => (
  <DetailCard className="flex items-center gap-3.5">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-st-backlog/15 text-st-backlog">
      <Bookmark size={19} aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <div className="text-body font-semibold text-st-backlog">Plan to play</div>
      <div className="text-small text-dust">
        On your plan since {relativeDay(addedAt).toLowerCase()}.
      </div>
    </div>
  </DetailCard>
);

export const GameDetailScreen = (): React.JSX.Element => {
  // El id es texto (§4): se pasa tal cual, sin convertirlo.
  const { id } = useParams<{ id: string }>();
  const gameId = id ?? '';
  const navigate = useNavigate();
  const back = (): void => {
    void navigate(-1);
  };

  const game = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => fetchGame(gameId),
    enabled: gameId !== '',
  });

  // Los sub-recursos van por su cuenta: son listas largas o dependen de IGDB.
  // Si la saga tarda o falla, la ficha ya está pintada y solo falta esa
  // sección — no toda la pantalla esperando a la red de otro.
  const achievements = useQuery({
    queryKey: ['achievements', gameId],
    queryFn: () => fetchAchievements(gameId),
    enabled: gameId !== '',
  });
  const curiosities = useQuery({
    queryKey: ['curiosities', gameId],
    queryFn: () => fetchCuriosities(gameId),
    enabled: gameId !== '',
  });
  const media = useQuery({
    queryKey: ['media', gameId],
    queryFn: () => fetchMedia(gameId),
    enabled: gameId !== '',
  });
  const saga = useQuery({
    queryKey: ['saga', gameId],
    queryFn: () => fetchSaga(gameId),
    enabled: gameId !== '',
  });

  // Qué playthrough está elegido. Vive aquí y no dentro del panel porque el
  // How long to beat también lo necesita, para mover su marcador al cambiar de
  // playthrough — igual que en el escritorio.
  const iterations = game.data?.iterations ?? [];
  const newestId = iterations.length > 0 ? iterations[iterations.length - 1].id : undefined;
  const [selectedId, setSelectedId] = useState<string | undefined>(newestId);
  // Al entrar se muestra el más reciente, y si aparece uno nuevo la selección
  // salta a él. Ajuste de estado durante el render, sin useEffect. Elegir a
  // mano uno anterior se respeta: eso no cambia `newestId`.
  const [seenNewestId, setSeenNewestId] = useState(newestId);
  if (newestId !== seenNewestId) {
    setSeenNewestId(newestId);
    setSelectedId(newestId);
  }

  // Un :id vacío deja las cinco queries desactivadas, y en react-query v5 una
  // query desactivada se queda en `pending` PARA SIEMPRE: el `isPending` de
  // abajo pintaba un spinner eterno, sin error ni salida. El texto lo escribe
  // ErrorState a partir del `code`; la salida de esa pantalla es el enlace a la
  // biblioteca, no un reintento.
  if (gameId === '') {
    return (
      <div className="px-4 pt-14">
        <TopBar onBack={back} />
        <ErrorState error={new ApiFailure('not_found', 'falta el id en la URL')} />
      </div>
    );
  }
  if (game.isPending)
    return (
      <div className="px-4 pt-14">
        <TopBar onBack={back} />
        <Loading label="Reading this game" rows={4} />
      </div>
    );
  // El reintento es para lo que se cura reintentando (red, 500). Un 404 —el
  // /game/99999 que llega por la red— también entra por aquí, y ErrorState se
  // encarga de no ofrecer el botón en ese caso.
  if (game.isError)
    return (
      <div className="px-4 pt-14">
        <TopBar onBack={back} />
        <ErrorState error={game.error} onRetry={() => game.refetch()} />
      </div>
    );

  const detail = game.data;
  // Un planeado no tiene estado real —su único evento es 'plan_to_play', que
  // latestRealStateEvent ignora a propósito— así que saldría como "Unplayed".
  // Aquí se dice lo que es.
  const shownState = detail.planned ? 'plan_to_play' : detail.currentState;
  const status = statusOf(shownState);
  const selected =
    detail.iterations.find((iteration) => iteration.id === selectedId) ??
    detail.iterations[detail.iterations.length - 1];

  const allSessions = detail.iterations
    .flatMap((iteration) => iteration.sessions)
    .sort((a, b) => b.startedAt - a.startedAt);

  // "RPG, Turn-based · PC · 2025": dos géneros como mucho, la plataforma del
  // playthrough elegido y el año.
  const facts = [
    detail.genres && detail.genres.length > 0 ? detail.genres.slice(0, 2).join(', ') : null,
    selected?.playedPlatform ?? null,
    detail.releaseYear !== null ? String(detail.releaseYear) : null,
    detail.isEmulated ? 'Emulated' : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <div className="pb-6">
      <TopBar title={detail.title} live={detail.isLive} onBack={back} />

      {/* ── El héroe: arte a sangre con líneas de escaneo y el degradado que
          protege el texto, para no depender de la suerte del arte que toque. */}
      <div className="relative h-60 overflow-hidden bg-raised">
        {detail.heroUrl ? (
          <img src={detail.heroUrl} alt="" className="h-full w-full object-cover brightness-75" />
        ) : detail.coverUrl ? (
          // Sin hero, la carátula DESENFOCADA de fondo: borrosa da igual su
          // resolución y siempre trae la paleta del juego.
          <img
            src={detail.coverUrl}
            alt=""
            className="h-full w-full scale-110 object-cover blur-lg brightness-[.55]"
          />
        ) : null}
        <div aria-hidden="true" className="absolute inset-0 bg-(image:--scan)" />
        <div aria-hidden="true" className="absolute inset-0 bg-(image:--protect-bottom)" />
      </div>

      <div className="relative -mt-24 flex flex-col gap-6 px-4">
        <div className={revealClass}>
          <div className="flex items-end gap-3.5">
            <Cover url={detail.coverUrl} title={detail.title} className="w-20 shadow-lift" />
            <h1 className="min-w-0 flex-1 font-display text-[34px] leading-[36px] font-bold tracking-[0.005em] text-bone">
              {detail.title}
            </h1>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-dust">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Led state={shownState} />
              <span className={statusTextClass(shownState)}>{status.label}</span>
            </span>
            {facts.length > 0 && <span>{facts.join(' · ')}</span>}
          </div>

          {/* Cronometrar (§7). Solo si no hay ya una sesión de este juego en
              marcha — ni del watcher ni del propio cronómetro. */}
          {!detail.planned && !detail.isLive && (
            <TimerButton
              gameId={detail.id}
              gameTitle={detail.title}
              coverUrl={detail.coverUrl}
              state={detail.currentState}
              totalHours={detail.totalHours}
              className="mt-4 w-full"
            />
          )}

          {detail.isLive && detail.liveSince !== null && (
            <div className="relative mt-4 flex items-center justify-between gap-3 overflow-hidden rounded-md border border-line-strong bg-panel px-4 py-3">
              <div aria-hidden="true" className="absolute inset-0 bg-(image:--scan) opacity-60" />
              <span className="relative">
                <LiveBadge label="Session running" />
              </span>
              <span className="relative">
                <LiveTimer since={detail.liveSince} />
              </span>
            </div>
          )}
        </div>

        {/* Un planeado no enseña cifras ni panel de playthrough: sus cifras
            son cuatro ceros y su "playthrough" es el hueco que createPlannedGame
            deja preparado, sin fechas ni horas. Lo que sí importa de él es lo
            de más abajo — cuánto dura, qué opinan, de qué va. */}
        {detail.planned ? (
          <PlanBanner addedAt={detail.planHistory?.plannedAt ?? detail.addedAt} />
        ) : (
          <>
            <FiguresRow game={detail} />

            {/* Playthrough antes que How long to beat a propósito: el marcador
                del medidor son las horas del playthrough ELEGIDO, así que
                tiene que estar claro cuál se ha elegido antes de leerlo. */}
            {detail.endless ? (
              <EndlessBadge />
            ) : (
              selected && (
                <PlaythroughPanel game={detail} selected={selected} onSelect={setSelectedId} />
              )
            )}
          </>
        )}

        <HowLongToBeat
          game={detail}
          markerHours={detail.endless ? detail.totalHours : (selected?.hours ?? detail.totalHours)}
          markerScope={detail.endless ? 'total' : 'playthrough'}
        />

        <NotesSection notes={detail.notes} />

        {achievements.data && <AchievementsSection data={achievements.data} />}

        <SessionHistorySection sessions={allSessions} />
        <HistorySection game={detail} />

        <RatingsCard game={detail} />

        {media.data && <ScreenshotsSection media={media.data} />}
        {saga.data && <SagaSection entries={saga.data} currentGameId={detail.id} />}

        {curiosities.data && <CuriositiesSection curiosities={curiosities.data} />}

        <DetailsCard game={detail} />
        <AboutCard game={detail} />
      </div>
    </div>
  );
};
