import { Fragment, useMemo } from 'react';
import type { GameDetail, SpendEvent, StateEvent } from '../../../../shared/types';
import { cn } from '@/lib/utils';
import { formatDateOnly, formatMoney } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { enteredViaPlan, planMilestones } from '../../lib/planMilestones';
import { useTvFocusable } from '../focusContext';
import { tvFocusHalo, tvFocusMotion, tvLabelClass, tvRevealClass, tvRevealStyle } from '../styles';
import { TvFigure } from '../tvUi';
import {
  compareEntityIds,
  type SpendEventId,
  type StateEventId,
} from '../../../../shared/entityIds';

// La línea temporal del HistoryList de escritorio (SPEC 4.5/4.6 fusionado:
// estados y gastos entrelazados por fecha), en LECTURA absoluta para el
// sofá — editar erratas es trabajo de escritorio, aquí solo se recuerda.
// Misma contabilidad que el original: la entrada sintética "Added to
// Afterplay" al fondo y el paso por el Plan ("Added to Plan", "Left the
// Plan", lib/planMilestones.ts), con "Added to Afterplay" fuera cuando el
// juego entró por el Plan.

const SPEND_TYPE_LABEL: Record<SpendEvent['type'], string> = {
  purchase: 'Purchase',
  ingame_spend: 'In-game spend',
};

// La forma plana que necesita el pintado — solo lectura, así que no hace
// falta arrastrar el evento entero como hace el escritorio (él lo guarda
// para poder editarlo; aquí no se edita nada).
type HistoryEntry =
  | {
      key: string;
      kind: 'status';
      id: StateEventId;
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
      type: StateEvent['type'];
    }
  | {
      key: string;
      kind: 'spend';
      id: SpendEventId;
      date: Date;
      datePrecision: SpendEvent['datePrecision'];
      note: string | null;
      spendType: SpendEvent['type'];
      amount: number;
    }
  | {
      // Derivada de games.addedAt — no existe como evento en la DB.
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

// Las derivadas a igual fecha EXACTA, de abajo arriba (mismo orden que el
// HistoryList de escritorio): entró en Afterplay, entró en el Plan, salió
// del Plan; los eventos reales, encima.
const DERIVED_RANK: Record<string, number> = { added: 0, 'plan-added': 1, 'plan-left': 2 };
const derivedRank = (entry: HistoryEntry): number =>
  entry.kind === 'added' || entry.kind === 'plan' ? DERIVED_RANK[entry.key] : 3;

// El orden del historial, el mismo que el del escritorio (HistoryList): lo
// más reciente arriba, las derivadas por debajo de los eventos reales a igual
// fecha exacta (DERIVED_RANK) y, entre dos eventos reales, el id más alto
// primero. Ese último desempate mezcla estados y
// gastos (dos tablas): es un orden estable, no "el creado después".
const newestFirst = (a: HistoryEntry, b: HistoryEntry): number => {
  const byDate = b.date.getTime() - a.date.getTime();
  if (byDate !== 0) return byDate;
  const byRank = derivedRank(b) - derivedRank(a);
  if (byRank !== 0) return byRank;
  if (a.kind === 'added' || a.kind === 'plan' || b.kind === 'added' || b.kind === 'plan') return 0;
  return compareEntityIds(b.id, a.id);
};

// La marca de AÑO entre entradas: en historiales largos da un punto de
// referencia sin leer la fecha de cada fila (misma razón que el escritorio).
// El segmento de raíl fantasma en la columna del nodo mantiene la línea
// vertical visualmente continua a su paso.
const YearMarkTv = ({
  year,
  revealIndex,
}: {
  year: number;
  revealIndex: number;
}): React.JSX.Element => (
  <div
    className={cn('flex gap-[0.9em] px-[0.6em]', tvRevealClass)}
    style={tvRevealStyle(revealIndex)}
  >
    <div className="flex w-[0.9em] flex-none justify-center">
      <span aria-hidden className="w-px self-stretch bg-line-strong" />
    </div>
    <div className="flex flex-1 items-center gap-[0.6em] py-[0.4em]">
      <span className="font-display text-[1.5em] leading-none font-bold text-dust tabular-nums">
        {year}
      </span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  </div>
);

// Fila de timeline en LECTURA, con el lenguaje de foco de SessionRowTv:
// enfocable solo para que el stick recorra y la lista haga scroll (sin
// onSelect — el motor silencia A), y la luz del foco DENTRO de la fila
// (fondo suave + anillo interior del color del evento) porque la lista
// recorta cualquier anillo exterior.
const HistoryRowTv = ({
  entry,
  index,
  isLast,
}: {
  entry: HistoryEntry;
  index: number;
  isLast: boolean;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({});
  // 'added' comparte look con Unplayed (gris, círculo) — es el estado con el
  // que todo juego entra a la app; las del Plan, el de Plan to Play. Los
  // gastos van en el ámbar del dinero.
  const statusMeta =
    entry.kind === 'status'
      ? getGameStatusMeta(entry.type)
      : entry.kind === 'added'
        ? getGameStatusMeta(null)
        : entry.kind === 'plan'
          ? getGameStatusMeta('plan_to_play')
          : null;
  // El color de estado viene del dato; los gastos van en Phosphor.
  const color = statusMeta ? statusMeta.color : 'var(--color-phosphor)';
  const title =
    entry.kind === 'status'
      ? getGameStatusMeta(entry.type).label
      : entry.kind === 'added'
        ? 'Added to Afterplay'
        : entry.kind === 'plan'
          ? entry.label
          : formatMoney(entry.amount);
  // Solo fecha, nunca hora — decisión heredada del escritorio: el historial
  // es la línea temporal del juego (a qué días pasó qué) y el minuto a
  // minuto vive en Sessions. Un evento 'datetime' se pinta como día.
  const dateLabel = formatDateOnly(
    entry.date,
    entry.datePrecision === 'datetime' ? 'day' : entry.datePrecision,
  );

  return (
    <div
      ref={ref}
      className={cn(
        'flex gap-[0.9em] px-[0.6em] py-[0.3em]',
        tvFocusMotion,
        focused && ['bg-raised', tvFocusHalo],
        tvRevealClass,
      )}
      style={tvRevealStyle(index)}
    >
      <div className="flex w-[0.9em] flex-none flex-col items-center">
        {/* El LED del evento sobre el raíl; la última entrada no lleva raíl
            por debajo: la historia termina ahí. */}
        <span
          aria-hidden
          className="mt-[0.45em] block size-[0.7em] flex-none rounded-full"
          style={{ background: color }}
        />
        {!isLast && <span aria-hidden className="mt-[0.2em] w-px flex-1 bg-line-strong" />}
      </div>

      <div className={cn('flex min-w-0 flex-1 gap-[1em]', !isLast && 'pb-[0.6em]')}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-[0.6em] gap-y-[0.1em]">
            {entry.kind === 'spend' ? (
              <TvFigure value={title} className="text-[1.4em] text-phosphor" />
            ) : (
              <span className="font-semibold" style={{ color }}>
                {title}
              </span>
            )}
            {/* En los gastos el TÍTULO es la cantidad; el tipo, al lado. */}
            {entry.kind === 'spend' && (
              <span className="text-[0.92em] font-semibold text-dust">
                {SPEND_TYPE_LABEL[entry.spendType]}
              </span>
            )}
          </div>
          {entry.note && (
            <div className="mt-[0.2em] text-[0.92em] leading-snug text-bone">{entry.note}</div>
          )}
        </div>

        {/* Fecha en columna a la derecha: cada entrada la empieza en la
            misma x. */}
        <div className="flex-none pt-[0.1em] text-right text-[0.92em] font-semibold text-dust tabular-nums">
          {dateLabel}
        </div>
      </div>
    </div>
  );
};

export const TvDetailHistory = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const entries = useMemo<HistoryEntry[]>(() => {
    const list: HistoryEntry[] = [
      ...game.stateHistory.map((event): HistoryEntry => ({
        key: `status-${event.id}`,
        kind: 'status',
        id: event.id,
        date: event.occurredAt,
        datePrecision: event.datePrecision,
        note: event.note,
        type: event.type,
      })),
      ...game.spendHistory.map((event): HistoryEntry => ({
        key: `spend-${event.id}`,
        kind: 'spend',
        id: event.id,
        date: event.occurredAt,
        datePrecision: event.datePrecision,
        note: event.note,
        spendType: event.type,
        amount: event.amount,
      })),
      ...planMilestones(game.planHistory).map((milestone): HistoryEntry => ({
        key: milestone.key,
        kind: 'plan',
        label: milestone.label,
        date: milestone.date,
        datePrecision: 'datetime',
        note: milestone.note,
      })),
      // Sobra si el juego entró por el Plan: "Added to Plan" ya lo cuenta.
      ...(enteredViaPlan(game.addedAt, game.planHistory)
        ? []
        : [
            {
              key: 'added',
              kind: 'added',
              date: game.addedAt,
              datePrecision: 'datetime',
              note: null,
            } satisfies HistoryEntry,
          ]),
    ];
    return list.sort(newestFirst);
  }, [game.stateHistory, game.spendHistory, game.addedAt, game.planHistory]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-baseline gap-[0.6em] px-[0.6em] pb-[0.6em]">
        <span className={tvLabelClass}>History</span>
        <span className="text-[0.92em] font-semibold text-dust tabular-nums">{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <div className="relative flex flex-1 items-center justify-center text-[1em] text-dust">
          No history yet.
        </div>
      ) : (
        <div
          className="relative min-h-0 flex-1 overflow-y-auto px-[0.6em] pt-[0.6em] pb-[1.4em]"
          style={{
            scrollbarWidth: 'none',
            scrollPaddingTop: '0.6em',
            scrollPaddingBottom: '1.2em',
          }}
        >
          {entries.map((entry, index) => (
            <Fragment key={entry.key}>
              {/* Nunca antes de la primera: su propia fecha ya dice el año. */}
              {index > 0 && entry.date.getFullYear() !== entries[index - 1].date.getFullYear() && (
                <YearMarkTv year={entry.date.getFullYear()} revealIndex={index} />
              )}
              <HistoryRowTv entry={entry} index={index} isLast={index === entries.length - 1} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
