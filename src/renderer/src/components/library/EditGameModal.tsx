import { Save } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import type { GameDetail } from '../../../../shared/types';
import { useResetEndlessState, useUpdateGame } from '../../hooks/games';
import { useAddIteration, useUpdateIteration } from '../../hooks/iterations';
import { useAddStateEvent, useUpdateStateEvent } from '../../hooks/stateEvents';
import {
  ENDLESS_STATUS_OPTIONS,
  STATE_TO_STATUS_KEY,
  STATUS_TO_STATE_TYPE,
} from '../../lib/gameStatus';
import type { PastStatusKey } from '../../lib/gameStatus';
import { activeOrLastIteration } from '../../lib/iterations';
import { ModalFooter, ModalShell } from '../ui/modal-shell';
import { NotesEditor } from './detail/NotesEditor';
import { CheckboxRow } from './add-game/CheckboxRow';
import { ExecutablePathField } from './add-game/ExecutablePathField';
import { InstallDirectoryField } from './add-game/InstallDirectoryField';
import { parseIsoDate } from './add-game/precisionDate';
import { fieldLabelClass, textInputClass } from './add-game/styles';
import { DEFAULT_FORM_VALUES, parseOptionalNumber } from './add-game/types';
import { EndlessSection } from './edit-game/EndlessSection';
import { IterationSection } from './edit-game/IterationSection';
import { edgeEventPickerValue } from './edit-game/types';
import type { EditGameFormValues } from './edit-game/types';

type EditGameModalProps = {
  game: GameDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const buildDefaults = (game: GameDetail): EditGameFormValues => {
  const iteration = activeOrLastIteration(game.iterations);

  return {
    title: game.title,
    installDirectory: game.installDirectory ?? '',
    installSizeBytes: game.installSizeBytes,
    executablePath: game.executablePath ?? '',
    notes: game.notes ?? '',
    endless: game.endless,
    isEmulated: game.isEmulated,
    iterationMode: iteration ? 'existing' : 'none',
    selectedIterationId: iteration?.id ?? null,
    label: iteration?.label ?? '',
    // Editables solo cuando la fecha viene de un EVENTO del log (modelo v2)
    // — misma regla que loadIteration() en IterationSection.tsx; un inicio
    // medido por sesión real queda en solo lectura (null aquí).
    started:
      iteration && !iteration.startedBySession ? edgeEventPickerValue(iteration.startEvent) : null,
    finished: iteration ? edgeEventPickerValue(iteration.endEvent) : null,
    extraContent: iteration?.extraContent ?? false,
    // El fallback depende del tipo de juego: un endless sin estado arranca
    // en 'resting' (su dropdown ni ofrece 'beaten'). El cast es seguro:
    // currentState sale de latestRealStateEvent, que ignora 'plan_to_play'.
    status: iteration?.currentState
      ? (STATE_TO_STATUS_KEY[iteration.currentState] as PastStatusKey)
      : game.endless
        ? 'resting'
        : 'beaten',
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
  const isEmulated = useWatch({ control, name: 'isEmulated' });

  useEffect(() => {
    if (open) reset(buildDefaults(game));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, game]);

  const updateGame = useUpdateGame();
  const addIteration = useAddIteration();
  const updateIteration = useUpdateIteration();
  const resetEndlessState = useResetEndlessState();
  const addStateEvent = useAddStateEvent();
  const updateStateEvent = useUpdateStateEvent();

  const isSaving =
    updateGame.isPending ||
    addIteration.isPending ||
    updateIteration.isPending ||
    resetEndlessState.isPending ||
    addStateEvent.isPending ||
    updateStateEvent.isPending;

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
        // Marcarlo como emulado retira el .exe propio: lo vigilado pasa a
        // ser el emulador, no el juego (EMULADORES.md §5).
        executablePath: values.isEmulated ? null : values.executablePath.trim() || null,
        notes: values.notes.trim() || null,
        endless: values.endless,
        isEmulated: values.isEmulated,
      },
    });

    if (values.endless) {
      // ── Juego endless ──────────────────────────────────────────────────
      // Convertirlo desde normal limpia los desenlaces y marcadores de
      // partida discreta CONSERVANDO las sesiones trackeadas y las horas
      // manuales (ver resetEndlessState) — sin esto el juego seguía saliendo
      // como "Beaten" por un playthrough que conceptualmente ya no existe,
      // pero borrar iteraciones enteras se llevaba lo medido por el watcher.
      const converting = !game.endless;
      if (converting) {
        await resetEndlessState.mutateAsync(game.id);
      }

      // El playthrough CONTENEDOR del endless (el que agrupa sesiones,
      // horas manuales y estado — mismo shape que crea Add Game): se
      // actualiza el existente o se crea uno si no hay ninguno.
      const container = activeOrLastIteration(game.iterations);
      const manualHours = parseOptionalNumber(values.hoursPlayed);

      if (container) {
        await updateIteration.mutateAsync({
          id: container.id,
          patch: { manualTotalPlayed: manualHours },
        });
        // Tras una conversión el historial acaba de limpiarse entero (el
        // currentState del prop es una foto vieja) — el estado elegido se
        // escribe SIEMPRE; sin conversión, solo si cambió de verdad.
        const previousStatus =
          !converting && container.currentState
            ? STATE_TO_STATUS_KEY[container.currentState]
            : null;
        if (converting || values.status !== previousStatus) {
          await addStateEvent.mutateAsync({
            iterationId: container.id,
            type: STATUS_TO_STATE_TYPE[values.status],
            occurredAt: new Date(),
            datePrecision: 'datetime',
            note: null,
          });
        }
      } else {
        const iteration = await addIteration.mutateAsync({
          gameId: game.id,
          label: null,
          playedPlatform: values.platform || DEFAULT_FORM_VALUES.platform,
          origin: values.origin || DEFAULT_FORM_VALUES.origin,
          format: values.format,
          manualTotalPlayed: manualHours,
        });
        await addStateEvent.mutateAsync({
          iterationId: iteration.id,
          type: STATUS_TO_STATE_TYPE[values.status],
          occurredAt: new Date(),
          datePrecision: 'datetime',
          note: null,
        });
      }
    } else if (values.iterationMode === 'new') {
      const iteration = await addIteration.mutateAsync({
        gameId: game.id,
        label: values.label.trim() || null,
        playedPlatform: values.platform,
        origin: values.origin,
        format: values.format,
        manualTotalPlayed: parseOptionalNumber(values.hoursPlayed),
      });

      // Modelo v2: las fechas del playthrough manual SON sus eventos — ya no
      // se crean sesiones marcadoras aparte.
      const isOngoing = values.status === 'playing';

      // SPEC 4.5 — el log de una iteración siempre debe arrancar por
      // "started" antes de un estado terminal, así que si hay fecha de
      // inicio y el estado elegido no es "playing", ese 'started' va
      // primero (mismo guion que writeInitialPlaythrough para Add Game).
      if (values.started && STATUS_TO_STATE_TYPE[values.status] !== 'started') {
        await addStateEvent.mutateAsync({
          iterationId: iteration.id,
          type: 'started',
          occurredAt: parseIsoDate(values.started.isoDate),
          datePrecision: values.started.precision,
          note: null,
        });
      }

      const anchorDate = (!isOngoing ? values.finished : null) ?? values.started;
      await addStateEvent.mutateAsync({
        iterationId: iteration.id,
        type: STATUS_TO_STATE_TYPE[values.status],
        occurredAt: anchorDate ? parseIsoDate(anchorDate.isoDate) : new Date(),
        datePrecision: anchorDate?.precision ?? 'day',
        note: null,
      });
    } else if (values.iterationMode === 'existing' && values.selectedIterationId) {
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

      // Fechas Started/Finished corregidas — modelo v2: la fecha ES el
      // evento, así que corregirla es parchear ese evento. Solo si la fecha
      // era editable (había evento dueño y no venía de una sesión medida —
      // si no, ni siquiera está en el formulario) y el valor cambió de
      // verdad. Un draft a null (borrado con la X del picker) se ignora:
      // quitar una fecha del todo sería borrar el evento, no corregirlo —
      // fuera de alcance aquí (para eso está el History).
      if (originalIteration) {
        const edges = [
          {
            event: originalIteration.startedBySession ? null : originalIteration.startEvent,
            draft: values.started,
          },
          { event: originalIteration.endEvent, draft: values.finished },
        ];
        for (const { event, draft } of edges) {
          if (!event || !draft) continue;
          const original = edgeEventPickerValue(event);
          if (
            original &&
            original.isoDate === draft.isoDate &&
            original.precision === draft.precision
          ) {
            continue;
          }
          await updateStateEvent.mutateAsync({
            id: event.id,
            patch: {
              occurredAt: parseIsoDate(draft.isoDate),
              datePrecision: draft.precision,
            },
          });
        }
      }

      const previousStatus = originalIteration?.currentState
        ? STATE_TO_STATUS_KEY[originalIteration.currentState]
        : null;

      if (values.status !== previousStatus) {
        const newType = STATUS_TO_STATE_TYPE[values.status];
        // Playthrough con desenlace registrado (endEvent), cambiado a otro
        // desenlace terminal (Beaten → Dropped…): se corrige el TIPO de ese
        // mismo evento conservando su fecha, en vez de añadir uno nuevo
        // fechado hoy — que dejaba el Beaten viejo en el historial y un
        // Dropped "de hoy" sin sentido para una partida del pasado.
        const isTerminal =
          newType === 'completed' || newType === 'dropped' || newType === 'on_hold';
        if (originalIteration?.endEvent && isTerminal) {
          await updateStateEvent.mutateAsync({
            id: originalIteration.endEvent.id,
            patch: { type: newType },
          });
        } else {
          await addStateEvent.mutateAsync({
            iterationId,
            type: newType,
            occurredAt: new Date(),
            datePrecision: 'datetime',
            note: null,
          });
        }
      }
    }

    onOpenChange(false);
  };

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title="Edit game"
      widthClass="w-160"
      maxHClass="max-h-[80vh]"
      footer={
        <ModalFooter
          onCancel={handleClose}
          onSubmit={handleSave}
          submitting={isSaving}
          submitLabel="Save changes"
          submittingLabel="Saving…"
          icon={<Save size={16} />}
        />
      }
    >
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

          <InstallDirectoryField showOptionalHint={false} />

          {/* Un juego emulado no tiene .exe propio (EMULADORES.md §5) —
                  mismo ocultamiento que en Add Game. */}
          {!isEmulated && <ExecutablePathField />}

          <div>
            <div className={`${fieldLabelClass} mb-1.5`}>NOTES</div>
            <Controller
              control={control}
              name="notes"
              render={({ field }) => (
                // key + value desde game.notes (no field.value): el modal
                // reusa el formulario entre juegos y resetea en un efecto, así
                // que remontar por juego con la nota real evita quedarse con
                // la del juego anterior. onChange sigue escribiendo al form.
                <NotesEditor
                  key={game.id}
                  value={game.notes ?? ''}
                  onChange={field.onChange}
                  minHeightClass="min-h-36"
                />
              )}
            />
          </div>

          <CheckboxRow
            checked={endless}
            onToggle={() => {
              const next = !endless;
              setValue('endless', next);
              // Al activarlo, el estado del formulario puede quedar apuntando
              // a una opción que el dropdown endless ni ofrece ("Beaten") —
              // mismo ajuste que hace AddGameModal con su handleEndlessToggle.
              if (next && !ENDLESS_STATUS_OPTIONS.includes(getValues('status'))) {
                setValue('status', 'resting');
              }
            }}
            title="Endless game"
            description={`No ending (Minecraft, Factorio…). Hides "Complete", never counts as backlog.`}
            accent="green"
          />

          <CheckboxRow
            checked={isEmulated}
            onToggle={() => setValue('isEmulated', !isEmulated)}
            title="Emulated game"
            description="Runs inside an emulator — sessions are detected from the emulator and assigned manually."
            accent="green"
          />

          {endless ? (
            <>
              {/* Convertir un juego normal a endless limpia su historial de
                  estados y desenlaces al guardar (sesiones y horas se
                  conservan) — avisar ANTES, no después. Mismo azul
                  informativo que el aviso de playthrough manual. */}
              {!game.endless && game.iterations.length > 0 && (
                <div
                  className="rounded-[9px] px-3 py-2 text-[12px] font-semibold"
                  style={{ background: 'rgba(133,163,214,.1)', color: '#85a3d6' }}
                >
                  Saving clears its status history and playthrough outcomes — tracked sessions and
                  hours are kept; an endless game just has no discrete runs.
                </div>
              )}
              <EndlessSection />
            </>
          ) : (
            <IterationSection game={game} />
          )}
        </div>
      </FormProvider>
    </ModalShell>
  );
};
