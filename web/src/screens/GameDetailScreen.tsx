import { useQuery } from '@tanstack/react-query';
import { Bookmark, Calendar, ChevronLeft, Clock, DollarSign, Gauge } from 'lucide-react';
import { useState } from 'react';
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
import { MetricCard } from '../components/detail/primitives';
import { TimerButton } from '../components/detail/TimerButton';
import {
  AboutCard,
  CuriositiesSection,
  DetailsCard,
  NotesSection,
  RatingsCard,
} from '../components/detail/sections';
import { Cover } from '../components/Cover';
import { LiveBadge, LiveTimer } from '../components/LiveBadge';
import { useLiveSeconds } from '../hooks/useLiveSeconds';
import { ErrorState, Loading } from '../components/States';
import { formatHours, formatMoney, relativeDay } from '../lib/format';
import { AMBER, BLUE, GREEN, statusOf, VIOLET } from '../lib/status';

// La fila de métricas: 2×2 en móvil en vez de las cuatro en línea del
// escritorio. Mismos datos, mismos acentos de color (verde tiempo, violeta
// ratios, azul conteos, ámbar dinero).
const MetricsRow = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const liveSeconds = useLiveSeconds(game.isLive ? game.liveSince : null);
  const sessionCount = game.iterations.reduce(
    (sum, iteration) => sum + iteration.sessions.length,
    0,
  );

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <MetricCard
        Icon={Clock}
        label="TOTAL HOURS"
        value={formatHours(game.totalHours)}
        liveHint={game.isLive ? `+${Math.floor(liveSeconds / 60)}m this session` : undefined}
        accent={GREEN}
      />
      <MetricCard
        Icon={Gauge}
        label="COST / HOUR"
        value={game.costPerHour !== null ? formatMoney(game.costPerHour) : '—'}
        accent={VIOLET}
      />
      <MetricCard Icon={Calendar} label="SESSIONS" value={String(sessionCount)} accent={BLUE} />
      <MetricCard
        Icon={DollarSign}
        label="TOTAL SPENT"
        value={formatMoney(game.totalSpend)}
        accent={AMBER}
      />
    </div>
  );
};

// Lo que sustituye a las métricas en un juego del Plan: no hay nada que medir
// todavía, así que se dice desde cuándo lo tienes apuntado.
const PlanBanner = ({ addedAt }: { addedAt: number }): React.JSX.Element => (
  <div
    className="flex items-center gap-3.5 rounded-[14px] border px-4 py-4"
    style={{
      borderColor: `${BLUE}2e`,
      background: `linear-gradient(135deg, ${BLUE}1a, ${BLUE}08 60%, transparent)`,
    }}
  >
    <div
      className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px]"
      style={{ background: `${BLUE}24`, border: `1px solid ${BLUE}3d` }}
    >
      <Bookmark size={19} color={BLUE} />
    </div>
    <div className="min-w-0">
      <div className="text-[13.5px] font-bold" style={{ color: BLUE }}>
        Plan to play
      </div>
      <div className="mt-0.25 text-[11.5px] text-muted-foreground">
        On your plan since {relativeDay(addedAt).toLowerCase()}.
      </div>
    </div>
  </div>
);

export const GameDetailScreen = (): React.JSX.Element => {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const navigate = useNavigate();

  const game = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => fetchGame(gameId),
    enabled: Number.isFinite(gameId),
  });

  // Los sub-recursos van por su cuenta: son listas largas o dependen de IGDB.
  // Si la saga tarda o falla, la ficha ya está pintada y solo falta esa
  // sección — no toda la pantalla esperando a la red de otro.
  const achievements = useQuery({
    queryKey: ['achievements', gameId],
    queryFn: () => fetchAchievements(gameId),
    enabled: Number.isFinite(gameId),
  });
  const curiosities = useQuery({
    queryKey: ['curiosities', gameId],
    queryFn: () => fetchCuriosities(gameId),
    enabled: Number.isFinite(gameId),
  });
  const media = useQuery({
    queryKey: ['media', gameId],
    queryFn: () => fetchMedia(gameId),
    enabled: Number.isFinite(gameId),
  });
  const saga = useQuery({
    queryKey: ['saga', gameId],
    queryFn: () => fetchSaga(gameId),
    enabled: Number.isFinite(gameId),
  });

  // Qué playthrough está elegido. Vive aquí y no dentro del panel porque el
  // How long to beat también lo necesita, para mover su marcador al cambiar de
  // playthrough — igual que en el escritorio.
  const iterations = game.data?.iterations ?? [];
  const newestId = iterations.length > 0 ? iterations[iterations.length - 1].id : undefined;
  const [selectedId, setSelectedId] = useState<number | undefined>(newestId);
  // Al entrar se muestra el más reciente, y si aparece uno nuevo la selección
  // salta a él. Ajuste de estado durante el render, sin useEffect. Elegir a
  // mano uno anterior se respeta: eso no cambia `newestId`.
  const [seenNewestId, setSeenNewestId] = useState(newestId);
  if (newestId !== seenNewestId) {
    setSeenNewestId(newestId);
    setSelectedId(newestId);
  }

  // Un :id que no es un número deja las cinco queries desactivadas, y en
  // react-query v5 una query desactivada se queda en `pending` PARA SIEMPRE:
  // el `isPending` de abajo pintaba un spinner eterno, sin error ni salida.
  // Pasa de verdad — el fallback de SPA sirve la app para cualquier /game/*,
  // así que un enlace compartido a medias aterriza aquí.
  if (!Number.isFinite(gameId)) {
    return <ErrorState error={new ApiFailure('not_found', 'That game link is not valid.')} />;
  }
  if (game.isPending) return <Loading />;
  if (game.isError) return <ErrorState error={game.error} onRetry={() => game.refetch()} />;

  const detail = game.data;
  // Un planeado no tiene estado real —su único evento es 'plan_to_play', que
  // latestRealStateEvent ignora a propósito— así que saldría como "Unplayed".
  // Aquí se dice lo que es.
  const status = statusOf(detail.planned ? 'plan_to_play' : detail.currentState);
  const StatusIcon = status.Icon;
  const selected =
    detail.iterations.find((iteration) => iteration.id === selectedId) ??
    detail.iterations[detail.iterations.length - 1];

  const allSessions = detail.iterations
    .flatMap((iteration) => iteration.sessions)
    .sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="pb-6">
      {/* ── El arte a sangre, con el velo que garantiza la legibilidad ──────
          Mismo lenguaje que la trasera de la GameCard del escritorio: el hero
          llena el cabecero y un degradado denso abajo sostiene el texto sin
          depender de la suerte del arte que toque. */}
      <div className="relative">
        <div className="relative h-44 overflow-hidden">
          {detail.heroUrl ? (
            <img
              src={detail.heroUrl}
              alt=""
              className="h-full w-full object-cover brightness-[.66]"
            />
          ) : detail.coverUrl ? (
            // Sin hero, la carátula DESENFOCADA de fondo: borrosa da igual su
            // resolución y siempre trae la paleta del juego.
            <img
              src={detail.coverUrl}
              alt=""
              className="h-full w-full scale-110 object-cover blur-lg brightness-[.5]"
            />
          ) : (
            <div className="h-full w-full bg-[#151716]" />
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(10,11,10,.55) 0%, rgba(10,11,10,.30) 40%, rgba(10,11,10,.92) 88%, #0a0b0a 100%)',
            }}
          />
        </div>

        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="absolute top-3 left-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 backdrop-blur-sm"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      <div className="-mt-14 flex flex-col gap-5 px-4">
        <div className="flex items-end gap-3.5">
          <Cover url={detail.coverUrl} title={detail.title} className="w-24 shadow-lg" />
          <div className="min-w-0 flex-1 pb-1">
            <h1 className="text-[19px] leading-tight font-extrabold">{detail.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <StatusIcon
                size={14}
                color={status.color}
                fill={status.filled ? status.color : 'none'}
              />
              <span className="text-[12.5px] font-bold" style={{ color: status.color }}>
                {status.label}
              </span>
              {detail.releaseYear !== null && (
                <span className="text-[11.5px] font-semibold text-muted-foreground tabular-nums">
                  · {detail.releaseYear}
                </span>
              )}
              {detail.isEmulated && (
                <span className="text-[11.5px] font-semibold text-muted-foreground">
                  · Emulated
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Cronometrar (§7). Solo si no hay ya una sesión de este juego en
            marcha — ni del watcher ni del propio cronómetro. */}
        {!detail.planned && !detail.isLive && (
          <TimerButton gameId={detail.id} gameTitle={detail.title} />
        )}

        {detail.isLive && detail.liveSince !== null && (
          <div
            className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-4 py-3"
            style={{ animation: 'afterplay-glow-card 2.6s ease-in-out infinite' }}
          >
            <LiveBadge />
            <LiveTimer since={detail.liveSince} />
          </div>
        )}

        {/* Un planeado no enseña métricas ni panel de playthrough: sus cifras
            son cuatro ceros y su "playthrough" es el hueco que createPlannedGame
            deja preparado, sin fechas ni horas. Lo que sí importa de él es lo
            de más abajo — cuánto dura, qué opinan, de qué va. */}
        {detail.planned ? (
          <PlanBanner addedAt={detail.addedAt} />
        ) : (
          <>
            <MetricsRow game={detail} />

            {/* Playthrough antes que How long to beat a propósito: el marcador
                de la barra son las horas del playthrough ELEGIDO, así que
                tiene que estar claro cuál se ha elegido antes de leerla. */}
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

        <RatingsCard game={detail} />

        {media.data && <ScreenshotsSection media={media.data} />}
        {saga.data && <SagaSection entries={saga.data} currentGameId={detail.id} />}

        <NotesSection notes={detail.notes} />
        {curiosities.data && <CuriositiesSection curiosities={curiosities.data} />}

        <SessionHistorySection sessions={allSessions} />
        <HistorySection game={detail} />
        {achievements.data && <AchievementsSection data={achievements.data} />}

        <DetailsCard game={detail} />
        <AboutCard game={detail} />
      </div>
    </div>
  );
};
