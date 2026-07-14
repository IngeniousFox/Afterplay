import { Check } from 'lucide-react';
import { useState } from 'react';
import type { GameDetail } from '../../../../../shared/types';
import { useAddIteration } from '../../../hooks/iterations';
import { useAddSession } from '../../../hooks/sessions';
import { useAddStateEvent } from '../../../hooks/stateEvents';
import { getGameStatusMeta, STATE_TO_STATUS_KEY, STATUS_META } from '../../../lib/gameStatus';
import { Dropdown } from '../add-game/Dropdown';
import {
  ENDLESS_STATUS_OPTIONS,
  NORMAL_STATUS_OPTIONS,
  STATUS_TO_STATE_TYPE,
} from '../add-game/types';
import type { PastStatusKey } from '../add-game/types';

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
// nuevo (append-only, SPEC 4.5) — nunca sobrescribe el anterior.
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
  const addSession = useAddSession();
  const addStateEvent = useAddStateEvent();
  const status = getGameStatusMeta(game.currentState);
  const isSaving = addIteration.isPending || addSession.isPending || addStateEvent.isPending;

  // SPEC 4.5 — guardar el mismo estado que ya está activo, sin nota, no
  // cambia nada de verdad: sería un evento duplicado en el log solo por
  // volver a pulsar Save (el bug reportado: "Playing" varias veces
  // seguidas). Con una nota SÍ tiene sentido (progreso: "Playing — cap. 5").
  const isNoOp = pending === currentKey && !note.trim();

  const handleSave = async (): Promise<void> => {
    if (isNoOp) return;

    const activeIteration = game.iterations.find((it) => it.currentState === 'started');
    const lastIteration = game.iterations[game.iterations.length - 1];
    const lastIsTerminal =
      lastIteration != null &&
      (lastIteration.currentState === 'completed' || lastIteration.currentState === 'dropped');

    // SPEC 4 — retomar "Playing" después de un final (Beaten/Dropped) es un
    // playthrough nuevo, no una reapertura del anterior; on_hold/resting sí
    // reutilizan la misma iteración, solo estaba en pausa.
    const needsNewIteration =
      !activeIteration && (!lastIteration || (lastIsTerminal && pending === 'playing'));

    let iterationId = needsNewIteration ? undefined : (activeIteration?.id ?? lastIteration?.id);

    if (!iterationId) {
      const iteration = await addIteration.mutateAsync({
        gameId: game.id,
        playedPlatform: game.officialPlatforms?.[0] ?? 'PC',
        origin: 'Purchased',
        format: 'digital',
      });
      iterationId = iteration.id;

      // "Started" se deriva de la sesión ancla (SPEC 4), así que un
      // playthrough nuevo necesita una para que no se quede en "—" —
      // aquí no hay sesión real que trackear (es un cambio de estado
      // manual, no el botón Play), así que se ancla con una de duración 0
      // en el momento de guardar, igual que createGameWithDetails.ts.
      const startedNow = new Date();
      await addSession.mutateAsync({
        iterationId,
        startedAt: startedNow,
        endedAt: startedNow,
        durationSec: 0,
        datePrecision: 'datetime',
        milestone: 'started',
        anchorAs: 'start',
      });

      // Un playthrough nuevo siempre arranca por "Playing" en el log —
      // si no, el historial empezaría directo en "Completado"/"Dropped"
      // sin haber pasado nunca por "Jugando".
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
      <div className="rounded-[14px] border border-border bg-card p-4.5">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10.5 w-10.5 flex-none items-center justify-center rounded-[11px]"
            style={{ background: `${status.color}22` }}
          >
            <status.Icon
              size={20}
              color={status.color}
              fill={status.filled ? status.color : 'none'}
            />
          </div>
          <div>
            <div className="text-[16px] font-bold" style={{ color: status.color }}>
              {status.label}
            </div>
            <div className="text-xs text-muted-foreground">Current status</div>
          </div>
        </div>

        <div className="mt-4">
          <Dropdown
            value={pending}
            options={options}
            onChange={setPending}
            renderOption={(option) => {
              const meta = STATUS_META[option];
              return (
                <span className="flex items-center gap-1.5">
                  <meta.Icon
                    size={13}
                    color={meta.color}
                    fill={meta.filled ? meta.color : 'none'}
                  />
                  {STATUS_ITEM_LABEL[option]}
                </span>
              );
            }}
          />
        </div>

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
          style={{ background: 'linear-gradient(135deg,#2fdc7e,#16a35a)', color: '#08120c' }}
        >
          <Check size={16} />
          <span>{isSaving ? 'Saving…' : 'Save status'}</span>
        </button>
      </div>
    </div>
  );
};
