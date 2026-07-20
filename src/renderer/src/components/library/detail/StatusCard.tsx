import { Check } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useAddIteration } from '../../../hooks/iterations';
import { useAddStateEvent } from '../../../hooks/stateEvents';
import { daysBetween, humanizeSpan } from '../../../lib/dateMath';
import {
  ENDLESS_STATUS_OPTIONS,
  getGameStatusMeta,
  NORMAL_STATUS_OPTIONS,
  STATE_TO_STATUS_KEY,
  STATUS_META,
  STATUS_TO_STATE_TYPE,
} from '../../../lib/gameStatus';
import type { PastStatusKey } from '../../../lib/gameStatus';
import { isTerminal, lastIteration, startedIteration } from '../../../lib/iterations';
import { accentGradientStyle } from '../../../lib/styles';
import { StatusIcon } from '../../StatusIcon';
import { Dropdown } from '../add-game/Dropdown';

type StatusCardProps = {
  game: GameDetail;
};

const STATUS_ITEM_LABEL: Record<PastStatusKey, string> = {
  playing: 'Mark as Playing',
  beaten: 'Mark as Completed',
  dropped: 'Drop',
  on_hold: 'Put on Hold',
  resting: 'Rest',
};

// SPEC 10.7 — columna Status: estado actual + dropdown para elegir el
// siguiente + nota libre + "Save status". Cada guardado añade un stateEvent
// nuevo (append-only, SPEC 4.5) — nunca sobrescribe el anterior. Rediseño:
// el estado actual manda visualmente (banner con el color del propio estado
// y desde cuándo lo llevas) y el formulario de cambio queda por debajo.
export const StatusCard = ({ game }: StatusCardProps): React.JSX.Element => {
  const options = game.endless ? ENDLESS_STATUS_OPTIONS : NORMAL_STATUS_OPTIONS;
  const currentKey = game.currentState ? STATE_TO_STATUS_KEY[game.currentState] : null;
  const [pending, setPending] = useState<PastStatusKey>(
    currentKey && (options as string[]).includes(currentKey)
      ? (currentKey as PastStatusKey)
      : options[0],
  );
  const [note, setNote] = useState('');
  const addIteration = useAddIteration();
  const addStateEvent = useAddStateEvent();
  const status = getGameStatusMeta(game.currentState);
  const isSaving = addIteration.isPending || addStateEvent.isPending;

  // Desde cuándo el juego está en este estado — el evento real más reciente
  // ('plan_to_play' no cuenta: es intención, no estado de juego, mismo
  // criterio que el resto de la app). Un juego sin eventos es Unplayed y no
  // tiene "desde cuándo".
  const since = game.stateHistory
    .filter((event) => event.type !== 'plan_to_play')
    .reduce<Date | null>(
      (latest, event) =>
        latest === null || event.occurredAt.getTime() > latest.getTime()
          ? event.occurredAt
          : latest,
      null,
    );

  // SPEC 4.5 — guardar el mismo estado que ya está activo, sin nota, no
  // cambia nada de verdad: sería un evento duplicado en el log solo por
  // volver a pulsar Save (el bug reportado: "Playing" varias veces
  // seguidas). Con una nota SÍ tiene sentido (progreso: "Playing — cap. 5").
  const isNoOp = pending === currentKey && !note.trim();

  const handleSave = async (): Promise<void> => {
    if (isNoOp) return;

    const activeIteration = startedIteration(game.iterations);
    const lastIt = lastIteration(game.iterations);
    const lastIsTerminal = isTerminal(lastIt);

    // SPEC 4 — retomar "Playing" después de un final (Beaten/Dropped) es un
    // playthrough nuevo, no una reapertura del anterior; on_hold/resting sí
    // reutilizan la misma iteración, solo estaba en pausa.
    const needsNewIteration =
      !activeIteration && (!lastIt || (lastIsTerminal && pending === 'playing'));

    let iterationId = needsNewIteration ? undefined : (activeIteration?.id ?? lastIt?.id);

    if (!iterationId) {
      const iteration = await addIteration.mutateAsync({
        gameId: game.id,
        playedPlatform: game.officialPlatforms?.[0] ?? 'PC',
        origin: 'Purchased',
        format: 'digital',
      });
      iterationId = iteration.id;

      // Un playthrough nuevo siempre arranca por "Playing" en el log — si
      // no, el historial empezaría directo en "Completado"/"Dropped" sin
      // haber pasado nunca por "Jugando". Modelo v2: ese evento ES además
      // la fecha de inicio del playthrough (derivada al leer), sin sesión
      // marcadora aparte.
      if (pending !== 'playing') {
        await addStateEvent.mutateAsync({
          iterationId,
          type: 'started',
          occurredAt: new Date(),
          datePrecision: 'datetime',
          note: null,
        });
      }
    }

    await addStateEvent.mutateAsync({
      iterationId,
      type: STATUS_TO_STATE_TYPE[pending],
      occurredAt: new Date(),
      datePrecision: 'datetime',
      note: note.trim() || null,
    });
    setNote('');
  };

  return (
    <div>
      <div className="mb-3.25 text-[11px] font-bold tracking-[.13em] text-muted-foreground">
        STATUS
      </div>
      {/* Sin overflow-hidden en la card: recortaba el panel del dropdown de
          "change status" cuando se despliega hacia abajo saliéndose de ella.
          El redondeo del degradado se consigue redondeando el propio banner
          (rounded-t), no la card entera. */}
      <div className="rounded-[14px] border border-border bg-card">
        {/* Banner del estado actual: el color del propio estado como
            degradado de fondo, para que la respuesta a "¿cómo va este
            juego?" se lea antes de leer nada. rounded-t-[13px] = 14px de la
            card menos el borde de 1px, para que el degradado no asome por las
            esquinas. */}
        <div
          className="flex items-center gap-3.5 rounded-t-[13px] px-4.5 py-4"
          style={{
            background: `linear-gradient(135deg, ${status.color}1f, ${status.color}08 60%, transparent)`,
            borderBottom: `1px solid ${status.color}1f`,
          }}
        >
          <div
            className="flex h-12 w-12 flex-none items-center justify-center rounded-[13px]"
            style={{ background: `${status.color}24`, border: `1px solid ${status.color}3d` }}
          >
            <StatusIcon meta={status} size={22} />
          </div>
          <div className="min-w-0">
            <div className="text-[19px] font-extrabold" style={{ color: status.color }}>
              {status.label}
            </div>
            <div className="mt-0.25 text-[12px] text-muted-foreground">
              {since ? `for ${humanizeSpan(daysBetween(since, new Date()))}` : 'Never played yet'}
            </div>
          </div>
        </div>

        <div className="px-4.5 py-4">
          <div className="mb-2 text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
            CHANGE STATUS
          </div>
          <Dropdown
            value={pending}
            options={options}
            onChange={setPending}
            renderOption={(option) => {
              const meta = STATUS_META[option];
              return (
                <span className="flex items-center gap-1.5">
                  <StatusIcon meta={meta} size={13} />
                  {STATUS_ITEM_LABEL[option]}
                </span>
              );
            }}
          />

          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add a note (e.g. Chapter 3)…"
            className="mt-2.5 w-full rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isNoOp}
            title={
              isNoOp
                ? 'Already ' +
                  STATUS_ITEM_LABEL[pending].toLowerCase() +
                  ' — add a note to log it again'
                : undefined
            }
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[10px] py-2.75 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
            style={accentGradientStyle}
          >
            <Check size={16} />
            <span>{isSaving ? 'Saving…' : 'Save status'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
