import {
  Cpu,
  Gamepad2,
  Infinity as InfinityIcon,
  Info,
  NotebookPen,
  Rocket,
  Save,
  SquarePen,
  ToggleLeft,
} from 'lucide-react';
import { useEffect } from 'react';
import { Controller, FormProvider, useForm, useWatch } from 'react-hook-form';
import type { GameDetail } from '../../../../shared/types';
import { useResetEndlessState, useUpdateGame } from '../../hooks/games';
import { useCreateIteration, useUpdateIteration } from '../../hooks/iterations';
import { useAddStateEvent, useUpdateStateEvent } from '../../hooks/stateEvents';
import { ENDLESS_STATUS_OPTIONS, STATE_TO_STATUS_KEY } from '../../lib/gameStatus';
import type { PastStatusKey } from '../../lib/gameStatus';
import { activeOrLastIteration } from '../../lib/iterations';
import { getGameStatusMeta } from '../../lib/gameStatus';
import { BLUE, GRAY, GREEN, TEAL, VIOLET } from '../../lib/colors';
import { expandClass, revealClass, revealStyle } from '../../lib/styles';
import { ModalFooter, ModalShell } from '../ui/modal-shell';
import { StatusIcon } from '../StatusIcon';
import { Cell } from './detail/DetailsCard';
import { NotesEditor } from './detail/NotesEditor';
import { CheckboxRow } from './add-game/CheckboxRow';
import { CoverThumb } from './add-game/CoverThumb';
import { ExecutablePathField } from './add-game/ExecutablePathField';
import { FormSection } from './add-game/FormSection';
import { InstallDirectoryField } from './add-game/InstallDirectoryField';
import { fieldLabelClass, textInputClass, textInputFocusClass } from './add-game/styles';
import { EndlessSection } from './edit-game/EndlessSection';
import {
  saveBaseGamePatch,
  saveEndlessIteration,
  saveExistingIteration,
  saveNewIteration,
} from './edit-game/handleSave';
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
  const addIteration = useCreateIteration();
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

    await saveBaseGamePatch(game, values, updateGame);

    if (values.endless) {
      await saveEndlessIteration(game, values, {
        resetEndlessState,
        updateIteration,
        addIteration,
        addStateEvent,
      });
    } else if (values.iterationMode === 'new') {
      await saveNewIteration(game, values, { addIteration, addStateEvent });
    } else if (values.iterationMode === 'existing' && values.selectedIterationId) {
      await saveExistingIteration(game, values, values.selectedIterationId, {
        updateIteration,
        updateStateEvent,
        addStateEvent,
      });
    }

    onOpenChange(false);
  };

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title="Edit game"
      icon={SquarePen}
      color={GREEN}
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
        <div className="flex flex-col gap-5">
          {/* Qué juego se está editando — hero de fondo tras un velo, misma
              receta que la ficha del juego elegido en Add Game. Los datos
              vienen del prop (no del formulario): esto es un letrero, no un
              campo. */}
          <GameBanner game={game} />

          <FormSection
            icon={Gamepad2}
            title="Game info"
            color={GREEN}
            className={revealClass}
            style={revealStyle(1)}
          >
            <div>
              <div className={fieldLabelClass}>TITLE</div>
              <Controller
                control={control}
                name="title"
                render={({ field }) => (
                  <input {...field} className={`${textInputClass} ${textInputFocusClass}`} />
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 rounded-[10px] border border-border bg-white/[0.015] px-3.25 py-3">
              <Cell label="DEVELOPER" value={game.developer ?? '—'} />
              <Cell label="PUBLISHER" value={game.publisher ?? '—'} />
            </div>
          </FormSection>

          <FormSection
            icon={ToggleLeft}
            title="Game type"
            color={VIOLET}
            className={revealClass}
            style={revealStyle(2)}
          >
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
              icon={InfinityIcon}
            />

            <CheckboxRow
              checked={isEmulated}
              onToggle={() => setValue('isEmulated', !isEmulated)}
              title="Emulated game"
              description="Runs inside an emulator — sessions are detected from the emulator and assigned manually."
              accent="green"
              icon={Cpu}
            />
          </FormSection>

          <div className={revealClass} style={revealStyle(3)}>
            {endless ? (
              <div className={`flex flex-col gap-3.5 ${expandClass}`}>
                {/* Convertir un juego normal a endless limpia su historial de
                    estados y desenlaces al guardar (sesiones y horas se
                    conservan) — avisar ANTES, no después. Mismo azul
                    informativo (y mismo Info) que el aviso de playthrough
                    manual de IterationSection. */}
                {!game.endless && game.iterations.length > 0 && (
                  <div
                    className="flex items-center gap-1.75 rounded-[9px] px-3 py-2 text-[12px] font-semibold"
                    style={{ background: 'rgba(133,163,214,.1)', color: BLUE }}
                  >
                    <Info size={13} className="flex-none" />
                    Saving clears its status history and playthrough outcomes — tracked sessions and
                    hours are kept; an endless game just has no discrete runs.
                  </div>
                )}
                <EndlessSection />
              </div>
            ) : (
              <div className={expandClass}>
                <IterationSection game={game} />
              </div>
            )}
          </div>

          <FormSection
            icon={Rocket}
            title="Launch & install"
            color={TEAL}
            className={revealClass}
            style={revealStyle(4)}
          >
            <InstallDirectoryField showOptionalHint={false} />

            {/* Un juego emulado no tiene .exe propio (EMULADORES.md §5) —
                    mismo ocultamiento que en Add Game. */}
            {!isEmulated && <ExecutablePathField />}
          </FormSection>

          <FormSection
            icon={NotebookPen}
            title="Notes"
            color={GRAY}
            className={revealClass}
            style={revealStyle(5)}
          >
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
          </FormSection>
        </div>
      </FormProvider>
    </ModalShell>
  );
};

// Letrero de cabecera del modal: hero del juego de fondo (velo de izquierda
// a derecha, como la ficha de Add Game), carátula, título y su estado
// actual. Solo lectura a propósito — el título editable vive en "Game info",
// esto responde de un vistazo a "¿qué juego estoy tocando?".
const GameBanner = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const status = getGameStatusMeta(game.currentState);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-input bg-white/[0.03] ${revealClass}`}
      style={revealStyle(0)}
    >
      {game.heroUrl && (
        <>
          <CoverThumb
            url={game.heroUrl}
            type="heroes"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(18,20,19,.97) 0%, rgba(18,20,19,.92) 40%, rgba(18,20,19,.55) 100%)',
            }}
          />
        </>
      )}

      <div className="relative flex items-center gap-3.5 p-3.5">
        <div className="h-19 w-14 flex-none overflow-hidden rounded-lg border border-white/15 bg-muted shadow-[0_8px_20px_rgba(0,0,0,.45)]">
          <CoverThumb url={game.coverUrl} alt="" className="h-full w-full object-cover" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[15.5px] font-extrabold text-foreground">
              {game.title}
            </span>
            {game.releaseYear !== null && (
              <span className="flex-none text-[12px] font-semibold text-muted-foreground tabular-nums">
                {game.releaseYear}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <StatusIcon meta={status} size={13} />
            <span className="text-[12px] font-bold" style={{ color: status.color }}>
              {status.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
