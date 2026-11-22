import { ArrowRight, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { momentsBySession } from '../../../shared/memory/moments';
import type { SessionUnlock, SessionWithGame } from '../../../shared/types';
import { DeleteSessionDialog } from '../components/sessions/DeleteSessionDialog';
import { Figure } from '../components/sessions/Figure';
import { MonthStoryCard } from '../components/sessions/MonthStoryCard';
import { Pager } from '../components/sessions/Pager';
import { PendingSessionsSection } from '../components/sessions/PendingSessionsSection';
import { SessionRow } from '../components/sessions/SessionRow';
import { Stagger, Ticker } from '../components/fx';
import { buttonSize, secondaryButtonClass } from '../components/shell/controls';
import { useSessionUnlocks } from '../hooks/achievements';
import { useGames } from '../hooks/games';
import { useMemories } from '../hooks/memories';
import { useSessionsPage } from '../hooks/sessions';
import { requestAchievementFlash } from '../lib/achievementFlash';
import { formatDateOnly, formatHours, pluralize } from '../lib/format';
import { groupPageByDate } from '../lib/sessionGroups';
import { parseEntityId, type SessionId } from '../../../shared/entityIds';

const PAGE_SIZE = 20;
const NO_SESSIONS: SessionWithGame[] = [];

// Entrada escalonada de los bloques de la pantalla, la misma de Home.
const enter = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 5) * 40}ms`,
});

type DayLabel = { weekday: string | null; date: string };

// El día de una sesión para la columna de la izquierda, y la clave con la que
// se agrupan las filas del mismo día. Con hora o con día, "Sun" / "Nov 22" (el
// año solo si no es el corriente); con precisión de mes o de año no hay día
// que contar, y se dice lo que se sabe.
const dayOf = (session: SessionWithGame, currentYear: number): { key: string } & DayLabel => {
  const date = session.startedAt;
  if (session.datePrecision === 'datetime' || session.datePrecision === 'day') {
    return {
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
      date: date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
      }),
    };
  }
  const label = formatDateOnly(date, session.datePrecision);
  return { key: `${session.datePrecision}-${label}`, weekday: null, date: label };
};

// Bloque 5A — todas las sesiones, o filtradas a un juego vía el ?game= que
// pone la paleta de Ctrl K (o el enlace de la ficha). Misma URL para todos:
// los componentes leen el search param en vez de compartir estado.
//
// Fósforo (sessions.png): cabecera con el recuento, la bandeja de pendientes,
// una tira de cifras sin cajas y el historial como tabla compacta por tramos
// (Today, This Week, October…), con las sesiones de cada día colgando de su
// fecha en la columna de la izquierda.
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
  // COMPLETA —un récord no se puede saber mirando la página visible— y manda
  // solo los de las sesiones de la página, que aquí se indexan por sesión.
  const momentsIndex = useMemo(
    () => momentsBySession(pageData?.moments ?? []),
    [pageData?.moments],
  );

  // Los trofeos de cada sesión (LOGROS-IDEAS.md §2.1), de UNA consulta
  // global — indexados aquí por sesión para vestir las filas.
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
  // Cambiar de filtro vuelve a la página 1 — "ajustar estado durante el
  // render" (compatible con React Compiler, sin useEffect).
  const [seenGameId, setSeenGameId] = useState(gameId);
  if (gameId !== seenGameId) {
    setSeenGameId(gameId);
    setPage(1);
  }

  const selectedGame = gameId === null ? null : (games.find((g) => g.id === gameId) ?? null);
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Por si la página quedó fuera de rango (p.ej. el total bajó tras borrar la
  // última sesión de la última página) — nunca una página en blanco.
  const safePage = Math.min(page, totalPages);
  if (pageData && page > totalPages) setPage(totalPages);
  const pageItems = pageData?.items ?? NO_SESSIONS;
  const groups = useMemo(() => groupPageByDate(pageItems, new Date()), [pageItems]);

  // Cambiar de página con el scroll a mitad de la lista dejaría la vista
  // "flotando" sobre filas de la página nueva sin su cabecera a la vista.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [safePage]);

  const totalHours = selectedGame
    ? selectedGame.totalHours
    : games.reduce((sum, game) => sum + game.totalHours, 0);

  // La más larga y la media de las cerradas del filtro, que ya vienen del
  // main junto con la página.
  const longestSessionSec = pageData?.longestSec ?? 0;
  const avgSessionSec = pageData?.avgSec ?? 0;

  const subtitle = selectedGame
    ? `${formatHours(selectedGame.totalHours)} played in total`
    : 'Across your library';

  const currentYear = new Date().getFullYear();

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1600px] flex-col px-7 pt-5 pb-12">
        <header
          className="mb-5 flex animate-screen-in flex-wrap items-end justify-between gap-x-6 gap-y-3"
          style={enter(0)}
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="font-display text-page font-bold text-bone">
              {selectedGame ? selectedGame.title : 'Sessions'}
            </h1>
            <span className="text-small text-dust">
              {/* Cuenta lo que se está viendo ahora mismo (con filtro, las de
                  ese juego), no siempre el total de la biblioteca. */}
              {!isLoading && !isError && total > 0 && (
                <span className="tabular-nums">{pluralize(total, 'session')} · </span>
              )}
              {subtitle}
            </span>
          </div>

          {selectedGame && (
            <div className="flex flex-none flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => navigate(`/games/${selectedGame.id}`)}
                className={cn(secondaryButtonClass, buttonSize.md)}
              >
                Open game
                <ArrowRight aria-hidden size={15} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/sessions')}
                className={cn(secondaryButtonClass, buttonSize.md)}
              >
                All sessions
              </button>
            </div>
          )}
        </header>

        {/* Bandeja de sesiones de emulador sin asignar (EMULADORES.md §6) —
            solo en la vista global: una pendiente no pertenece a ningún juego
            todavía, no pinta nada bajo un filtro de juego. */}
        {gameId === null && (
          <div className="animate-screen-in" style={enter(1)}>
            <PendingSessionsSection />
          </div>
        )}

        {isLoading ? (
          <p className="text-body text-dust">Loading sessions…</p>
        ) : isError ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-live">
              Something went wrong loading your sessions. Try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className={cn(secondaryButtonClass, buttonSize.md)}
            >
              <RefreshCw aria-hidden size={14} />
              Try again
            </button>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong px-6 py-20 text-center">
            <p className="text-lead font-semibold text-bone">No sessions yet</p>
            <p className="text-small text-dust">
              {selectedGame
                ? 'Sessions you play (or log manually) for this game will show up here.'
                : 'Play a game with the watcher running, or log one manually, to see it here.'}
            </p>
          </div>
        ) : (
          <>
            {/* Las cuatro cifras, sin cajas: la clave (las horas) en Phosphor. */}
            <dl
              aria-label="Session totals"
              className="mb-7 grid animate-screen-in grid-cols-2 gap-x-8 gap-y-5 rounded-md border border-line bg-panel px-6 py-5 sm:grid-cols-4"
              style={enter(2)}
            >
              {/* Las cuatro entran contando como un marcador (Ticker); al
                  cambiar de filtro los valores cambian y vuelven a subir. */}
              <SessionFigure
                label="Total hours"
                value={totalHours}
                format={formatHours}
                className="text-phosphor"
              />
              <SessionFigure
                label="Sessions"
                value={total}
                format={(count) => String(Math.round(count))}
                className="text-bone"
              />
              <SessionFigure
                label="Longest session"
                value={longestSessionSec / 3600}
                format={formatHours}
                className="text-bone"
              />
              <SessionFigure
                label="Avg session"
                value={avgSessionSec / 3600}
                format={formatHours}
                className="text-bone"
              />
            </dl>

            {/* key por filtro+página: cambiar cualquiera de los dos relanza la
                cascada de los tramos con los datos nuevos (y, dentro de cada
                tramo, la de sus filas: Stagger se reparte al montar). */}
            <div
              key={`${gameId ?? 'all'}-${pageData?.page ?? safePage}`}
              className="flex flex-col gap-7"
            >
              {groups.map((group, index) => {
                const groupSeconds = group.sessions.reduce(
                  (sum, session) =>
                    session.endedAt !== null ? sum + (session.durationSec ?? 0) : sum,
                  0,
                );
                // La tarjeta del recap (§5), solo en el diario global: bajo
                // un filtro de juego el mes entero no es el tema. Y solo en
                // tramos que son un mes cerrado — getSessionGroup ya decide.
                const groupRecap =
                  gameId === null && group.monthScopeKey !== null
                    ? recapByMonth.get(group.monthScopeKey)
                    : undefined;
                return (
                  <section
                    key={`${group.label}-${index}`}
                    aria-label={group.label}
                    className="animate-screen-in"
                    // Escalonado acotado: a partir del sexto entran todos a la
                    // vez — una cola de retrasos ya no aporta nada.
                    style={enter(index + 3)}
                  >
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h2 className="text-lead font-semibold text-bone">{group.label}</h2>
                      <span className="text-small text-dust tabular-nums">
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
                    <Stagger
                      step={35}
                      className="overflow-hidden rounded-md border border-line bg-panel"
                    >
                      {group.sessions.map((session, rowIndex) => {
                        const day = dayOf(session, currentYear);
                        const firstOfDay =
                          rowIndex === 0 ||
                          dayOf(group.sessions[rowIndex - 1], currentYear).key !== day.key;
                        return (
                          <SessionRow
                            key={session.id}
                            session={session}
                            day={firstOfDay ? { weekday: day.weekday, date: day.date } : null}
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
                        );
                      })}
                    </Stagger>
                  </section>
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

const SessionFigure = ({
  label,
  value,
  format,
  className,
}: {
  label: string;
  value: number;
  format: (value: number) => string;
  className: string;
}): React.JSX.Element => (
  <div className="flex min-w-0 flex-col-reverse">
    <dt className="mt-1.5 text-small text-dust">{label}</dt>
    <dd>
      <Ticker
        value={value}
        format={format}
        render={(shown) => (
          <Figure value={format(shown)} className={cn('text-[40px]', className)} />
        )}
      />
    </dd>
  </div>
);
