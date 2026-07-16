import { Activity, ArrowRight, Calendar, Clock, Flame } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { SessionWithGame } from '../../../shared/types';
import { MetricCard } from '../components/library/detail/MetricsRow';
import { Pager } from '../components/sessions/Pager';
import { PendingSessionsSection } from '../components/sessions/PendingSessionsSection';
import { SessionRow } from '../components/sessions/SessionRow';
import { useGames } from '../hooks/games';
import { useAllSessions } from '../hooks/sessions';
import { formatHours, pluralize } from '../lib/format';

const outlineButtonClass =
  'flex items-center gap-1.75 rounded-[9px] border px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap';

const PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

// Cubos de fecha para las cabeceras — de "Today" a un año concreto, cuanto
// más lejos en el tiempo más grueso el cubo (nadie necesita saber el día
// exacto de hace dos años, pero sí el de ayer). `now` se calcula UNA vez por
// render (no una por sesión) para que todas las filas de la misma pasada
// usen el mismo "hoy", sin desajustes de un milisegundo entre unas y otras.
const getSessionGroupLabel = (date: Date, now: Date): string => {
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'This Week';
  if (diffDays <= 14) return 'Last Week';

  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return 'This Month';
  }

  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth()) {
    return 'Last Month';
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'long' });
  }

  // Años anteriores: siempre desglosado por mes ("March 2025", "January
  // 2025"...), no un cubo único por año.
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};

type SessionGroup = { label: string; sessions: SessionWithGame[] };

// Agrupa una PÁGINA de sesiones, no la lista entera — la cabecera del primer
// registro de la página SIEMPRE se pinta, siga o no el mismo grupo que
// terminaba la página anterior. Sin esto, cambiar de página podía dejar una
// tanda de filas "This Week" arrancando a mitad, sin ningún titulito encima
// (el grupo ya se había impreso en la página anterior y no volvía a salir).
const groupPageByDate = (sessions: SessionWithGame[], now: Date): SessionGroup[] => {
  const groups: SessionGroup[] = [];
  for (const session of sessions) {
    const label = getSessionGroupLabel(session.startedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.sessions.push(session);
    else groups.push({ label, sessions: [session] });
  }
  return groups;
};

// Bloque 5A — todas las sesiones, o filtradas a un juego vía el ?game= que
// pone SessionsNavColumn (MiddleColumn.tsx) al hacer clic en la columna de
// nav. Mismo filtro, misma URL: los dos componentes leen el search param en
// vez de compartir estado por otra vía.
export const Sessions = (): React.JSX.Element => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gameParam = searchParams.get('game');
  const gameId = gameParam ? Number(gameParam) : null;

  const { data: sessions = [], isLoading, isError } = useAllSessions();
  const { data: games = [] } = useGames();

  const [page, setPage] = useState(1);
  // Cambiar de filtro (elegir otro juego, o volver a "All games") vuelve a
  // la página 1 — mismo patrón de "ajustar estado durante el render" que
  // PlaythroughPanel (compatible con React Compiler, sin useEffect).
  const [seenGameId, setSeenGameId] = useState(gameId);
  if (gameId !== seenGameId) {
    setSeenGameId(gameId);
    setPage(1);
  }

  const selectedGame = gameId === null ? null : (games.find((g) => g.id === gameId) ?? null);
  const filtered = useMemo(
    () => (gameId === null ? sessions : sessions.filter((s) => s.gameId === gameId)),
    [sessions, gameId],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Por si la página quedó fuera de rango (p.ej. el total bajó tras cerrar
  // el filtro anterior con más páginas) — nunca una página en blanco.
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
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

  const closedSessions = filtered.filter((session) => session.endedAt !== null);
  const longestSessionSec = closedSessions.reduce(
    (max, session) => Math.max(max, session.durationSec ?? 0),
    0,
  );
  const avgSessionSec =
    closedSessions.length > 0
      ? closedSessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) /
        closedSessions.length
      : 0;

  const subtitle = selectedGame
    ? `${pluralize(filtered.length, 'session')} · ${formatHours(selectedGame.totalHours)} total`
    : `${pluralize(sessions.length, 'session')} across your library`;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-8.5 pt-7.5 pb-15">
      <div className="mx-auto max-w-250">
        <div className="mb-6.5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-extrabold tracking-[-.01em] text-foreground">
              {selectedGame ? selectedGame.title : 'All Sessions'}
            </h1>
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
                className={`${outlineButtonClass} border-input bg-white/[0.03] text-foreground hover:bg-white/[0.06]`}
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
          <p className="text-sm text-destructive">
            Something went wrong loading your sessions. Try again in a moment.
          </p>
        ) : filtered.length === 0 ? (
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
            <div className="mb-6.5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
              <MetricCard Icon={Clock} label="TOTAL HOURS" value={formatHours(totalHours)} />
              <MetricCard Icon={Calendar} label="SESSIONS" value={String(filtered.length)} />
              <MetricCard
                Icon={Flame}
                label="LONGEST SESSION"
                value={formatHours(longestSessionSec / 3600)}
              />
              <MetricCard
                Icon={Activity}
                label="AVG SESSION"
                value={formatHours(avgSessionSec / 3600)}
              />
            </div>

            <div className="flex flex-col gap-5.5">
              {groups.map((group, index) => (
                <div key={`${group.label}-${index}`}>
                  <div className="mb-2.5 text-[11px] font-bold tracking-[.13em] text-muted-foreground uppercase">
                    {group.label}
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {group.sessions.map((session) => (
                      <SessionRow key={session.id} session={session} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
};
