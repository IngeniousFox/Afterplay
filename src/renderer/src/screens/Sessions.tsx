import { Activity, ArrowRight, Calendar, Clock, Flame, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { momentsBySession } from '../../../shared/memory/moments';
import type { SessionUnlock, SessionWithGame } from '../../../shared/types';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { DeleteSessionDialog } from '../components/sessions/DeleteSessionDialog';
import { MonthStoryCard } from '../components/sessions/MonthStoryCard';
import { Pager } from '../components/sessions/Pager';
import { PendingSessionsSection } from '../components/sessions/PendingSessionsSection';
import { SessionRow } from '../components/sessions/SessionRow';
import { useSessionUnlocks } from '../hooks/achievements';
import { useGames } from '../hooks/games';
import { useMemories } from '../hooks/memories';
import { useSessionsPage } from '../hooks/sessions';
import { useCountUp } from '../hooks/useCountUp';
import { requestAchievementFlash } from '../lib/achievementFlash';
import { formatHours, pluralize } from '../lib/format';
import { groupPageByDate } from '../lib/sessionGroups';
import { outlineButtonClass, revealClass, revealStyle } from '../lib/styles';
import { parseEntityId, type SessionId } from '../../../shared/entityIds';

const PAGE_SIZE = 20;
const NO_SESSIONS: SessionWithGame[] = [];

// Bloque 5A — todas las sesiones, o filtradas a un juego vía el ?game= que
// pone SessionsNavColumn (MiddleColumn.tsx) al hacer clic en la columna de
// nav. Mismo filtro, misma URL: los dos componentes leen el search param en
// vez de compartir estado por otra vía.
export const Sessions = (): React.JSX.Element => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gameParam = searchParams.get('game');
  const gameId = gameParam ? parseEntityId(gameParam) : null;

  // Una página de las sesiones, con el filtro, el total y las cifras de cabecera
  // calculados en el main (F-41): la pantalla no recorre la historia entera.
  const [page, setPage] = useState(1);
  const { data: pageData, isLoading, isError, refetch } = useSessionsPage(gameId, page, PAGE_SIZE);
  const { data: games = [] } = useGames();
  // Recaps de mes para las tarjetas del diario (§5), indexados por scopeKey.
  const { data: memories = [] } = useMemories();
  const recapByMonth = useMemo(
    () =>
      new Map(
        memories
          .filter((memory) => memory.scopeType === 'month')
          .map((memory) => [memory.scopeKey, memory]),
      ),
    [memories],
  );

  // Los momentos señalados (§2.1): el main los deriva sobre la historia
  // COMPLETA —un récord no se puede saber mirando la página visible, y con
  // filtro de juego también: "tu sesión más larga de Hollow Knight" es la misma
  // verdad se mire desde donde se mire— y manda solo los de las sesiones de la
  // página, que aquí se indexan por sesión para vestir cada fila.
  const momentsIndex = useMemo(
    () => momentsBySession(pageData?.moments ?? []),
    [pageData?.moments],
  );

  // Los trofeos de cada sesión (LOGROS-IDEAS.md §2.1), de UNA consulta
  // global — indexados aquí por sesión para vestir las filas, igual que los
  // momentos de arriba.
  const { data: sessionUnlocks = [] } = useSessionUnlocks();
  const unlocksBySession = useMemo(() => {
    const map = new Map<SessionId, SessionUnlock[]>();
    for (const unlock of sessionUnlocks) {
      const list = map.get(unlock.sessionId) ?? [];
      list.push(unlock);
      map.set(unlock.sessionId, list);
    }
    return map;
  }, [sessionUnlocks]);

  // Sesión pendiente de confirmación de borrado (null = diálogo cerrado).
  const [pendingDelete, setPendingDelete] = useState<SessionWithGame | null>(null);
  // Cambiar de filtro (elegir otro juego, o volver a "All games") vuelve a
  // la página 1 — mismo patrón de "ajustar estado durante el render" que
  // PlaythroughPanel (compatible con React Compiler, sin useEffect).
  const [seenGameId, setSeenGameId] = useState(gameId);
  if (gameId !== seenGameId) {
    setSeenGameId(gameId);
    setPage(1);
  }

  const selectedGame = gameId === null ? null : (games.find((g) => g.id === gameId) ?? null);
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Por si la página quedó fuera de rango (p.ej. el total bajó tras borrar la
  // última sesión de la última página) — nunca una página en blanco: se
  // vuelve a pedir la última que existe.
  const safePage = Math.min(page, totalPages);
  if (pageData && page > totalPages) setPage(totalPages);
  const pageItems = pageData?.items ?? NO_SESSIONS;
  const groups = useMemo(() => groupPageByDate(pageItems, new Date()), [pageItems]);

  // Cambiar de página con el scroll a mitad de la lista dejaría la vista
  // "flotando" sobre filas de la página nueva sin su cabecera de fecha a la
  // vista (esa cabecera está arriba del todo) — subir el scroll es lo que
  // hace que la página nueva se lea desde donde tiene sentido empezar.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [safePage]);

  const totalHours = selectedGame
    ? selectedGame.totalHours
    : games.reduce((sum, game) => sum + game.totalHours, 0);

  // La más larga y la media de las cerradas del filtro (sessionDurationStats
  // de antes), que ya vienen del main junto con la página.
  const longestSessionSec = pageData?.longestSec ?? 0;
  const avgSessionSec = pageData?.avgSec ?? 0;

  // Contadores animados de las 4 métricas — mismo count-up que Stats; al
  // cambiar de filtro los targets cambian y vuelven a subir solos.
  const animatedHours = useCountUp(totalHours);
  const animatedCount = useCountUp(total);
  const animatedLongestSec = useCountUp(longestSessionSec);
  const animatedAvgSec = useCountUp(avgSessionSec);

  // El conteo de sesiones ya no va en el subtítulo — se muestra en la
  // píldora junto al título (mismo patrón que el conteo de juegos en
  // GameListScreen). El subtítulo se queda con el dato que la píldora no
  // dice: el total de horas jugadas.
  const subtitle = selectedGame
    ? `${formatHours(selectedGame.totalHours)} played in total`
    : 'Across your library';

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mx-auto max-w-250">
        <div className="mb-6.5 flex items-end justify-between gap-4">
          <div>
            {/* items-baseline y no items-center — mismo motivo que
                GameListScreen: centrar por caja contra un H1 tan grande deja
                la píldora flotando en vez de asentada junto al texto. */}
            <div className="flex items-baseline gap-2.75">
              <h1 className="font-display text-[34px] leading-none font-bold text-bone">
                {selectedGame ? selectedGame.title : 'All Sessions'}
              </h1>
              {/* Mismo patrón que el conteo de juegos en GameListScreen —
                  contextual: cuenta lo que se está viendo ahora mismo
                  (filtered), no siempre el total de la biblioteca entera. */}
              {!isLoading && !isError && total > 0 && (
                <span className="flex-none rounded-full border border-line-strong bg-raised px-2.5 py-0.75 text-[12px] font-bold text-foreground tabular-nums">
                  {total}
                  <span className="ml-1 font-semibold text-muted-foreground">
                    {total === 1 ? 'session' : 'sessions'}
                  </span>
                </span>
              )}
            </div>
            <p className="mt-1.25 text-[13.5px] text-muted-foreground">{subtitle}</p>
          </div>

          {selectedGame && (
            <div className="flex flex-none gap-2.5">
              <button
                type="button"
                onClick={() => navigate(`/games/${selectedGame.id}`)}
                className={`${outlineButtonClass} border-primary/45 bg-primary/10 text-primary hover:bg-primary/16`}
              >
                <span>Open game</span>
                <ArrowRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className={`${outlineButtonClass} border-line-strong bg-raised text-foreground hover:bg-raised-hover`}
              >
                All sessions
              </button>
            </div>
          )}
        </div>

        {/* Bandeja de sesiones de emulador sin asignar (EMULADORES.md §6) —
            solo en la vista global: una sesión pendiente no pertenece a
            ningún juego todavía, no pinta nada bajo un filtro de juego. */}
        {gameId === null && <PendingSessionsSection />}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading sessions…</p>
        ) : isError ? (
          <div className="flex flex-col items-start gap-2.5">
            <p className="text-sm text-destructive">
              Something went wrong loading your sessions. Try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className={`${outlineButtonClass} border-line-strong bg-raised text-foreground hover:bg-raised-hover`}
            >
              <RefreshCw size={14} />
              <span>Try again</span>
            </button>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-24 text-center">
            <p className="text-sm font-semibold text-foreground">No sessions yet</p>
            <p className="text-xs text-muted-foreground">
              {selectedGame
                ? 'Sessions you play (or log manually) for this game will show up here.'
                : 'Play a game with the watcher running, or log one manually, to see it here.'}
            </p>
          </div>
        ) : (
          <>
            <div
              className={`mb-6.5 grid grid-cols-2 gap-3.5 sm:grid-cols-4 ${revealClass}`}
              style={revealStyle(0)}
            >
              <MetricCard
                Icon={Clock}
                label="Total hours"
                value={formatHours(animatedHours)}
                accent="#ffb347"
              />
              <MetricCard
                Icon={Calendar}
                label="Sessions"
                value={String(Math.round(animatedCount))}
                accent="#5fd3e0"
              />
              <MetricCard
                Icon={Flame}
                label="Longest session"
                value={formatHours(animatedLongestSec / 3600)}
                accent="#ff5e57"
              />
              <MetricCard
                Icon={Activity}
                label="Avg session"
                value={formatHours(animatedAvgSec / 3600)}
                accent="#b9a6ff"
              />
            </div>

            {/* key por filtro+página: cambiar cualquiera de los dos relanza
                la cascada de los grupos con los datos nuevos. */}
            <div
              key={`${gameId ?? 'all'}-${pageData?.page ?? safePage}`}
              className="flex flex-col gap-5.5"
            >
              {groups.map((group, index) => {
                const groupSeconds = group.sessions.reduce(
                  (sum, session) =>
                    session.endedAt !== null ? sum + (session.durationSec ?? 0) : sum,
                  0,
                );
                // La tarjeta del recap (§5), solo en el diario global: bajo
                // un filtro de juego el mes entero no es el tema. Y solo en
                // cubos que son un mes cerrado — getSessionGroup ya decide.
                const groupRecap =
                  gameId === null && group.monthScopeKey !== null
                    ? recapByMonth.get(group.monthScopeKey)
                    : undefined;
                return (
                  <div
                    key={`${group.label}-${index}`}
                    className={revealClass}
                    // Escalonado acotado: con muchos grupos en una página, a
                    // partir del sexto entran todos a la vez — una cola de
                    // delays de medio segundo ya no aporta nada.
                    style={revealStyle(Math.min(index + 1, 6))}
                  >
                    <div className="mb-2.5 flex items-baseline gap-2.5">
                      <span className="text-[11px] font-bold tracking-[.13em] text-muted-foreground uppercase">
                        {group.label}
                      </span>
                      <span className="h-px flex-1 self-center bg-bone/5" />
                      <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                        {pluralize(group.sessions.length, 'session')}
                        {groupSeconds > 0 && ` · ${formatHours(groupSeconds / 3600)}`}
                      </span>
                    </div>
                    {groupRecap && (
                      <MonthStoryCard
                        recap={groupRecap}
                        onOpen={() => navigate(`/stats?view=journey&month=${group.monthScopeKey}`)}
                      />
                    )}
                    <div className="flex flex-col gap-2.5">
                      {group.sessions.map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          maxDurationSec={longestSessionSec}
                          isRecord={
                            session.endedAt !== null &&
                            longestSessionSec > 0 &&
                            (session.durationSec ?? 0) === longestSessionSec
                          }
                          moments={momentsIndex.get(session.id)}
                          achievements={unlocksBySession.get(session.id)}
                          // Cada trofeo es un enlace (LOGROS-REDISENO §1): se
                          // pide el parpadeo ANTES de navegar — la ficha lee
                          // el pendiente al montar y hace el resto.
                          onOpenAchievement={(achievementId) => {
                            requestAchievementFlash(achievementId);
                            navigate(`/games/${session.gameId}`);
                          }}
                          onDelete={() => setPendingDelete(session)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>

      <DeleteSessionDialog
        session={
          pendingDelete
            ? {
                id: pendingDelete.id,
                label: `${pendingDelete.gameTitle} — ${pendingDelete.startedAt.toLocaleDateString(
                  'en-US',
                  { month: 'short', day: 'numeric', year: 'numeric' },
                )} · ${formatHours((pendingDelete.durationSec ?? 0) / 3600)}`,
              }
            : null
        }
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
};
