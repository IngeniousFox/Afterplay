import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSessions } from '../api';
import { Cover } from '../components/Cover';
import { Pager } from '../components/Pager';
import { EmptyState, ErrorState, Loading } from '../components/States';
import { formatHours, formatTime } from '../lib/format';
import { groupPageByDate } from '../lib/sessionGroups';
import { GREEN } from '../lib/status';

// El mismo tamaño de página que el escritorio.
const PAGE_SIZE = 20;

export const SessionsScreen = (): React.JSX.Element => {
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['sessions', page],
    queryFn: () => fetchSessions(PAGE_SIZE, (page - 1) * PAGE_SIZE),
    // Sin esto, cada cambio de página vacía la lista y enseña el spinner: la
    // pantalla parpadea entera para traer veinte filas. Con la página anterior
    // en pantalla mientras llega la nueva, pasar de página se siente como
    // pasar de página.
    placeholderData: keepPreviousData,
  });

  if (query.isPending) return <Loading label="Reading your sessions" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const { sessions, total } = query.data;
  if (total === 0) return <EmptyState>No tracked sessions yet.</EmptyState>;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // `now` se calcula UNA vez por render, no una por sesión, para que todas las
  // filas de la misma pasada usen el mismo "hoy".
  const groups = groupPageByDate(sessions, new Date());

  return (
    <div className="px-4 pt-4">
      <div className="mb-3.5 text-[10px] font-bold tracking-[.13em] text-muted-foreground uppercase">
        {total} sessions
      </div>

      <div className="flex flex-col gap-5">
        {groups.map((group, index) => {
          const groupHours =
            group.sessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) / 3600;

          return (
            <section
              key={`${group.label}-${index}`}
              className="afterplay-reveal"
              style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
            >
              <div className="mb-2.5 flex items-baseline justify-between">
                <h2 className="text-[10px] font-bold tracking-[.13em] text-muted-foreground uppercase">
                  {group.label}
                </h2>
                {groupHours > 0 && (
                  <span className="text-[11px] font-bold text-muted-foreground tabular-nums">
                    {formatHours(groupHours)}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {group.sessions.map((session) => (
                  <Link
                    key={session.id}
                    to={`/game/${session.gameId}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-2"
                  >
                    <Cover url={session.coverUrl} title={session.gameTitle} className="w-10" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-bold">{session.gameTitle}</div>
                      <div className="mt-0.5 text-[10.5px] font-semibold text-muted-foreground tabular-nums">
                        {formatTime(session.startedAt)}
                        {session.endedAt !== null && ` – ${formatTime(session.endedAt)}`}
                      </div>
                    </div>
                    {session.durationSec !== null ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-bold tabular-nums">
                        <Clock3 size={12} style={{ color: GREEN }} />
                        {formatHours(session.durationSec / 3600)}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] font-bold text-primary">now</span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Pager
        page={page}
        totalPages={totalPages}
        onChange={(next) => {
          setPage(next);
          // Cambiar de página con el scroll a mitad de la lista dejaría la
          // vista flotando sobre filas de la página nueva sin su cabecera de
          // fecha delante — esa cabecera está arriba del todo.
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />
    </div>
  );
};
