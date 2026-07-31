import { DollarSign, History } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import type { GameDetail, SpendEvent, StateEvent } from '../../../../shared/types';
import { AMBER, VIOLET } from '../../lib/colors';
import { formatDateOnly, formatMoney } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { useTvFocusable } from '../focusContext';
import { tvRevealClass, tvRevealStyle } from '../styles';

// La línea temporal del HistoryList de escritorio (SPEC 4.5/4.6 fusionado:
// estados y gastos entrelazados por fecha), en LECTURA absoluta para el
// sofá — editar erratas es trabajo de escritorio, aquí solo se recuerda.
// Misma contabilidad que el original: la entrada sintética "Added to
// Afterplay" al fondo, el 'plan_to_play' oculto (misma fecha, misma
// información) y su nota heredada por la added para que no se pierda.

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
      id: number;
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
      type: StateEvent['type'];
    }
  | {
      key: string;
      kind: 'spend';
      id: number;
      date: Date;
      datePrecision: SpendEvent['datePrecision'];
      note: string | null;
      spendType: SpendEvent['type'];
      amount: number;
    }
  | {
      // Derivada de gamesTable.addedAt — no existe como evento en la DB.
      key: string;
      kind: 'added';
      id: number;
      date: Date;
      datePrecision: StateEvent['datePrecision'];
      note: string | null;
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
    className={`flex gap-[0.7em] px-[0.5em] ${tvRevealClass}`}
    style={tvRevealStyle(revealIndex)}
  >
    <div className="flex w-[1.6em] flex-none justify-center">
      <span
        aria-hidden
        className="w-px self-stretch"
        style={{ background: 'rgba(255,255,255,.07)' }}
      />
    </div>
    <div className="flex flex-1 items-center gap-[0.5em] py-[0.3em]">
      <span className="text-[0.5em] font-extrabold tracking-[.18em] text-muted-foreground/55 tabular-nums">
        {year}
      </span>
      <span aria-hidden className="h-px flex-1 bg-white/5" />
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
  // que todo juego entra a la app. Los gastos van en el ámbar del dinero.
  const statusMeta =
    entry.kind === 'status'
      ? getGameStatusMeta(entry.type)
      : entry.kind === 'added'
        ? getGameStatusMeta(null)
        : null;
  const color = statusMeta ? statusMeta.color : AMBER;
  const title =
    entry.kind === 'status'
      ? getGameStatusMeta(entry.type).label
      : entry.kind === 'added'
        ? 'Added to Afterplay'
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
      className={`rounded-[0.45em] px-[0.5em] py-[0.4em] transition-[background-color,box-shadow] duration-150 ${tvRevealClass}`}
      style={{
        ...tvRevealStyle(index),
        ...(focused
          ? {
              background: `${color}17`,
              boxShadow: `inset 0 0 0 1px ${color}52`,
            }
          : undefined),
      }}
    >
      <div className="flex gap-[0.7em]">
        <div className="flex flex-none flex-col items-center">
          <span
            className="flex h-[1.6em] w-[1.6em] flex-none items-center justify-center rounded-full border"
            style={{ background: `${color}1f`, borderColor: `${color}59` }}
          >
            {statusMeta ? (
              // El icono de Playing va relleno (statusMeta.filled), como en
              // todos los StatusIcon de la app — el resto, solo contorno.
              <statusMeta.Icon
                className="h-[0.8em] w-[0.8em]"
                style={{ color: statusMeta.color }}
                fill={statusMeta.filled ? statusMeta.color : 'none'}
              />
            ) : (
              <DollarSign className="h-[0.8em] w-[0.8em]" style={{ color: AMBER }} />
            )}
          </span>
          {/* El raíl arranca con el color del propio evento y se apaga hacia
              abajo — continuidad, no reja de tabla. La última entrada no
              lleva: la historia termina ahí. */}
          {!isLast && (
            <span
              aria-hidden
              className="mt-[0.15em] w-px flex-1"
              style={{ background: `linear-gradient(180deg, ${color}59, transparent)` }}
            />
          )}
        </div>

        <div className={`flex min-w-0 flex-1 gap-[0.6em] ${isLast ? '' : 'pb-[0.55em]'}`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-[0.5em] gap-y-[0.1em]">
              <span className="text-[0.7em] font-bold" style={{ color }}>
                {title}
              </span>
              {/* En los gastos el TÍTULO es la cantidad; el tipo queda como
                  susurro al lado — el dato primero, la categoría después. */}
              {entry.kind === 'spend' && (
                <span className="text-[0.55em] font-semibold text-muted-foreground">
                  {SPEND_TYPE_LABEL[entry.spendType]}
                </span>
              )}
            </div>
            {/* Barra de acento a la izquierda (hairline en boxShadow): separa
                la nota — texto TUYO — del hecho registrado, sin comillas ni
                cursiva. */}
            {entry.note && (
              <div
                className="mt-[0.25em] pl-[0.55em] text-[0.62em] leading-snug text-[#b7bdb8]"
                style={{ boxShadow: `inset 2px 0 0 ${color}40` }}
              >
                {entry.note}
              </div>
            )}
          </div>

          {/* Fecha en columna a la derecha: cada entrada la empieza en la
              misma x y el historial se puede leer en vertical. */}
          <div className="flex-none pt-[0.1em] text-right text-[0.6em] font-semibold text-muted-foreground tabular-nums">
            {dateLabel}
          </div>
        </div>
      </div>
    </div>
  );
};

export const TvDetailHistory = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const entries = useMemo<HistoryEntry[]>(() => {
    // Con la added en la línea temporal, el 'plan_to_play' es redundante
    // (misma fecha, misma información: "entró en la app vía Plan") — se
    // oculta del pintado y su nota ("Recommended by…") la hereda la added.
    const visibleStateHistory = game.stateHistory.filter((event) => event.type !== 'plan_to_play');
    const inheritedNote =
      game.stateHistory.find((event) => event.type === 'plan_to_play')?.note ?? null;

    const list: HistoryEntry[] = [
      ...visibleStateHistory.map((event): HistoryEntry => ({
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
      // id 0 (ningún evento real lo tiene): en empate de fecha exacta el
      // desempate por id la deja siempre al fondo — primero "entró en
      // Afterplay", luego todo lo demás.
      {
        key: 'added',
        kind: 'added',
        id: 0,
        date: game.addedAt,
        datePrecision: 'datetime',
        note: inheritedNote,
      },
    ];
    return list.sort((a, b) => b.date.getTime() - a.date.getTime() || b.id - a.id);
  }, [game.stateHistory, game.spendHistory, game.addedAt]);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[0.6em] border border-white/[0.08] bg-black/70"
      style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
    >
      {/* Un aliento violeta en la esquina: el historial es memoria, y la
          memoria en esta casa es violeta. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 130% at 100% 0%, rgba(124,134,200,.10), transparent 55%)',
        }}
      />
      <div className="relative flex flex-none items-center gap-[0.5em] border-b border-white/[0.07] px-[1em] py-[0.6em]">
        <History
          className="h-[0.95em] w-[0.95em] flex-none"
          style={{ color: VIOLET, filter: 'drop-shadow(0 0 0.45em rgba(124,134,200,.55))' }}
        />
        <span className="text-[0.55em] font-extrabold tracking-[.18em] text-muted-foreground">
          HISTORY
        </span>
        <span className="ml-auto text-[0.55em] font-bold text-[#a3abd8]/80 tabular-nums">
          {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <div className="relative flex flex-1 items-center justify-center text-[0.75em] text-muted-foreground">
          No history yet.
        </div>
      ) : (
        <div
          className="relative min-h-0 flex-1 overflow-y-auto px-[0.6em] py-[0.5em]"
          style={{ scrollbarWidth: 'none' }}
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

      {/* La lista se funde contra el borde inferior: pista de que hay más. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[1em] rounded-b-[0.6em] bg-gradient-to-t from-black/60 to-transparent"
      />
    </div>
  );
};
