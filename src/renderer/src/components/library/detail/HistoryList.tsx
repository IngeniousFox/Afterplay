import { Check, DollarSign, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type {
  SpendEvent,
  StateEvent,
  UpdateSpendEventPatch,
  UpdateStateEventPatch,
} from '../../../../../shared/types';
import { useUpdateStateEvent } from '../../../hooks/stateEvents';
import { useDeleteSpendEvent, useUpdateSpendEvent } from '../../../hooks/spend';
import { useTimeFormat } from '../../../hooks/settings';
import { AMBER } from '../../../lib/colors';
import { formatByPrecision, formatMoney } from '../../../lib/format';
import { getGameStatusMeta } from '../../../lib/gameStatus';
import { StatCard } from '../../stats/StatCard';
import { StatusIcon } from '../../StatusIcon';
import { NumberInput } from '../../ui/number-input';
import { DateWithPrecisionPicker } from '../add-game/DateWithPrecisionPicker';
import type { PrecisionDateValue } from '../add-game/precisionDate';
import { parseIsoDate, toPickerValue } from '../add-game/precisionDate';
import { fieldLabelClass, textInputClass } from '../add-game/styles';

type HistoryListProps = {
  stateHistory: StateEvent[];
  spendHistory: SpendEvent[];
};

const SPEND_COLOR = AMBER;
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

// El valor de picker de una entrada existente. 'datetime' (eventos creados
// en vivo por la app, con hora real) cae a 'day' para el picker — pero solo
// degrada la precisión guardada si el usuario TOCA la fecha (ver save()).
const entryPickerValue = (entry: Entry): PrecisionDateValue =>
  toPickerValue(entry.date, entry.datePrecision);

// SPEC 4.5/4.6 fusionado — un único "History" con estados y gastos
// entrelazados por fecha, mismo estilo de timeline para los dos. El lápiz
// de cada entrada abre un editor in-place: fecha + nota (estados) o
// cantidad + fecha + nota (gastos) — el TIPO nunca se edita (SPEC 4.5,
// corregir un estado es añadir un evento nuevo; esto es para erratas). Los
// gastos también se pueden borrar desde aquí — los iconos solo aparecen al
// pasar el ratón para no ensuciar la lista en reposo.
export const HistoryList = ({
  stateHistory,
  spendHistory,
}: HistoryListProps): React.JSX.Element | null => {
  const updateStateEvent = useUpdateStateEvent();
  const updateSpendEvent = useUpdateSpendEvent();
  const deleteSpend = useDeleteSpendEvent();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [draftAmount, setDraftAmount] = useState('');
  const [draftDate, setDraftDate] = useState<PrecisionDateValue | null>(null);

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
    setDraftAmount(entry.kind === 'spend' ? String(entry.event.amount) : '');
    setDraftDate(entryPickerValue(entry));
  };

  const save = (entry: Entry): void => {
    // La fecha solo entra al patch si CAMBIÓ respecto a la guardada — así un
    // evento con precisión 'datetime' (hora real) que solo edita la nota no
    // pierde su hora por el simple hecho de pasar por el picker de días.
    const original = entryPickerValue(entry);
    const dateChanged =
      draftDate !== null &&
      (draftDate.isoDate !== original.isoDate || draftDate.precision !== original.precision);
    const datePatch = dateChanged
      ? {
          occurredAt: parseIsoDate(draftDate.isoDate),
          datePrecision: draftDate.precision,
        }
      : {};

    const note = draftNote.trim() || null;

    if (entry.kind === 'status') {
      const patch: UpdateStateEventPatch = { note, ...datePatch };
      updateStateEvent.mutate({ id: entry.id, patch });
    } else {
      const parsedAmount = Number(draftAmount);
      const amountValid =
        draftAmount.trim() !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
      const patch: UpdateSpendEventPatch = {
        note,
        ...datePatch,
        // Cantidad inválida (vacía/0/no numérica): se conserva la guardada
        // en vez de romper el gasto.
        ...(amountValid && parsedAmount !== entry.event.amount ? { amount: parsedAmount } : {}),
      };
      updateSpendEvent.mutate({ id: entry.id, patch });
    }
    setEditingKey(null);
  };

  return (
    <div>
      <div className="mb-3.25 text-[11px] font-bold tracking-[.13em] text-muted-foreground">
        HISTORY
      </div>
      <StatCard className="max-h-96 overflow-x-hidden overflow-y-auto">
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
                    <StatusIcon meta={getGameStatusMeta(entry.event.type)} size={14} />
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
                      {formatByPrecision(entry.date, entry.datePrecision, timeFormat)}
                    </span>
                  </div>

                  {isEditing ? (
                    // Editor multi-campo: sin auto-guardar en blur (el foco
                    // salta legítimamente de un campo a otro) — se confirma
                    // con el check o con Enter en cualquier input.
                    <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-input bg-white/[0.02] p-2.5">
                      <div className="flex items-end gap-2">
                        {entry.kind === 'spend' && (
                          <div className="w-24 flex-none">
                            <div className={fieldLabelClass}>AMOUNT (€)</div>
                            <NumberInput
                              autoFocus
                              value={draftAmount}
                              onChange={(event) => setDraftAmount(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') save(entry);
                                if (event.key === 'Escape') setEditingKey(null);
                              }}
                              min={0}
                              step="0.01"
                              className={textInputClass}
                            />
                          </div>
                        )}
                        <DateWithPrecisionPicker
                          label="Date"
                          value={draftDate}
                          onChange={(next) => {
                            // La X del picker dejaría la entrada sin fecha —
                            // eso aquí no existe (toda entrada tiene fecha):
                            // se ignora y se mantiene la que había.
                            if (next) setDraftDate(next);
                          }}
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus={entry.kind === 'status'}
                          value={draftNote}
                          onChange={(event) => setDraftNote(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') save(entry);
                            if (event.key === 'Escape') setEditingKey(null);
                          }}
                          placeholder="Note…"
                          className="min-w-0 flex-1 rounded-md border border-input bg-white/[0.03] px-2 py-1.5 text-[12.5px] text-foreground outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => save(entry)}
                          className="flex-none rounded-md p-1.5 text-primary hover:bg-primary/10"
                          aria-label="Save changes"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingKey(null)}
                          className="flex-none rounded-md p-1.5 text-muted-foreground hover:bg-white/6"
                          aria-label="Cancel"
                        >
                          <X size={14} />
                        </button>
                      </div>
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
      </StatCard>
    </div>
  );
};
