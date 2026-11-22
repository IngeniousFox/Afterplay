import { useNavigate } from 'react-router-dom';
import type { GameListItem, PlannedGameListItem } from '../../../shared/types';
import { isLiveElsewhere } from '../../../shared/liveSession';
import { sortUpNext, type PlanShelfReaders } from '../../../shared/planShelves';
import { ContinueCard } from '../components/home/ContinueCard';
import { HomeNotices } from '../components/home/HomeNotices';
import { Shelf, type ShelfItem } from '../components/home/Shelf';
import { WeekPanel } from '../components/home/WeekPanel';
import { LibraryOnboarding } from '../components/library/LibraryOnboarding';
import { statusKeyOf as gameStatusKey } from '../lib/gameFilters';
import { textLinkClass } from '../components/shell/controls';
import { useShell } from '../components/shell/shellContext';
import { useDeviceContext } from '../hooks/devices';
import { useGames, usePlannedGames } from '../hooks/games';
import { useTimeFormat } from '../hooks/settings';
import { useNow } from '../hooks/useNow';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { formatHours, formatTime } from '../lib/format';
import type { StatusKey } from '../lib/gameStatus';

// HOME, "TONIGHT" (Fósforo, home.png): la pantalla de entrada.
//
//   · El juego en marcha o, sin sesión, el último jugado, con Play.
//   · La semana: horas, sesiones y juegos, con una barra por día.
//   · Los avisos que vivían en el rail (sesiones pendientes, claves).
//   · Tres estanterías: lo que estás jugando, el Up next del Plan y lo último
//     que terminaste.
//
// Todo sale de datos que la app ya tenía (useGames, usePlannedGames, las
// sesiones de la semana); no hay cifras nuevas.

const byLastPlayed = (a: GameListItem, b: GameListItem): number =>
  (b.lastPlayedAt?.getTime() ?? -Infinity) - (a.lastPlayedAt?.getTime() ?? -Infinity);

// Up next solo mira la marca del fijado (shared/planShelves): el resto de
// lectores no intervienen en esa estantería.
const UP_NEXT_READERS: PlanShelfReaders<PlannedGameListItem> = {
  pinnedAt: (game) => game.planPinnedAt?.getTime() ?? null,
  title: (game) => game.title,
  unreleased: () => false,
  releaseSortKey: () => 0,
};

// Entrada de pantalla: bloques con 40 ms de desfase, máximo seis.
const enter = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 5) * 40}ms`,
});

const todayLabel = (now: number, timeFormat: '12h' | '24h'): string => {
  const date = new Date(now);
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return `${day} · ${formatTime(date, timeFormat)}`;
};

export const Home = (): React.JSX.Element => {
  const navigate = useNavigate();
  const shell = useShell();
  const { data: games = [], isLoading } = useGames();
  const { data: planned = [] } = usePlannedGames();
  const { thisDeviceId } = useDeviceContext();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const now = useNow(true, 15_000);
  const { attachRef, onScroll } = useScrollMemory<HTMLDivElement>('home');

  // El protagonista: la sesión de este PC, si no la de otro, y si no hay
  // ninguna el último juego tocado.
  const live = games.filter((game) => game.isLive);
  const recent = games.filter((game) => game.lastPlayedAt !== null).sort(byLastPlayed);
  const hero =
    live.find((game) => !isLiveElsewhere(game, thisDeviceId)) ?? live[0] ?? recent[0] ?? null;

  const toItem = (game: GameListItem, meta: string | null): ShelfItem => ({
    key: String(game.id),
    title: game.title,
    coverUrl: game.coverUrl,
    status: gameStatusKey(game),
    meta,
    onOpen: () => navigate(`/games/${game.id}`),
  });
  const hoursMeta = (game: GameListItem): string =>
    game.totalHours > 0 ? formatHours(game.totalHours) : 'Not played';

  const seeInLibrary = (statuses: StatusKey[]): void => {
    shell.updateLibrary({ search: '', filters: { ...shell.library.filters, statuses } });
    navigate('/games');
  };

  const playing = games.filter((game) => gameStatusKey(game) === 'playing').sort(byLastPlayed);
  // Sin nada en Playing, la primera estantería enseña lo último jugado: así
  // Home no estrena un hueco vacío para quien acaba de terminar algo.
  const firstShelf =
    playing.length > 0
      ? {
          title: 'Playing',
          sub: `${playing.length} ${playing.length === 1 ? 'game' : 'games'}`,
          items: playing.map((game) => toItem(game, hoursMeta(game))),
          action: { label: 'See all', onClick: () => seeInLibrary(['playing']) },
        }
      : {
          title: 'Recently played',
          sub: undefined,
          items: recent.map((game) => toItem(game, hoursMeta(game))),
          action: { label: 'Open library', onClick: () => seeInLibrary([]) },
        };

  const upNext = sortUpNext(planned, UP_NEXT_READERS).map((game, index): ShelfItem => ({
    key: `plan-${game.id}`,
    title: game.title,
    coverUrl: game.coverUrl,
    status: 'plan',
    meta: game.hltbMain !== null && game.hltbMain > 0 ? `HLTB ${formatHours(game.hltbMain)}` : null,
    rank: index + 1,
    onOpen: () => navigate(`/plan/${game.id}`),
  }));

  const beaten = games.filter((game) => gameStatusKey(game) === 'beaten').sort(byLastPlayed);

  return (
    <div ref={attachRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-7 pt-5 pb-10">
        <header
          className="flex animate-screen-in flex-wrap items-baseline gap-x-4 gap-y-1"
          style={enter(0)}
        >
          <h1 className="font-display text-page font-bold text-bone">Tonight</h1>
          <span className="text-small text-dust">{todayLabel(now, timeFormat)}</span>
        </header>

        {!isLoading && games.length === 0 ? (
          <div className="animate-screen-in py-6" style={enter(1)}>
            <LibraryOnboarding />
          </div>
        ) : (
          <>
            <HomeNotices />

            <div
              className="grid animate-screen-in gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
              style={enter(2)}
            >
              {hero ? <ContinueCard game={hero} /> : <NothingPlayedYet />}
              <WeekPanel />
            </div>

            <div className="grid animate-screen-in gap-x-8 gap-y-7 xl:grid-cols-2" style={enter(3)}>
              <Shelf
                title={firstShelf.title}
                sub={firstShelf.sub}
                action={firstShelf.action}
                items={firstShelf.items}
                minWidth={124}
                empty={<p className="text-small text-dust">Nothing played yet.</p>}
              />
              <Shelf
                title="Up next"
                sub="from your plan"
                action={{ label: 'Open plan', onClick: () => navigate('/plan') }}
                items={upNext}
                minWidth={124}
                empty={
                  <p className="text-small text-dust">
                    Pin games in your{' '}
                    <button
                      type="button"
                      onClick={() => navigate('/plan')}
                      className={textLinkClass}
                    >
                      Plan
                    </button>{' '}
                    to line them up here.
                  </p>
                }
              />
            </div>

            {beaten.length > 0 && (
              <div className="animate-screen-in" style={enter(4)}>
                <Shelf
                  title="Recently beaten"
                  sub={`${beaten.length} in total`}
                  action={{ label: 'See all', onClick: () => seeInLibrary(['beaten']) }}
                  items={beaten.map((game) => toItem(game, hoursMeta(game)))}
                  minWidth={112}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// Hay juegos pero ninguno se ha jugado todavía: la tarjeta grande no tiene a
// quién enseñar.
const NothingPlayedYet = (): React.JSX.Element => {
  const navigate = useNavigate();
  return (
    <section className="flex min-h-65 flex-col justify-center rounded-md border border-line bg-panel px-7 py-6">
      <h2 className="font-display text-title font-bold text-bone">Nothing played yet</h2>
      <p className="mt-2 max-w-110 text-body text-dust">
        Launch a game from its page and Afterplay starts timing it. It will show up here next time.
      </p>
      <div className="mt-4">
        <button type="button" onClick={() => navigate('/games')} className={textLinkClass}>
          Browse your library
        </button>
      </div>
    </section>
  );
};
