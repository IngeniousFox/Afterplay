import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Clock3,
  History,
  Play,
  Radio,
  Route,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { GameListItem } from '../../../shared/types';
import { GameCover } from '../components/GameCover';
import { SessionEpiloguesSection } from '../components/sessions/SessionEpiloguesSection';
import { useGames, usePlannedGames } from '../hooks/games';
import { useSessions } from '../hooks/sessions';
import { useStateEvents } from '../hooks/stateEvents';
import { useImageSrc } from '../hooks/useImageSrc';
import { useLiveTimer } from '../hooks/useLiveTimer';
import { BLUE, GREEN } from '../lib/colors';
import { formatElapsed, formatHours } from '../lib/format';
import { getGameStatusMeta } from '../lib/gameStatus';
import {
  buildOnThisDay,
  buildRotation,
  selectContinueGame,
  selectLastClosedSession,
  selectUpNext,
  type OnThisDayMemory as NowMemory,
} from '../lib/now';
import { revealClass, revealStyle } from '../lib/styles';

const LiveBand = ({ game, extra }: { game: GameListItem; extra: number }): React.JSX.Element => {
  const navigate = useNavigate();
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
  const elapsed = useLiveTimer(game.liveSince);

  return (
    <section
      className={`relative overflow-hidden border-y border-primary/25 ${revealClass}`}
      style={revealStyle(0)}
    >
      {heroSrc ? (
        <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-white/[0.025]" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,12,11,.98),rgba(10,12,11,.82)_58%,rgba(10,12,11,.52)),linear-gradient(0deg,rgba(10,11,10,.88),transparent_70%)]" />
      <div className="relative flex min-h-57 items-end gap-5 px-6 py-6">
        <GameCover
          url={game.coverUrl}
          className="h-35 w-25 flex-none overflow-hidden rounded-[10px] border border-white/15 shadow-[0_15px_38px_rgba(0,0,0,.55)]"
          iconSize={28}
        />
        <div className="min-w-0 flex-1 pb-1">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-extrabold tracking-[.14em] text-primary">
            <span className="h-1.75 w-1.75 rounded-full bg-primary [animation:afterplay-pulse-dot_1.4s_infinite]" />
            PLAYING NOW
            {extra > 0 && <span className="text-muted-foreground">+{extra} more</span>}
          </div>
          <h2 className="truncate text-[30px] font-extrabold text-foreground">{game.title}</h2>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <span className="text-[27px] font-extrabold text-primary tabular-nums">
              {formatElapsed(elapsed)}
            </span>
            <span className="text-[12.5px] font-semibold text-muted-foreground">
              {formatHours(game.totalHours)} before this session
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/games/${game.id}`)}
          className="mb-1 flex flex-none items-center gap-2 rounded-[9px] border border-primary/45 bg-primary/12 px-4 py-2.5 text-[12.5px] font-bold text-primary hover:bg-primary/18"
        >
          Open game <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
};

const ContinueBand = ({ game }: { game: GameListItem }): React.JSX.Element => {
  const navigate = useNavigate();
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
  const status = getGameStatusMeta(game.currentState);

  return (
    <section
      className={`relative overflow-hidden border-y border-border ${revealClass}`}
      style={revealStyle(0)}
    >
      {heroSrc && (
        <img src={heroSrc} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(12,14,13,.98),rgba(12,14,13,.88)_62%,rgba(12,14,13,.65))]" />
      <div className="relative flex min-h-41 items-center gap-4 px-6 py-5">
        <GameCover
          url={game.coverUrl}
          className="h-25 w-18 flex-none overflow-hidden rounded-[9px] border border-white/12 shadow-xl"
          iconSize={20}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[9.5px] font-extrabold tracking-[.13em] text-muted-foreground">
            CONTINUE YOUR JOURNEY
          </div>
          <h2 className="mt-1 truncate text-[22px] font-extrabold text-foreground">{game.title}</h2>
          <div
            className="mt-2 flex items-center gap-1.5 text-[12px] font-bold"
            style={{ color: status.color }}
          >
            <status.Icon size={13} fill={status.filled ? status.color : 'none'} />
            {status.label}
            <span className="ml-2 font-semibold text-muted-foreground">
              {game.lastPlayedAt
                ? `Last played ${game.lastPlayedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : formatHours(game.totalHours)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/games/${game.id}`)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/50 bg-primary/12 text-primary hover:bg-primary/20"
          title="Open game"
        >
          <Play size={16} fill={GREEN} />
        </button>
      </div>
    </section>
  );
};

const memoryCopy = (memory: NowMemory, now: Date): string => {
  const years = now.getFullYear() - memory.occurredAt.getFullYear();
  if (memory.kind === 'completed')
    return `You completed this ${years} ${years === 1 ? 'year' : 'years'} ago today.`;
  if (memory.kind === 'started')
    return `You started this ${years} ${years === 1 ? 'year' : 'years'} ago today.`;
  return `You were playing this ${years} ${years === 1 ? 'year' : 'years'} ago today.`;
};

export const Now = (): React.JSX.Element => {
  const navigate = useNavigate();
  const { data: games = [] } = useGames();
  const { data: plannedGames = [] } = usePlannedGames();
  const { data: sessions = [] } = useSessions();
  const { data: stateEvents = [] } = useStateEvents();
  const now = new Date();
  const rotation = buildRotation(games, now);
  const liveGames = games.filter((game) => game.isLive);
  const continueGame = liveGames.length === 0 ? selectContinueGame(games) : null;
  const lastSession = selectLastClosedSession(sessions);
  const onThisDay = buildOnThisDay(games, sessions, stateEvents, now);
  const upNext = selectUpNext(plannedGames);

  return (
    <div className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mx-auto max-w-250">
        <div className="mb-6.5">
          <div className="flex items-center gap-2.5">
            <Radio size={20} color={GREEN} />
            <h1 className="text-[26px] font-extrabold text-foreground">Now</h1>
          </div>
          <p className="mt-1.25 text-[13.5px] text-muted-foreground">
            Your games, where you left them.
          </p>
        </div>

        {liveGames[0] ? (
          <LiveBand game={liveGames[0]} extra={liveGames.length - 1} />
        ) : continueGame ? (
          <ContinueBand game={continueGame} />
        ) : null}

        <div className="mt-7">
          <SessionEpiloguesSection />
        </div>

        {rotation.length > 0 && (
          <section className={revealClass} style={revealStyle(1)}>
            <div className="mb-3 flex items-center gap-2.5">
              <Route size={14} color={BLUE} />
              <h2 className="text-[11px] font-extrabold tracking-[.12em] text-muted-foreground">
                IN ROTATION
              </h2>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {rotation.map((game) => {
                const status = getGameStatusMeta(game.currentState);
                return (
                  <button
                    key={game.id}
                    type="button"
                    onClick={() => navigate(`/games/${game.id}`)}
                    className="group text-left"
                  >
                    <GameCover
                      url={game.coverUrl}
                      className="aspect-3/4 w-full overflow-hidden rounded-[9px] border border-border shadow-[0_8px_20px_rgba(0,0,0,.25)] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(.16,1,.3,1)] group-hover:-translate-y-1 group-hover:shadow-[0_14px_28px_rgba(0,0,0,.4)]"
                      iconSize={24}
                    />
                    <div className="mt-2 truncate text-[12.5px] font-bold text-foreground">
                      {game.title}
                    </div>
                    <div
                      className="mt-0.5 flex items-center gap-1 text-[10.5px] font-semibold"
                      style={{ color: status.color }}
                    >
                      <status.Icon size={10} fill={status.filled ? status.color : 'none'} />
                      {status.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className={`mt-9 grid gap-8 md:grid-cols-2 ${revealClass}`} style={revealStyle(2)}>
          {lastSession && (
            <section className="border-t border-border pt-4">
              <div className="flex items-center gap-2 text-[10px] font-extrabold tracking-[.12em] text-muted-foreground">
                <History size={13} color={GREEN} /> LAST SESSION
              </div>
              <button
                type="button"
                onClick={() => navigate(`/games/${lastSession.gameId}`)}
                className="mt-3 flex w-full items-center gap-3 text-left"
              >
                <GameCover
                  url={lastSession.coverUrl}
                  className="h-16 w-11.5 flex-none overflow-hidden rounded-[7px] border border-border"
                  iconSize={14}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-extrabold text-foreground">
                    {lastSession.gameTitle}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Clock3 size={11} /> {formatHours((lastSession.durationSec ?? 0) / 3600)}
                  </div>
                  {lastSession.note && (
                    <div className="mt-1.5 line-clamp-1 text-[11.5px] italic text-muted-foreground">
                      “{lastSession.note}”
                    </div>
                  )}
                </div>
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            </section>
          )}

          {upNext && (
            <section className="border-t border-border pt-4">
              <div className="flex items-center gap-2 text-[10px] font-extrabold tracking-[.12em] text-muted-foreground">
                <BookOpen size={13} color={BLUE} /> UP NEXT
              </div>
              <button
                type="button"
                onClick={() => navigate(`/plan/${upNext.id}`)}
                className="mt-3 flex w-full items-center gap-3 text-left"
              >
                <GameCover
                  url={upNext.coverUrl}
                  className="h-16 w-11.5 flex-none overflow-hidden rounded-[7px] border border-border"
                  iconSize={14}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-extrabold text-foreground">
                    {upNext.title}
                  </div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">
                    Waiting in your Plan to Play
                  </div>
                </div>
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            </section>
          )}
        </div>

        {onThisDay && (
          <section
            className={`mt-9 border-y border-[#85a3d62b] py-5 ${revealClass}`}
            style={revealStyle(3)}
          >
            <button
              type="button"
              onClick={() => navigate(`/games/${onThisDay.gameId}`)}
              className="flex w-full items-center gap-4 text-left"
            >
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#85a3d614]">
                <CalendarDays size={17} color={BLUE} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[9.5px] font-extrabold tracking-[.13em] text-[#85a3d6]">
                  ON THIS DAY
                </div>
                <div className="mt-1 text-[14px] font-bold text-foreground">
                  {onThisDay.gameTitle}
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  {memoryCopy(onThisDay, now)}
                </div>
              </div>
              <GameCover
                url={onThisDay.coverUrl}
                className="h-18 w-13 flex-none overflow-hidden rounded-[7px] border border-white/10"
                iconSize={14}
              />
            </button>
          </section>
        )}

        {games.length === 0 && (
          <div className="flex min-h-80 flex-col items-center justify-center text-center">
            <Radio size={28} className="text-muted-foreground/35" />
            <div className="mt-3 text-sm font-semibold text-foreground">Nothing in motion yet</div>
            <button
              type="button"
              onClick={() => navigate('/games')}
              className="mt-3 text-[12.5px] font-bold text-primary"
            >
              Open Library
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
