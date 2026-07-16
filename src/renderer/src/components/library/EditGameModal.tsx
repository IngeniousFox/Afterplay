import { Save, X } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import type { GameDetail } from '../../../../shared/types';
import { useUpdateGame } from '../../hooks/games';
import { useAddIteration, useUpdateIteration } from '../../hooks/iterations';
import { useAddSession, useUpdateMilestoneSession } from '../../hooks/sessions';
import { useAddStateEvent } from '../../hooks/stateEvents';
import { STATE_TO_STATUS_KEY } from '../../lib/gameStatus';
import { Dialog, DialogContent } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { CheckboxRow } from './add-game/CheckboxRow';
import { fieldLabelClass, textInputClass } from './add-game/styles';
import { STATUS_TO_STATE_TYPE } from './add-game/types';
import { ExecutablePathField } from './edit-game/ExecutablePathField';
import { InstallDirectoryField } from './edit-game/InstallDirectoryField';
import { IterationSection } from './edit-game/IterationSection';
import { anchorPickerValue, milestoneAnchor } from './edit-game/types';
import type { EditGameFormValues } from './edit-game/types';

type EditGameModalProps = {
  game: GameDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const parseOptionalNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isNaN(value) ? null : value;
};

const isoDateToDate = (isoDate: string): Date => new Date(`${isoDate}T00:00:00`);

const buildDefaults = (game: GameDetail): EditGameFormValues => {
  const iteration =
    game.iterations.find((it) => it.currentState === 'started') ??
    game.iterations[game.iterations.length - 1] ??
    null;

  return {
    title: game.title,
    installDirectory: game.installDirectory ?? '',
    installSizeBytes: game.installSizeBytes,
    executablePath: game.executablePath ?? '',
    notes: game.notes ?? '',
    endless: game.endless,
    iterationMode: iteration ? 'existing' : 'none',
    selectedIterationId: iteration?.id ?? null,
    label: iteration?.label ?? '',
    // Editables solo cuando el ancla es un marcador manual — misma regla
    // que loadIteration() en IterationSection.tsx.
    started: iteration ? anchorPickerValue(milestoneAnchor(iteration, 'start')) : null,
    finished: iteration ? anchorPickerValue(milestoneAnchor(iteration, 'end')) : null,
    extraContent: iteration?.extraContent ?? false,
    status: iteration?.currentState ? STATE_TO_STATUS_KEY[iteration.currentState] : 'beaten',
    platform: iteration?.playedPlatform ?? 'Steam',
    format: iteration?.format ?? 'digital',
    origin: iteration?.origin ?? 'Purchased',
    hoursPlayed:
      iteration?.manualTotalPlayed !== null && iteration?.manualTotalPlayed !== undefined
        ? String(iteration.manualTotalPlayed)
        : '',
  };
};

// SPEC 10.7 — el modal más complejo de la app: campos del juego + la
// sección de playthrough (SPEC 4.5), todo en un único "Save changes". La
// carátula/hero se editan aparte, en ChangeCoverModal — este modal ya no
// los toca (petición explícita: "Change cover" no debe pasar por aquí).
export const EditGameModal = ({
  game,
  open,
  onOpenChange,
}: EditGameModalProps): React.JSX.Element => {
  const methods = useForm<EditGameFormValues>({ defaultValues: buildDefaults(game) });
  const { control, getValues, reset, setValue } = methods;
  const endless = useWatch({ control, name: 'endless' });

  useEffect(() => {
    if (open) reset(buildDefaults(game));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, game]);

  const updateGame = useUpdateGame();
  const addIteration = useAddIteration();
  const updateIteration = useUpdateIteration();
  const addSession = useAddSession();
  const addStateEvent = useAddStateEvent();
  const updateMilestoneSession = useUpdateMilestoneSession();

  const isSaving =
    updateGame.isPending ||
    addIteration.isPending ||
    updateIteration.isPending ||
    addSession.isPending ||
    addStateEvent.isPending ||
    updateMilestoneSession.isPending;

  const handleClose = (): void => {
    if (isSaving) return;
    onOpenChange(false);
  };

  const handleSave = async (): Promise<void> => {
    const values = getValues();

    await updateGame.mutateAsync({
      id: game.id,
      patch: {
        title: values.title.trim() || game.title,
        installDirectory: values.installDirectory.trim() || null,
        installSizeBytes: values.installDirectory.trim() ? values.installSizeBytes : null,
        executablePath: values.executablePath.trim() || null,
        notes: values.notes.trim() || null,
        endless: values.endless,
      },
    });

    if (!values.endless && values.iterationMode === 'new') {
      const iteration = await addIteration.mutateAsync({
        gameId: game.id,
        label: values.label.trim() || null,
        playedPlatform: values.platform,
        origin: values.origin,
        format: values.format,
        manualTotalPlayed: parseOptionalNumber(values.hoursPlayed),
      });

      const isOngoing = values.status === 'playing';

      if (values.started) {
        const date = isoDateToDate(values.started.isoDate);
        await addSession.mutateAsync({
          iterationId: iteration.id,
          startedAt: date,
          endedAt: date,
          durationSec: 0,
          datePrecision: values.started.precision,
          milestone: 'started',
          anchorAs: 'start',
        });
      }

      if (values.finished && !isOngoing) {
        const date = isoDateToDate(values.finished.isoDate);
        await addSession.mutateAsync({
          iterationId: iteration.id,
          startedAt: date,
          endedAt: date,
          durationSec: 0,
          datePrecision: values.finished.precision,
          milestone: STATUS_TO_STATE_TYPE[values.status] as 'completed' | 'dropped' | 'on_hold',
          anchorAs: 'end',
        });
      }

      // SPEC 4.5 — el log de una iteración siempre debe arrancar por
      // "started" antes de un estado terminal, así que si hay fecha de
      // inicio y el estado elegido no es "playing", se ancla ese "started"
      // primero (mismo fix que createGameWithDetails.ts para Add Game).
      if (values.started && STATUS_TO_STATE_TYPE[values.status] !== 'started') {
        await addStateEvent.mutateAsync({
          iterationId: iteration.id,
          type: 'started',
          occurredAt: isoDateToDate(values.started.isoDate),
          datePrecision: values.started.precision,
          note: null,
        });
      }

      const anchorDate = values.finished ?? values.started;
      await addStateEvent.mutateAsync({
        iterationId: iteration.id,
        type: STATUS_TO_STATE_TYPE[values.status],
        occurredAt: anchorDate ? isoDateToDate(anchorDate.isoDate) : new Date(),
        datePrecision: anchorDate?.precision ?? 'day',
        note: null,
      });
    } else if (
      !values.endless &&
      values.iterationMode === 'existing' &&
      values.selectedIterationId
    ) {
      const iterationId = values.selectedIterationId;
      await updateIteration.mutateAsync({
        id: iterationId,
        patch: {
          playedPlatform: values.platform,
          origin: values.origin,
          format: values.format,
          extraContent: values.extraContent,
          manualTotalPlayed: parseOptionalNumber(values.hoursPlayed),
          ...(values.label.trim() ? { label: values.label.trim() } : {}),
        },
      });

      const originalIteration = game.iterations.find((it) => it.id === iterationId);

      // Fechas Started/Finished corregidas — solo si el ancla es un marcador
      // manual (si no, ni siquiera están en el formulario) y el valor cambió
      // de verdad respecto al guardado. Un draft a null (borrado con la X del
      // picker) se ignora: quitar una fecha del todo sería borrar el marcador,
      // no corregirlo — fuera de alcance aquí.
      if (originalIteration) {
        for (const which of ['start', 'end'] as const) {
          const anchor = milestoneAnchor(originalIteration, which);
          const draft = which === 'start' ? values.started : values.finished;
          if (!anchor || !draft) continue;
          const original = anchorPickerValue(anchor);
          if (
            original &&
            original.isoDate === draft.isoDate &&
            original.precision === draft.precision
          ) {
            continue;
          }
          await updateMilestoneSession.mutateAsync({
            id: anchor.id,
            date: isoDateToDate(draft.isoDate),
            precision: draft.precision,
          });
        }
      }

      const previousStatus = originalIteration?.currentState
        ? STATE_TO_STATUS_KEY[originalIteration.currentState]
        : null;

      if (values.status !== previousStatus) {
        await addStateEvent.mutateAsync({
          iterationId,
          type: STATUS_TO_STATE_TYPE[values.status],
          occurredAt: new Date(),
          datePrecision: 'datetime',
          note: null,
        });
      }
    }

    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] w-160 max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[18px] border border-input bg-[#121413] p-0 shadow-[0_30px_80px_rgba(0,0,0,.6)] sm:max-w-[calc(100%-2rem)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5.5 py-4.5">
          <div className="text-[17px] font-extrabold tracking-[-.01em] text-foreground">
            Edit game
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] border border-border bg-white/3 text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5.5 py-5">
          <FormProvider {...methods}>
            <div className="flex flex-col gap-4">
              <div>
                <div className={fieldLabelClass}>TITLE</div>
                <Controller
                  control={control}
                  name="title"
                  render={({ field }) => <input {...field} className={textInputClass} />}
                />
              </div>

              <div className="flex gap-2.5">
                <div className="flex-1">
                  <div className={fieldLabelClass}>
                    DEVELOPER{' '}
                    <span className="font-medium tracking-normal normal-case">· from IGDB</span>
                  </div>
                  <div className="rounded-[9px] border border-input bg-white/[0.015] px-3.25 py-2.5 text-[13px] text-muted-foreground">
                    {game.developer ?? '—'}
                  </div>
                </div>
                <div className="flex-1">
                  <div className={fieldLabelClass}>
                    PUBLISHER{' '}
                    <span className="font-medium tracking-normal normal-case">· from IGDB</span>
                  </div>
                  <div className="rounded-[9px] border border-input bg-white/[0.015] px-3.25 py-2.5 text-[13px] text-muted-foreground">
                    {game.publisher ?? '—'}
                  </div>
                </div>
              </div>

              <InstallDirectoryField />

              <ExecutablePathField />

              <div>
                <div className={fieldLabelClass}>NOTES</div>
                <Controller
                  control={control}
                  name="notes"
                  render={({ field }) => (
                    <Textarea
                      {...field}
                      placeholder="Markdown supported…"
                      className={`${textInputClass} min-h-20 font-mono`}
                    />
                  )}
                />
              </div>

              <CheckboxRow
                checked={endless}
                onToggle={() => setValue('endless', !endless)}
                title="Endless game"
                description={`No ending (Minecraft, Factorio…). Hides "Complete", never counts as backlog.`}
                borderColorChecked="rgba(47,220,126,.7)"
                fillColorChecked="#2fdc7e"
                checkIconColor="#08120c"
              />

              {endless ? (
                <div className="rounded-[10px] border border-border bg-white/[0.02] px-3.5 py-3 text-[12.5px] text-muted-foreground">
                  Tracked by sessions — no playthroughs to edit.
                </div>
              ) : (
                <IterationSection game={game} />
              )}
            </div>
          </FormProvider>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-border px-5.5 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-[10px] px-5.5 py-2.5 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#2fdc7e,#16a35a)', color: '#08120c' }}
          >
            <Save size={16} />
            <span>{isSaving ? 'Saving…' : 'Save changes'}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
