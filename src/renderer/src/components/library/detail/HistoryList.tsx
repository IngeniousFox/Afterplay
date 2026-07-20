import { Check, DollarSign, Pencil, Trash2, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import type {
  SpendEvent,
  StateEvent,
  UpdateSpendEventPatch,
  UpdateStateEventPatch,
} from '../../../../../shared/types';
import { useUpdateStateEvent } from '../../../hooks/stateEvents';
import { useDeleteSpendEvent, useUpdateSpendEvent } from '../../../hooks/spend';
import { AMBER } from '../../../lib/colors';
import { formatDateOnly, formatMoney } from '../../../lib/format';
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
  // Cuándo entró el juego en Afterplay (gamesTable.addedAt) — pinta una
  // entrada sintética "Added to Afterplay" al fondo de la línea temporal.
  // Sintética de verdad: no existe como evento en la DB (ni editable ni
  // borrable), solo se deriva aquí. PlanGameDetail no la pasa — su evento
  // 'plan_to_play' ya cuenta lo mismo con la misma fecha.
  addedAt?: Date;
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
    }
  | {
      // "Added to Afterplay" — derivada de gamesTable.addedAt, no es un
      // evento real de la DB: sin id propio, sin edición. La nota (si hay)
      // la hereda del evento 'plan_to_play' que esta entrada oculta.
      key: string;
      kind: 'added';
      id: number;
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
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
  addedAt,
}: HistoryListProps): React.JSX.Element | null => {
  const updateStateEvent = useUpdateStateEvent();
  const updateSpendEvent = useUpdateSpendEvent();
  const deleteSpend = useDeleteSpendEvent();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [draftAmount, setDraftAmount] = useState('');
  const [draftDate, setDraftDate] = useState<PrecisionDateValue | null>(null);

  // Con la entrada "Added to Afterplay" en la línea temporal, el evento
  // 'plan_to_play' es redundante (misma fecha, misma información: "entró en
  // la app vía Plan") — se oculta SOLO del pintado; el evento sigue en la DB
  // y en la ficha del Plan (que no pasa addedAt y lo enseña como siempre).
  const visibleStateHistory = addedAt
    ? stateHistory.filter((event) => event.type !== 'plan_to_play')
    : stateHistory;

  const entries: Entry[] = [
    ...visibleStateHistory.map((event): Entry => ({
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
    // id 0 (ningún evento real lo tiene): en empate de fecha exacta (un
    // juego planeado comparte addedAt con su evento 'plan_to_play' al
    // milisegundo) el desempate por id la deja siempre al fondo — primero
    // "entró en Afterplay", luego todo lo demás. La nota del 'plan_to_play'
    // oculto ("Recommended by Marta…") se hereda aquí para que no se pierda
    // al ocultar el evento.
    ...(addedAt
      ? [
          {
            key: 'added',
            kind: 'added',
            id: 0,
            date: addedAt,
            datePrecision: 'datetime',
            note: stateHistory.find((event) => event.type === 'plan_to_play')?.note ?? null,
          } satisfies Entry,
        ]
      : []),
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
    } else if (entry.kind === 'spend') {
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
          // 'added' comparte look con Unplayed (gris, círculo) — es el
          // estado con el que todo juego entra a la app.
          const statusMeta =
            entry.kind === 'status'
              ? getGameStatusMeta(entry.event.type)
              : entry.kind === 'added'
                ? getGameStatusMeta(null)
                : null;
          const color = statusMeta ? statusMeta.color : SPEND_COLOR;
          // Solo fecha, nunca hora: el historial es la línea temporal del
          // juego (a qué días pasó qué), y la hora exacta de un cambio de
          // estado no aporta nada ahí — para eso está el Session History, que
          // sí es minuto a minuto. Un evento 'datetime' se pinta como día.
          const dateLabel = formatDateOnly(
            entry.date,
            entry.datePrecision === 'datetime' ? 'day' : entry.datePrecision,
          );
          // Marca de año al cambiar de uno a otro (las entradas van de más
          // reciente a más antigua): en historiales largos da un punto de
          // referencia sin tener que leer la fecha de cada fila. En la
          // primera no se pinta — su propia fecha ya lo dice.
          const showYearMark =
            index > 0 && entry.date.getFullYear() !== entries[index - 1].date.getFullYear();

          return (
            <Fragment key={entry.key}>
              {showYearMark && (
                <div className="flex gap-3.5">
                  <div className="flex w-8 flex-none justify-center">
                    <span className="w-px" style={{ background: 'var(--border)' }} />
                  </div>
                  <div className="flex flex-1 items-center gap-2 pb-2.5">
                    <span className="text-[10px] font-bold tracking-[.1em] text-muted-foreground/55 tabular-nums">
                      {entry.date.getFullYear()}
                    </span>
                    <span className="h-px flex-1 bg-white/5" />
                  </div>
                </div>
              )}
              <div className="group/row relative -mx-2 flex gap-3.5 rounded-[10px] px-2 py-1.5 hover:bg-white/[0.022]">
                <div className="relative flex flex-none flex-col items-center">
                  <div
                    className="z-1 flex h-8 w-8 items-center justify-center rounded-full border"
                    style={{
                      background: `${color}1f`,
                      borderColor: `${color}59`,
                      // Halo suave del color del evento: da relieve al nodo sin
                      // subir el contraste del borde, que a este tamaño se
                      // vuelve un anillo duro.
                      boxShadow: `0 0 0 3px ${color}0d`,
                    }}
                  >
                    {statusMeta ? (
                      <StatusIcon meta={statusMeta} size={14} />
                    ) : (
                      <DollarSign size={14} color={SPEND_COLOR} />
                    )}
                  </div>
                  {/* El raíl arranca con el color del propio evento y se apaga
                    hacia el siguiente — el degradado hace que la línea se lea
                    como continuidad y no como una reja de tabla. */}
                  {!isLast && (
                    <div
                      className="absolute top-8 bottom-0 w-px"
                      style={{ background: `linear-gradient(180deg, ${color}5c, var(--border))` }}
                    />
                  )}
                </div>

                <div className={`flex flex-1 gap-2.5 ${isLast ? 'pb-0.5' : 'pb-4'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-bold" style={{ color }}>
                        {entry.kind === 'status'
                          ? getGameStatusMeta(entry.event.type).label
                          : entry.kind === 'added'
                            ? 'Added to Afterplay'
                            : formatMoney(entry.event.amount)}
                      </span>
                      {entry.kind === 'spend' && (
                        <span className="text-[11.5px] text-muted-foreground">
                          {SPEND_TYPE_LABEL[entry.event.type]}
                        </span>
                      )}
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
                        // Barra de acento a la izquierda: separa la nota (texto
                        // tuyo) del hecho registrado sin necesidad de comillas
                        // ni cursiva.
                        <div
                          className="mt-1.25 border-l-2 pl-2.5 text-[12.5px] text-[#b7bdb8]"
                          style={{ borderColor: `${color}40` }}
                        >
                          {entry.note}
                        </div>
                      )
                    )}
                  </div>

                  {/* Fecha a la derecha, alineada en columna con las demás: en
                    línea tras la etiqueta cada entrada empezaba la fecha en
                    una x distinta y no había forma de leerlas en vertical. */}
                  {!isEditing && (
                    <div className="flex-none pt-0.25 text-right">
                      <div className="text-[11.5px] font-semibold text-muted-foreground tabular-nums">
                        {dateLabel}
                      </div>
                    </div>
                  )}

                  {/* Hueco reservado siempre (incluso en 'added', que no tiene
                    acciones): si apareciera solo al pasar el ratón, la fecha
                    se desplazaría en cada hover. */}
                  {!isEditing && (
                    <div className="flex w-12.5 flex-none items-start justify-end gap-0.5 opacity-0 group-hover/row:opacity-100">
                      {entry.kind !== 'added' && (
                        <button
                          type="button"
                          onClick={() => startEditing(entry)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-white/6 hover:text-foreground"
                          aria-label="Edit note"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
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
            </Fragment>
          );
        })}
      </StatCard>
    </div>
  );
};
