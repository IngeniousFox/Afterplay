import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSessions } from '../api';
import { CalendarClock } from 'lucide-react';
import { Cover } from '../components/Cover';
import { Figure } from '../components/Figure';
import { LiveBadge } from '../components/LiveBadge';
import { PageHeader } from '../components/PageHeader';
import { Pager } from '../components/Pager';
import { ErrorState, Loading, StateMessage } from '../components/States';
import { cn } from '../lib/cn';
import { formatHours, formatTime, pluralize } from '../lib/format';
import { groupPageByDate } from '../lib/sessionGroups';
import { revealClass, revealDelay, rowLinkClass } from '../lib/styles';

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

  const total = query.data?.total;
  const header = (
    <PageHeader
      title="Sessions"
      aside={total !== undefined && total > 0 ? pluralize(total, 'session') : undefined}
    />
  );

  if (query.isPending)
    return (
      <div className="px-4">
        {header}
        <Loading label="Reading your sessions" />
      </div>
    );
  if (query.isError)
    return (
      <div className="px-4">
        {header}
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </div>
    );

  const { sessions } = query.data;
  if (query.data.total === 0)
    return (
      <div className="px-4">
        {header}
        <StateMessage
          Icon={CalendarClock}
          title="No sessions yet"
          hint="Play something on a PC with Afterplay, or start a timer from a game's page."
        />
      </div>
    );

  const totalPages = Math.max(1, Math.ceil(query.data.total / PAGE_SIZE));
  // `now` se calcula UNA vez por render, no una por sesión, para que todas las
  // filas de la misma pasada usen el mismo "hoy".
  const groups = groupPageByDate(sessions, new Date());

  return (
    <div className="px-4 pb-6">
      {header}

      <div className="flex flex-col gap-5 border-t border-line pt-4">
        {groups.map((group, index) => {
          const groupHours =
            group.sessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0) / 3600;

          return (
            <section
              key={`${group.label}-${index}`}
              className={revealClass}
              style={revealDelay(index, 60, 6)}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lead font-semibold text-bone">{group.label}</h2>
                {groupHours > 0 && (
                  <Figure
                    value={formatHours(groupHours)}
                    className="text-[20px] leading-none text-dust"
                    unitClassName="text-dust"
                  />
                )}
              </div>

              <ul className="mt-1">
                {group.sessions.map((session) => (
                  <li key={session.id} className="border-b border-line last:border-b-0">
                    <Link to={`/game/${session.gameId}`} className={rowLinkClass}>
                      <Cover url={session.coverUrl} title={session.gameTitle} className="w-10" />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-body font-semibold text-bone">
                          {session.gameTitle}
                        </div>
                        <div className="mt-0.5 text-small text-dust tabular-nums">
                          {/* Una sesión manual sin hora (precisión de día,
                              mes o año) no tiene horario que enseñar. */}
                          {session.datePrecision === 'datetime'
                            ? `${formatTime(session.startedAt)} to ${
                                session.endedAt !== null ? formatTime(session.endedAt) : 'now'
                              }`
                            : 'Logged manually'}
                          {session.isManual &&
                            session.datePrecision === 'datetime' &&
                            ' · Logged manually'}
                        </div>
                      </div>
                      {session.durationSec !== null ? (
                        <Figure
                          value={formatHours(session.durationSec / 3600)}
                          className={cn('shrink-0 text-[26px] leading-none text-bone')}
                        />
                      ) : (
                        <LiveBadge label="now" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
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
