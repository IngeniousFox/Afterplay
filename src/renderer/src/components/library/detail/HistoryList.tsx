import { Check, DollarSign, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { SpendEvent, StateEvent } from '../../../../../shared/types';
import { useUpdateStateEvent } from '../../../hooks/stateEvents';
import { useDeleteSpendEvent, useUpdateSpendEvent } from '../../../hooks/spend';
import { formatByPrecision, formatMoney } from '../../../lib/format';
import { getGameStatusMeta } from '../../../lib/gameStatus';

type HistoryListProps = {
  stateHistory: StateEvent[];
  spendHistory: SpendEvent[];
};

const SPEND_COLOR = '#e3b24a';
const SPEND_TYPE_LABEL: Record<SpendEvent['type'], string> = {
  purchase: 'Purchase',
  ingame_spend: 'In-game spend',
};

type Entry =
  | {
      key: string;
      kind: 'status';
      id: number;
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
      event: StateEvent;
    }
  | {
      key: string;
      kind: 'spend';
      id: number;
      date: Date;
      datePrecision: SpendEvent['datePrecision'];
      note: string | null;
      event: SpendEvent;
    };

// SPEC 4.5/4.6 fusionado — un único "History" con estados y gastos
// entrelazados por fecha, mismo estilo de timeline para los dos. La nota de
// cada entrada es editable in-place (icono de lápiz), y los gastos también
// se pueden borrar desde aquí — los iconos solo aparecen al pasar el ratón
// para no ensuciar la lista en reposo.
export const HistoryList = ({
  stateHistory,
  spendHistory,
}: HistoryListProps): React.JSX.Element | null => {
  const updateStateEvent = useUpdateStateEvent();
  const updateSpendEvent = useUpdateSpendEvent();
  const deleteSpend = useDeleteSpendEvent();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');

  const entries: Entry[] = [
    ...stateHistory.map((event): Entry => ({
      key: `status-${event.id}`,
      kind: 'status',
      id: event.id,
      date: event.occurredAt,
      datePrecision: event.datePrecision,
      note: event.note,
      event,
    })),
    ...spendHistory.map((event): Entry => ({
      key: `spend-${event.id}`,
      kind: 'spend',
      id: event.id,
      date: event.occurredAt,
      datePrecision: event.datePrecision,
      note: event.note,
      event,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime() || b.id - a.id);

  if (entries.length === 0) return null;

  const startEditing = (entry: Entry): void => {
    setEditingKey(entry.key);
    setDraftNote(entry.note ?? '');
  };

  const saveNote = (entry: Entry): void => {
    const note = draftNote.trim() || null;
    if (entry.kind === 'status') updateStateEvent.mutate({ id: entry.id, note });
    else updateSpendEvent.mutate({ id: entry.id, note });
    setEditingKey(null);
  };

  return (
    <div>
      <div className="mb-3.25 text-[11px] font-bold tracking-[.13em] text-muted-foreground">
        HISTORY
      </div>
      <div className="max-h-96 overflow-x-hidden overflow-y-auto rounded-[14px] border border-border bg-card px-5.5 py-5">
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          const isEditing = editingKey === entry.key;
          const color =
            entry.kind === 'status' ? getGameStatusMeta(entry.event.type).color : SPEND_COLOR;

          return (
            <div key={entry.key} className="group/row flex gap-3.75">
              <div className="relative flex flex-none flex-col items-center">
                <div
                  className="z-1 flex h-7.5 w-7.5 items-center justify-center rounded-full border"
                  style={{ background: `${color}22`, borderColor: `${color}66` }}
                >
                  {entry.kind === 'status' ? (
                    (() => {
                      const status = getGameStatusMeta(entry.event.type);
                      return (
                        <status.Icon
                          size={14}
                          color={status.color}
                          fill={status.filled ? status.color : 'none'}
                        />
                      );
                    })()
                  ) : (
                    <DollarSign size={14} color={SPEND_COLOR} />
                  )}
                </div>
                {!isLast && <div className="absolute top-7.5 bottom-0 w-px bg-input" />}
              </div>

              <div
                className={`flex flex-1 items-start justify-between gap-3 ${isLast ? 'pb-0' : 'pb-3.5'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.25">
                    <span className="text-sm font-bold" style={{ color }}>
                      {entry.kind === 'status'
                        ? getGameStatusMeta(entry.event.type).label
                        : formatMoney(entry.event.amount)}
                    </span>
                    <span className="text-[12.5px] text-muted-foreground">
                      {entry.kind === 'spend' && `${SPEND_TYPE_LABEL[entry.event.type]} — `}
                      {entry.kind === 'status' && '— '}
                      {formatByPrecision(entry.date, entry.datePrecision)}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={draftNote}
                        onChange={(event) => setDraftNote(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveNote(entry);
                          if (event.key === 'Escape') setEditingKey(null);
                        }}
                        // Guarda también al hacer click fuera — sin esto,
                        // el único sitio para confirmar era el icono de
                        // 13px, fácil de no acertar (bug reportado: "lo
                        // editas pero no se guarda").
                        onBlur={() => saveNote(entry)}
                        placeholder="Note…"
                        className="min-w-0 flex-1 rounded-md border border-input bg-white/[0.03] px-2 py-1 text-[12.5px] text-foreground outline-none"
                      />
                      <button
                        type="button"
                        // Evita que el input pierda el foco (y dispare su
                        // propio onBlur) antes de que corra este onClick —
                        // si no, Cancelar también guardaría por el blur.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => saveNote(entry)}
                        className="flex-none rounded-md p-1 text-primary hover:bg-primary/10"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => setEditingKey(null)}
                        className="flex-none rounded-md p-1 text-muted-foreground hover:bg-white/6"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    entry.note && (
                      <div className="mt-0.75 text-[13px] text-[#b7bdb8]">{entry.note}</div>
                    )
                  )}
                </div>

                {!isEditing && (
                  <div className="flex flex-none items-center gap-0.5 opacity-0 group-hover/row:opacity-100">
                    <button
                      type="button"
                      onClick={() => startEditing(entry)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-white/6 hover:text-foreground"
                      aria-label="Edit note"
                    >
                      <Pencil size={13} />
                    </button>
                    {entry.kind === 'spend' && (
                      <button
                        type="button"
                        onClick={() => deleteSpend.mutate(entry.id)}
                        disabled={deleteSpend.isPending}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        aria-label="Delete spend entry"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
