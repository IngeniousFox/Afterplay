import { Check, DollarSign, Pencil, Trash2, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import type {
  PlanHistory,
  SpendEvent,
  StateEvent,
  UpdateSpendEventPatch,
  UpdateStateEventPatch,
} from '../../../../../shared/types';
import { useUpdateStateEvent } from '../../../hooks/stateEvents';
import { DeleteHistoryEntryDialog } from './DeleteHistoryEntryDialog';
import type { DeletableHistoryEntry } from './DeleteHistoryEntryDialog';
import { useUpdateSpendEvent } from '../../../hooks/spend';
import { AMBER } from '../../../lib/colors';
import { formatDateOnly, formatMoney } from '../../../lib/format';
import { getGameStatusMeta } from '../../../lib/gameStatus';
import { enteredViaPlan, planMilestones } from '../../../lib/planMilestones';
import { StatCard } from '../../stats/StatCard';
import { StatusIcon } from '../../StatusIcon';
import { SectionLabel } from './SectionLabel';
import { NumberInput } from '../../ui/number-input';
import { DateWithPrecisionPicker } from '../add-game/DateWithPrecisionPicker';
import type { PrecisionDateValue } from '../add-game/precisionDate';
import { parseIsoDate, toPickerValue } from '../add-game/precisionDate';
import { fieldLabelClass, textInputClass } from '../add-game/styles';
import {
  compareEntityIds,
  type SpendEventId,
  type StateEventId,
} from '../../../../../shared/entityIds';

type HistoryListProps = {
  stateHistory: StateEvent[];
  spendHistory: SpendEvent[];
  // Cuándo entró el juego en Afterplay (games.addedAt) — pinta una entrada
  // sintética "Added to Afterplay" al fondo de la línea temporal. Sintética
  // de verdad: no existe como evento en la DB (ni editable ni borrable), solo
  // se deriva aquí. PlanGameDetail no la pasa: un planeado entró por el Plan,
  // y eso ya lo cuenta "Added to Plan".
  addedAt?: Date;
  // El paso por el Plan (R-06): "Added to Plan" y "Left the Plan", también
  // derivadas y de solo lectura (lib/planMilestones.ts).
  planHistory?: PlanHistory | null;
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
      id: StateEventId;
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
      event: StateEvent;
    }
  | {
      key: string;
      kind: 'spend';
      id: SpendEventId;
      date: Date;
      datePrecision: SpendEvent['datePrecision'];
      note: string | null;
      event: SpendEvent;
    }
  | {
      // "Added to Afterplay" — derivada de games.addedAt, no es un evento
      // real de la DB: sin id propio, sin edición.
      key: string;
      kind: 'added';
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
    }
  | {
      // "Added to Plan" / "Left the Plan" — derivadas de planHistory (R-06).
      key: string;
      kind: 'plan';
      label: string;
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
    };

// Las entradas derivadas a igual fecha EXACTA, de abajo arriba: primero
// "entró en Afterplay", luego "entró en el Plan", luego "salió del Plan"; los
// eventos reales, encima de todas (promocionar como Beaten escribe el
// 'completed' y la salida del Plan con el mismo instante, y se lee "salió del
// Plan" y después "lo terminó").
const DERIVED_RANK: Record<string, number> = { added: 0, 'plan-added': 1, 'plan-left': 2 };
const derivedRank = (entry: Entry): number =>
  entry.kind === 'added' || entry.kind === 'plan' ? DERIVED_RANK[entry.key] : 3;

// El orden de la lista: lo más reciente arriba y, a igual fecha EXACTA, las
// derivadas por debajo de los eventos reales (ver DERIVED_RANK). Entre dos
// eventos reales, el id más alto primero. Ese último
// desempate mezcla eventos de estado y gastos —dos tablas— y comparar sus ids
// solo es un orden estable, no "el creado después" (AFTERPLAY-2.0.md §15.5).
const newestFirst = (a: Entry, b: Entry): number => {
  const byDate = b.date.getTime() - a.date.getTime();
  if (byDate !== 0) return byDate;
  const byRank = derivedRank(b) - derivedRank(a);
  if (byRank !== 0) return byRank;
  if (a.kind === 'added' || a.kind === 'plan' || b.kind === 'added' || b.kind === 'plan') return 0;
  return compareEntityIds(b.id, a.id);
};

// El valor de picker de una entrada existente. 'datetime' (eventos creados
// en vivo por la app, con hora real) cae a 'day' para el picker — pero solo
// degrada la precisión guardada si el usuario TOCA la fecha (ver save()).
const entryPickerValue = (entry: Entry): PrecisionDateValue | null =>
  toPickerValue(entry.date, entry.datePrecision);

// SPEC 4.5/4.6 fusionado — un único "History" con estados y gastos
// entrelazados por fecha, mismo estilo de timeline para los dos. El lápiz
// de cada entrada abre un editor in-place: fecha + nota (estados) o
// cantidad + fecha + nota (gastos) — el TIPO no se toca DESDE AQUÍ (SPEC
// 4.5: cambiar de estado es apilar un evento nuevo, y esto es para erratas).
// El único sitio que sí reescribe un tipo es la corrección de desenlace del
// Edit modal, y solo para eso (SPEC 4.6).
//
// BORRAR sí se puede, y para los dos tipos de entrada: un evento apuntado
// por error (un Playing que no fue, un Resting de un despiste) es una errata
// igual que una fecha mal puesta, y la única corrección posible para "esto
// nunca pasó" es quitarlo. Es seguro por el modelo v2: TODO lo derivado
// (estado actual, fechas de inicio/fin del playthrough) se recalcula del log
// al leer, así que no queda ningún ancla colgando. Ojo con lo que NO hace a
// propósito: borrar un 'started' no arrastra el "Pausado automáticamente"
// que aquel disparó en otro playthrough — cada entrada se borra sola, un
// gesto = un efecto, y ese evento sigue a la vista para borrarlo también si
// sobra. Los iconos solo aparecen al pasar el ratón para no ensuciar la
// lista en reposo.
export const HistoryList = ({
  stateHistory,
  spendHistory,
  addedAt,
  planHistory,
}: HistoryListProps): React.JSX.Element | null => {
  const updateStateEvent = useUpdateStateEvent();
  const updateSpendEvent = useUpdateSpendEvent();
  // La entrada (estado O gasto) pendiente de confirmar su borrado (null =
  // ninguna). El aviso de la casa: la papelera abre el diálogo, nunca borra
  // a pelo — mismo flujo que sesiones, juegos y copias de partidas. Las
  // mutaciones de borrado viven en el diálogo, como en sus hermanos.
  const [deletingEntry, setDeletingEntry] = useState<DeletableHistoryEntry | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [draftAmount, setDraftAmount] = useState('');
  const [draftDate, setDraftDate] = useState<PrecisionDateValue | null>(null);
  // Antes save() disparaba .mutate() (sin esperar) y cerraba el editor en la
  // línea siguiente SIN mirar si había ido bien — un fallo (la DB en pleno
  // swap de conexión, por ejemplo) volvía la fila a sus valores viejos con
  // cero indicio de que la edición se había perdido. Se guarda aquí para
  // enseñarlo dentro del propio editor, que sigue abierto hasta que sí
  // funcione.
  const [saveError, setSaveError] = useState<string | null>(null);

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
    ...planMilestones(planHistory).map((milestone): Entry => ({
      key: milestone.key,
      kind: 'plan',
      label: milestone.label,
      date: milestone.date,
      datePrecision: 'datetime',
      note: milestone.note,
    })),
    // Sobra si el juego entró en la app por el Plan: "Added to Plan" ya lo
    // cuenta, con su nota, el mismo día.
    ...(addedAt && !enteredViaPlan(addedAt, planHistory)
      ? [
          {
            key: 'added',
            kind: 'added',
            date: addedAt,
            datePrecision: 'datetime',
            note: null,
          } satisfies Entry,
        ]
      : []),
  ].sort(newestFirst);

  if (entries.length === 0) return null;

  const startEditing = (entry: Entry): void => {
    setEditingKey(entry.key);
    setDraftNote(entry.note ?? '');
    setDraftAmount(entry.kind === 'spend' ? String(entry.event.amount) : '');
    setDraftDate(entryPickerValue(entry));
    setSaveError(null);
  };

  const save = async (entry: Entry): Promise<void> => {
    // La fecha solo entra al patch si CAMBIÓ respecto a la guardada — así un
    // evento con precisión 'datetime' (hora real) que solo edita la nota no
    // pierde su hora por el simple hecho de pasar por el picker de días.
    const original = entryPickerValue(entry);
    // Un evento sin fecha guardada ('unknown') no tiene original: cualquier
    // fecha que se elija es un cambio.
    const dateChanged =
      draftDate !== null &&
      (original === null ||
        draftDate.isoDate !== original.isoDate ||
        draftDate.precision !== original.precision);
    const datePatch = dateChanged
      ? {
          occurredAt: parseIsoDate(draftDate.isoDate),
          datePrecision: draftDate.precision,
        }
      : {};

    const note = draftNote.trim() || null;
    setSaveError(null);

    try {
      if (entry.kind === 'status') {
        const patch: UpdateStateEventPatch = { note, ...datePatch };
        await updateStateEvent.mutateAsync({ id: entry.id, patch });
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
        await updateSpendEvent.mutateAsync({ id: entry.id, patch });
      }
    } catch (error) {
      // El editor se queda ABIERTO con lo que habías escrito: cerrarlo aquí
      // habría sido la misma pérdida silenciosa que esto viene a arreglar.
      setSaveError(error instanceof Error ? error.message : String(error));
      return;
    }
    setEditingKey(null);
  };

  return (
    <div>
      <SectionLabel className="mb-3.25">History</SectionLabel>
      <StatCard className="max-h-96 overflow-x-hidden overflow-y-auto">
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          const isEditing = editingKey === entry.key;
          // 'added' comparte look con Unplayed (gris, círculo) — es el
          // estado con el que todo juego entra a la app; las del Plan, el de
          // Plan to Play.
          const statusMeta =
            entry.kind === 'status'
              ? getGameStatusMeta(entry.event.type)
              : entry.kind === 'added'
                ? getGameStatusMeta(null)
                : entry.kind === 'plan'
                  ? getGameStatusMeta('plan_to_play')
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
                    <span className="text-micro font-semibold text-muted-foreground/55 tabular-nums">
                      {entry.date.getFullYear()}
                    </span>
                    <span className="h-px flex-1 bg-bone/5" />
                  </div>
                </div>
              )}
              <div className="group/row relative -mx-2 flex gap-3.5 rounded-sm px-2 py-1.5 hover:bg-bone/[0.022]">
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
                            : entry.kind === 'plan'
                              ? entry.label
                              : formatMoney(entry.event.amount)}
                      </span>
                      {entry.kind === 'spend' && (
                        <span className="text-micro text-muted-foreground">
                          {SPEND_TYPE_LABEL[entry.event.type]}
                        </span>
                      )}
                    </div>

                    {isEditing ? (
                      // Editor multi-campo: sin auto-guardar en blur (el foco
                      // salta legítimamente de un campo a otro) — se confirma
                      // con el check o con Enter en cualquier input.
                      <div className="mt-2 flex flex-col gap-2 rounded-sm border border-input bg-bone/[0.02] p-2.5">
                        <div className="flex items-end gap-2">
                          {entry.kind === 'spend' && (
                            <div className="w-24 flex-none">
                              <div className={fieldLabelClass}>Amount (€)</div>
                              <NumberInput
                                autoFocus
                                value={draftAmount}
                                onChange={(event) => setDraftAmount(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') void save(entry);
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
                              if (event.key === 'Enter') void save(entry);
                              if (event.key === 'Escape') setEditingKey(null);
                            }}
                            placeholder="Note…"
                            className="min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 py-1.5 text-[12.5px] text-foreground outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() => void save(entry)}
                            className="flex-none rounded-md p-1.5 text-primary hover:bg-primary/10"
                            aria-label="Save changes"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingKey(null)}
                            className="flex-none rounded-md p-1.5 text-muted-foreground hover:bg-bone/6"
                            aria-label="Cancel"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        {saveError && (
                          <div className="text-micro text-destructive">
                            Couldn&apos;t save — {saveError}
                          </div>
                        )}
                      </div>
                    ) : (
                      entry.note && (
                        // Barra de acento a la izquierda: separa la nota (texto
                        // tuyo) del hecho registrado sin necesidad de comillas
                        // ni cursiva.
                        <div
                          className="mt-1.25 border-l-2 pl-2.5 text-[12.5px] text-bone"
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
                      <div className="text-micro font-semibold text-muted-foreground tabular-nums">
                        {dateLabel}
                      </div>
                    </div>
                  )}

                  {/* Hueco reservado siempre (incluso en las derivadas, que no
                    tienen acciones): si apareciera solo al pasar el ratón, la
                    fecha se desplazaría en cada hover. */}
                  {!isEditing && (
                    <div className="flex w-12.5 flex-none items-start justify-end gap-0.5 opacity-0 group-hover/row:opacity-100">
                      {(entry.kind === 'status' || entry.kind === 'spend') && (
                        <button
                          type="button"
                          onClick={() => startEditing(entry)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-bone/6 hover:text-foreground"
                          aria-label="Edit note"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {(entry.kind === 'status' || entry.kind === 'spend') && (
                        <button
                          type="button"
                          onClick={() =>
                            // Tal y como se ve en la fila (estado + fecha, o
                            // importe + tipo + fecha) — lo justo para
                            // reconocer QUÉ se va a borrar.
                            setDeletingEntry(
                              entry.kind === 'status'
                                ? {
                                    kind: 'status',
                                    id: entry.id,
                                    label: `${getGameStatusMeta(entry.event.type).label} · ${dateLabel}`,
                                  }
                                : {
                                    kind: 'spend',
                                    id: entry.id,
                                    label: `${formatMoney(entry.event.amount)} · ${SPEND_TYPE_LABEL[entry.event.type]} · ${dateLabel}`,
                                  },
                            )
                          }
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label={
                            entry.kind === 'status' ? 'Delete status entry' : 'Delete spend entry'
                          }
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

      <DeleteHistoryEntryDialog entry={deletingEntry} onClose={() => setDeletingEntry(null)} />
    </div>
  );
};
