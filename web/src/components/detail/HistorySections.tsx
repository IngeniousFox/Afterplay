import { useState } from 'react';
import type { GameDetail, GameSession, SpendEventRow, StateEventRow } from '../../api';
import { cn } from '../../lib/cn';
import {
  formatByPrecision,
  formatHours,
  formatMoney,
  formatTime,
  pluralize,
} from '../../lib/format';
import { statusOf } from '../../lib/status';
import { ledClass, statusTextClass } from '../../lib/styles';
import { Figure } from '../Figure';
import { LiveBadge } from '../LiveBadge';
import { SectionLabel, ShowMoreButton } from './primitives';

// ── Historial: estados + gasto, en una sola línea de tiempo ────────────────
//
// Van juntos y no en dos listas como en el escritorio (que tiene dos columnas
// de 300px y sitio para las dos): en móvil, dos listas cortas alternando
// cabeceras es peor de leer que una sola ordenada por fecha, que además
// cuenta mejor la historia — "lo compré, lo empecé, le metí 10€, lo dejé".
// Se pinta como un raíl vertical con el LED de cada estado.

type Entry =
  | { kind: 'state'; at: number; event: StateEventRow }
  | { kind: 'spend'; at: number; event: SpendEventRow }
  | { kind: 'added'; at: number };

const buildEntries = (game: GameDetail): Entry[] => {
  const entries: Entry[] = [
    ...game.stateHistory.map((event) => ({ kind: 'state' as const, at: event.occurredAt, event })),
    ...game.spendHistory.map((event) => ({ kind: 'spend' as const, at: event.occurredAt, event })),
    { kind: 'added' as const, at: game.addedAt },
  ];
  return entries.sort((a, b) => b.at - a.at);
};

const HistoryRow = ({ entry }: { entry: Entry }): React.JSX.Element => {
  const date =
    entry.kind === 'added'
      ? formatByPrecision(entry.at, 'day')
      : formatByPrecision(entry.at, entry.event.datePrecision);

  const dot =
    entry.kind === 'state'
      ? ledClass(entry.event.type)
      : entry.kind === 'spend'
        ? 'bg-phosphor'
        : 'bg-dust';

  return (
    <li className="group relative flex gap-3 pb-4 pl-6 last:pb-0">
      {/* El raíl: una línea que une los puntos, cortada en el último. */}
      <span
        aria-hidden="true"
        className="absolute top-2 bottom-0 left-[5px] w-px bg-line-strong group-last:hidden"
      />
      <span
        aria-hidden="true"
        className={cn('absolute top-1.5 left-0 size-[11px] rounded-full ring-2 ring-cabinet', dot)}
      />
      <div className="min-w-0 flex-1">
        {entry.kind === 'state' && (
          <div className={cn('text-body font-semibold', statusTextClass(entry.event.type))}>
            {statusOf(entry.event.type).label}
          </div>
        )}
        {entry.kind === 'spend' && (
          <div className="text-body font-semibold text-bone">
            {formatMoney(entry.event.amount)}
            <span className="ml-1.5 font-normal text-dust">
              {entry.event.type === 'purchase' ? 'Purchase' : 'In-game'}
            </span>
          </div>
        )}
        {entry.kind === 'added' && (
          <div className="text-body font-semibold text-dust">Added to your library</div>
        )}
        {entry.kind !== 'added' && entry.event.note && (
          <p className="mt-0.5 text-small text-dust">{entry.event.note}</p>
        )}
      </div>
      <span className="shrink-0 pt-0.5 text-small text-dust tabular-nums">{date}</span>
    </li>
  );
};

const PREVIEW = 6;

export const HistorySection = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const entries = buildEntries(game);
  const shown = expanded ? entries : entries.slice(0, PREVIEW);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <SectionLabel>History</SectionLabel>
        <span className="text-small text-dust tabular-nums">{entries.length}</span>
      </div>
      <ol>
        {shown.map((entry, index) => (
          <HistoryRow key={`${entry.kind}-${index}`} entry={entry} />
        ))}
      </ol>
      {entries.length > PREVIEW && (
        <ShowMoreButton
          expanded={expanded}
          total={entries.length}
          onToggle={() => setExpanded((previous) => !previous)}
        />
      )}
    </section>
  );
};

// ── Historial de sesiones ──────────────────────────────────────────────────

const SESSION_PREVIEW = 4;

export const SessionHistorySection = ({
  sessions,
}: {
  sessions: GameSession[];
}): React.JSX.Element | null => {
  const [expanded, setExpanded] = useState(false);
  if (sessions.length === 0) return null;

  const shown = expanded ? sessions : sessions.slice(0, SESSION_PREVIEW);
  const totalSeconds = sessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel>Session history</SectionLabel>
        <span className="text-small text-dust tabular-nums">
          {pluralize(sessions.length, 'session')} · {formatHours(totalSeconds / 3600)}
        </span>
      </div>

      <ul className="mt-1">
        {shown.map((session) => (
          <li key={session.id} className="border-b border-line py-2.5 last:border-b-0">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                {/* La precisión REAL de la fila, no un 'day' fijo: una sesión
                    manual del modelo v1 con precisión de año se pintaba como
                    "January 1, 2021" — un día concreto que nunca se registró.
                    Solo se degrada a 'day' cuando la fila SÍ tiene hora, porque
                    esa hora ya va en la línea de abajo. */}
                <div className="text-body font-semibold text-bone">
                  {session.datePrecision === 'datetime'
                    ? formatByPrecision(session.startedAt, 'day')
                    : formatByPrecision(session.startedAt, session.datePrecision)}
                </div>
                <div className="text-small text-dust tabular-nums">
                  {session.datePrecision === 'datetime' && (
                    <>
                      {formatTime(session.startedAt)}
                      {session.endedAt !== null ? ` to ${formatTime(session.endedAt)}` : ' to now'}
                    </>
                  )}
                  {/* Una sesión MANUAL del modelo v1 no tiene horas de verdad
                      —solo precisión de mes o año— y decirlo evita que se lea
                      como tiempo medido. */}
                  {session.isManual && 'Logged manually'}
                </div>
              </div>
              {session.durationSec !== null ? (
                <Figure
                  value={formatHours(session.durationSec / 3600)}
                  className="shrink-0 text-[26px] leading-none text-bone"
                />
              ) : (
                <LiveBadge label="now" />
              )}
            </div>
            {/* El diario de sesión: "dónde lo dejé". */}
            {session.note && (
              <p className="mt-1.5 border-l-2 border-phosphor pl-2.5 text-small text-dust">
                {session.note}
              </p>
            )}
          </li>
        ))}
      </ul>

      {sessions.length > SESSION_PREVIEW && (
        <ShowMoreButton
          expanded={expanded}
          total={sessions.length}
          onToggle={() => setExpanded((previous) => !previous)}
        />
      )}
    </section>
  );
};
