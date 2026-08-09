import { CalendarPlus, Clock3, Coins, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { GameDetail, GameSession, SpendEventRow, StateEventRow } from '../../api';
import {
  formatByPrecision,
  formatHours,
  formatMoney,
  formatTime,
  pluralize,
} from '../../lib/format';
import { AMBER, GREEN, statusOf } from '../../lib/status';
import { SectionLabel } from './primitives';

// ── Historial: estados + gasto, en una sola línea de tiempo ────────────────
//
// Van juntos y no en dos listas como en el escritorio (que tiene dos columnas
// de 300px y sitio para las dos): en móvil, dos listas cortas alternando
// cabeceras es peor de leer que una sola ordenada por fecha, que además
// cuenta mejor la historia — "lo compré, lo empecé, le metí 10€, lo dejé".

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
  if (entry.kind === 'added') {
    return (
      <div className="flex items-center gap-2.5 rounded-[11px] border border-border bg-card px-3 py-2">
        <CalendarPlus size={13} className="flex-none text-muted-foreground" />
        <span className="flex-1 text-[12px] font-semibold text-muted-foreground">
          Added to your library
        </span>
        <span className="flex-none text-[11px] font-semibold text-muted-foreground tabular-nums">
          {formatByPrecision(entry.at, 'day')}
        </span>
      </div>
    );
  }

  if (entry.kind === 'spend') {
    const isPurchase = entry.event.type === 'purchase';
    return (
      <div className="flex items-center gap-2.5 rounded-[11px] border border-border bg-card px-3 py-2">
        {isPurchase ? (
          <ShoppingCart size={13} className="flex-none" style={{ color: AMBER }} />
        ) : (
          <Coins size={13} className="flex-none" style={{ color: AMBER }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold" style={{ color: AMBER }}>
            {formatMoney(entry.event.amount)}
            <span className="ml-1.5 font-semibold text-muted-foreground">
              {isPurchase ? 'purchase' : 'in-game'}
            </span>
          </div>
          {entry.event.note && (
            <div className="truncate text-[10.5px] text-muted-foreground">{entry.event.note}</div>
          )}
        </div>
        <span className="flex-none text-[11px] font-semibold text-muted-foreground tabular-nums">
          {formatByPrecision(entry.at, entry.event.datePrecision)}
        </span>
      </div>
    );
  }

  const status = statusOf(entry.event.type);
  const StatusIcon = status.Icon;
  return (
    <div className="flex items-center gap-2.5 rounded-[11px] border border-border bg-card px-3 py-2">
      <StatusIcon
        size={13}
        className="flex-none"
        color={status.color}
        fill={status.filled ? status.color : 'none'}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold" style={{ color: status.color }}>
          {status.label}
        </div>
        {entry.event.note && (
          <div className="truncate text-[10.5px] text-muted-foreground">{entry.event.note}</div>
        )}
      </div>
      <span className="flex-none text-[11px] font-semibold text-muted-foreground tabular-nums">
        {formatByPrecision(entry.at, entry.event.datePrecision)}
      </span>
    </div>
  );
};

const PREVIEW = 6;

export const HistorySection = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const entries = buildEntries(game);
  const shown = expanded ? entries : entries.slice(0, PREVIEW);

  return (
    <section>
      <SectionLabel className="mb-2.5">HISTORY</SectionLabel>
      <div className="flex flex-col gap-1.5">
        {shown.map((entry, index) => (
          <HistoryRow key={`${entry.kind}-${index}`} entry={entry} />
        ))}
      </div>
      {entries.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-[11px] border border-border bg-card py-2 text-[11.5px] font-bold text-muted-foreground"
        >
          {expanded ? 'Show less' : `Show all ${entries.length}`}
          <ChevronDown
            size={12}
            className="transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
      )}
    </section>
  );
};

// ── Historial de sesiones ──────────────────────────────────────────────────

const SESSION_PREVIEW = 10;

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
      <div className="mb-2.5 flex items-baseline justify-between">
        <SectionLabel>SESSION HISTORY</SectionLabel>
        <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
          {pluralize(sessions.length, 'session')} · {formatHours(totalSeconds / 3600)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {shown.map((session) => (
          <div key={session.id} className="rounded-[11px] border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-2.5">
              <Clock3 size={12} className="flex-none" style={{ color: GREEN }} />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold">
                  {formatByPrecision(session.startedAt, 'day')}
                </div>
                <div className="mt-0.5 text-[10.5px] font-semibold text-muted-foreground tabular-nums">
                  {session.datePrecision === 'datetime' && (
                    <>
                      {formatTime(session.startedAt)}
                      {session.endedAt !== null && ` – ${formatTime(session.endedAt)}`}
                    </>
                  )}
                  {/* Una sesión MANUAL del modelo v1 no tiene horas de verdad
                      —solo precisión de mes o año— y decirlo evita que se lea
                      como tiempo medido. */}
                  {session.isManual && 'Logged manually'}
                </div>
              </div>
              {session.durationSec !== null ? (
                <span className="flex-none text-[12px] font-bold tabular-nums">
                  {formatHours(session.durationSec / 3600)}
                </span>
              ) : (
                <span className="flex-none text-[11px] font-bold text-primary">in progress</span>
              )}
            </div>
            {/* El diario de sesión: "dónde lo dejé". */}
            {session.note && (
              <p className="mt-1.5 border-t border-white/5 pt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {session.note}
              </p>
            )}
          </div>
        ))}
      </div>

      {sessions.length > SESSION_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-[11px] border border-border bg-card py-2 text-[11.5px] font-bold text-muted-foreground"
        >
          {expanded ? 'Show less' : `Show all ${sessions.length}`}
          <ChevronDown
            size={12}
            className="transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
      )}
    </section>
  );
};
