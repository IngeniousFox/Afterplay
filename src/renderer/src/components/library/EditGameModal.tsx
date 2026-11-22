import {
  Cpu,
  Gamepad2,
  Monitor,
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
import {
  useAddStateEvent,
  useDeleteStateEvent,
  useUpdateStateEvent,
} from '../../hooks/stateEvents';
import { ENDLESS_STATUS_OPTIONS, NORMAL_STATUS_OPTIONS } from '../../lib/gameStatus';
import { activeOrLastIteration } from '../../lib/iterations';
import { BLUE, GRAY, GREEN, TEAL, VIOLET } from '../../lib/colors';
import {
  expandClass,
  primaryButtonClass,
  revealClass,
  revealStyle,
  secondaryButtonClass,
} from '../../lib/styles';
import { cn } from '../../lib/utils';
import { PressButton } from '../fx/PressButton';
import { pressClass } from '../fx/press';
import { ModalShell } from '../ui/modal-shell';
import { Cell } from './detail/DetailsCard';
import { NotesEditor } from './detail/NotesEditor';
import { CheckboxRow } from './add-game/CheckboxRow';
import { ExecutablePathField } from './add-game/ExecutablePathField';
import { FormSection } from './add-game/FormSection';
import { InstallDirectoryField } from './add-game/InstallDirectoryField';
import { ScanAutofillRow } from './add-game/ScanAutofillRow';
import { fieldLabelClass, textInputClass, textInputFocusClass } from './add-game/styles';
import { EndlessSection } from './edit-game/EndlessSection';
import {
  saveBaseGamePatch,
  saveEndlessIteration,
  saveExistingIteration,
  saveNewPlaythroughs,
} from './edit-game/handleSave';
import { IterationSection } from './edit-game/IterationSection';
import { iterationFormValues } from './edit-game/types';
import type { EditGameFormValues } from './edit-game/types';

type EditGameModalProps = {
  game: GameDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const buildDefaults = (game: GameDetail): EditGameFormValues => {
  const iteration = activeOrLastIteration(game.iterations) ?? null;

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
    // Los pendientes son de ESTA edición: cada apertura del modal arranca sin
    // ninguno, se hayan guardado los de la vez anterior o no.
    newPlaythroughs: [],
    // Los campos que salen del playthrough, con la MISMA regla que aplica
    // IterationSection.loadIteration al cambiar de playthrough dentro del
    // modal — escrita a mano en los dos sitios ya había derivado (ver
    // iterationFormValues).
    ...iterationFormValues(iteration, game.endless),
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
  // Para el aviso de conversión a endless: los playthroughs manuales que se
  // hayan preparado en ESTA edición no se crean (un endless no tiene runs
  // discretos, el bucle de guardado los salta), y al marcar el checkbox
  // desaparecen de la vista con IterationSection — sin decirlo, "Save
  // changes" cerraba el modal como si se hubieran guardado.
  const newPlaythroughs = useWatch({ control, name: 'newPlaythroughs' });

  // Se resetea al ABRIR y al cambiar de juego, nunca en cada refetch. Antes
  // el efecto dependía de la IDENTIDAD del objeto `game`: cualquier
  // invalidación de ['games'] con el modal abierto (el propio "Remove
  // playthrough", o el watcher al detectar un arranque de juego) devolvía un
  // objeto nuevo y reescribía el formulario entero — título tecleado y
  // playthroughs pendientes se perdían sin aviso (bug real). Mismo criterio
  // que useResetOnOpen (ChangeCoverModal/EditNotesModal), pero en efecto y no
  // durante el render: `reset` de react-hook-form avisa a los useWatch de los
  // hijos, y llamarlo en render sería un setState sobre otro componente a
  // media pasada.
  //
  // LA CONTRAPARTIDA, que es real y no está tapada: el formulario ya no se
  // resincroniza con el servidor, así que un modal abierto mucho rato guarda
  // contra una foto vieja. El caso concreto: saveExistingIteration compara
  // `values.status` contra el `game` REFRESCADO, de modo que si el watcher
  // detecta un arranque mientras el modal está abierto, previousStatus pasa a
  // 'playing' y `values.status` se queda como estaba — y el guardado lo lee
  // como "el usuario está corrigiendo el estado" y escribe en el log con el
  // valor viejo. Se prefiere a perder lo tecleado, que era el bug de verdad.
  // El apaño fino (reset(..., { keepDirtyValues: true })) hoy NO es seguro:
  // media docena de campos se escriben con setValue() sin shouldDirty (el
  // dropdown de estado, plataforma/formato/origen, las fechas…), así que
  // react-hook-form los ve limpios y volvería a machacar justo lo elegido a
  // mano — el mismo bug con otra cara. Pediría marcar esos setValue primero.
  useEffect(() => {
    if (open) reset(buildDefaults(game));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, game.id]);

  const updateGame = useUpdateGame();
  const addIteration = useCreateIteration();
  const updateIteration = useUpdateIteration();
  const resetEndlessState = useResetEndlessState();
  const addStateEvent = useAddStateEvent();
  const updateStateEvent = useUpdateStateEvent();
  const deleteStateEvent = useDeleteStateEvent();

  const isSaving =
    updateGame.isPending ||
    addIteration.isPending ||
    updateIteration.isPending ||
    resetEndlessState.isPending ||
    addStateEvent.isPending ||
    updateStateEvent.isPending ||
    deleteStateEvent.isPending;

  // El error de la primera mutación que haya fallado, para el banner. Cada
  // mutation limpia su error al reintentar, así que esto refleja el último
  // intento, no un fallo viejo.
  const saveError =
    updateGame.error ??
    addIteration.error ??
    updateIteration.error ??
    resetEndlessState.error ??
    addStateEvent.error ??
    updateStateEvent.error ??
    deleteStateEvent.error ??
    null;

  const handleClose = (): void => {
    if (isSaving) return;
    onOpenChange(false);
  };

  const handleSave = async (): Promise<void> => {
    const values = getValues();
    // Cuántos de los pendientes han entrado YA en la base — lo lee el catch.
    let created = 0;

    // Cadena de mutaciones independientes: si una de en medio falla (p. ej.
    // una conversión a endless donde resetEndlessState ya confirmó y luego
    // addStateEvent revienta), antes el modal se cerraba igual, SIN mensaje,
    // dejando el juego a medio convertir. Ahora solo se cierra si TODO fue
    // bien; si algo falla, se queda abierto con el banner de error (sale del
    // saveError de abajo) para que se pueda reintentar. El try/catch también
    // evita la promesa rechazada sin dueño del onClick del footer.
    try {
      await saveBaseGamePatch(game, values, updateGame);

      if (values.endless) {
        await saveEndlessIteration(game, values, {
          resetEndlessState,
          updateIteration,
          addIteration,
          addStateEvent,
        });
      } else if (values.iterationMode === 'existing' && values.selectedIterationId) {
        await saveExistingIteration(game, values, values.selectedIterationId, {
          updateIteration,
          updateStateEvent,
          addStateEvent,
          deleteStateEvent,
        });
      }

      // Los pendientes se crean SIEMPRE (salvo endless, que no tiene
      // playthroughs discretos) y después de tocar el existente: el orden
      // importa porque cada 'started' nuevo puede auto-pausar al anterior.
      // De uno en uno y llevando la cuenta porque la tanda NO es atómica: si
      // el tercero de cinco revienta, los dos primeros ya están en la base.
      // Eso antes lo tapaba de rebote el reset por identidad de `game` (la
      // invalidación de ['games'] vaciaba el formulario entero); al quitarlo
      // para no perder lo tecleado, un segundo Save volvía a crear los que ya
      // existían -> playthroughs duplicados.
      if (!values.endless) {
        for (const pending of values.newPlaythroughs) {
          await saveNewPlaythroughs(
            game,
            { ...values, newPlaythroughs: [pending] },
            { addIteration, addStateEvent },
          );
          created += 1;
        }
      }

      onOpenChange(false);
    } catch (error) {
      // Los que sí entraron salen del formulario: el modal se queda abierto
      // con el banner, y reintentar tiene que crear solo lo que falta.
      if (created > 0) setValue('newPlaythroughs', values.newPlaythroughs.slice(created));
      console.error('[edit-game] fallo guardando cambios:', error);
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={handleClose}
      title="Edit game"
      icon={SquarePen}
      color={GREEN}
      widthClass="w-[1180px]"
      maxHClass="max-h-[88vh]"
      headerExtra={<div className="mt-0.5 text-small text-dust">{game.title}</div>}
      // El pie de ModalFooter, con la física de PressButton: los dos botones
      // se hunden al pulsar y rebotan al soltar.
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            className={cn(secondaryButtonClass, pressClass)}
          >
            Cancel
          </button>
          <PressButton
            burst="phosphor"
            onClick={handleSave}
            disabled={isSaving}
            aria-busy={isSaving || undefined}
            className={primaryButtonClass}
          >
            <Save size={16} />
            <span>{isSaving ? 'Saving…' : 'Save changes'}</span>
          </PressButton>
        </>
      }
    >
      <FormProvider {...methods}>
        {/* Dos columnas (ficha-editar.png): a la izquierda lo que es del juego
            y de su playthrough; a la derecha lo que es de ESTE PC (rutas),
            el tipo de juego y las notas. En ventanas estrechas, una. */}
        <div className="grid items-start gap-x-10 gap-y-7 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-7">
            <FormSection
              icon={Gamepad2}
              title="Game info"
              color={GREEN}
              className={revealClass}
              style={revealStyle(1)}
            >
              <div>
                <div className={fieldLabelClass}>Title</div>
                <Controller
                  control={control}
                  name="title"
                  render={({ field }) => (
                    <input
                      {...field}
                      aria-label="Title"
                      className={`${textInputClass} ${textInputFocusClass}`}
                    />
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 rounded-sm border border-border bg-bone/[0.015] px-3.25 py-3">
                <Cell label="Developer" value={game.developer ?? '—'} />
                <Cell label="Publisher" value={game.publisher ?? '—'} />
              </div>
            </FormSection>

            <div className={revealClass} style={revealStyle(3)}>
              {endless ? (
                <div className={`flex flex-col gap-3.5 ${expandClass}`}>
                  {/* Convertir un juego normal a endless limpia su historial de
                    estados y desenlaces al guardar (sesiones y horas se
                    conservan) — avisar ANTES, no después. Mismo azul
                    informativo (y mismo Info) que el aviso de playthrough
                    manual de IterationSection. */}
                  {!game.endless && (game.iterations.length > 0 || newPlaythroughs.length > 0) && (
                    <div
                      className="flex items-center gap-1.75 rounded-sm px-3 py-2 text-[12px] font-semibold"
                      style={{ background: 'rgba(95,211,224,.1)', color: BLUE }}
                    >
                      <Info size={13} className="flex-none" />
                      Saving clears its status history and playthrough outcomes — tracked sessions
                      and hours are kept; an endless game just has no discrete runs.
                      {/* Los pendientes preparados aquí tampoco sobreviven, y al
                        marcar el checkbox ya no están a la vista para darse
                        cuenta — se dice antes de guardar, no después. */}
                      {newPlaythroughs.length > 0 &&
                        ' The manual playthroughs you prepared will be discarded.'}
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
          </div>

          <div className="flex min-w-0 flex-col gap-7">
            <FormSection
              icon={Rocket}
              title="Launch and install"
              color={TEAL}
              extra={
                <span className="flex items-center gap-1.5 rounded-xs border border-tube/50 px-1.5 py-px text-micro font-medium text-tube">
                  <Monitor size={12} />
                  On this PC
                </span>
              }
              className={revealClass}
              style={revealStyle(4)}
            >
              {/* El mismo atajo que en Add Game: si el juego está en una
                carpeta vigilada, el escaneo ya sabe su ruta, tamaño y .exe —
                un clic rellena los campos de abajo. Aquí es incluso más
                típico: un juego dado de alta a mano sin rutas que se instala
                DESPUÉS se completa desde Edit, y sin este botón tocaba
                buscar carpeta y ejecutable a mano otra vez. */}
              <ScanAutofillRow
                title={game.title}
                igdbId={game.igdbId}
                fillExecutable={!isEmulated}
              />

              <InstallDirectoryField showOptionalHint={false} />

              {/* Un juego emulado no tiene .exe propio (EMULADORES.md §5) —
                    mismo ocultamiento que en Add Game. */}
              {!isEmulated && <ExecutablePathField />}
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
                  // El estado del formulario puede quedar apuntando a una opción
                  // que el dropdown del OTRO tipo de juego ni ofrece, y eso pasa
                  // en los DOS sentidos — mismo ajuste (y misma forma) que hace
                  // AddGameModal con su handleEndlessToggle. Corregir solo al
                  // ACTIVARLO dejaba el caso contrario roto: desmarcar "Endless"
                  // en un juego Resting (el estado por defecto de todo endless)
                  // dejaba status='resting' sobre NORMAL_STATUS_OPTIONS, que no
                  // lo incluye — el botón pintaba "Resting" con una fila que no
                  // existía en el panel, y al guardar no se escribía ningún
                  // evento (previousStatus también era 'resting'), así que el
                  // juego se quedaba NO endless y en un estado al que su propia
                  // ficha ya no podía volver.
                  const nextOptions = next ? ENDLESS_STATUS_OPTIONS : NORMAL_STATUS_OPTIONS;
                  if (!nextOptions.includes(getValues('status'))) {
                    // Al MISMO default que iterationFormValues, no a options[0]:
                    // un endless nuevo arranca en 'resting' (asi lo pinta
                    // EndlessSection desde siempre) y un juego normal en
                    // 'beaten'. Con options[0] a secas, marcar Endless sobre un
                    // Beaten aterrizaba en 'playing' — un cambio visual que
                    // nadie pidio y un estado que el usuario no eligio.
                    setValue('status', next ? 'resting' : 'beaten');
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

            {/* Un fallo a mitad de guardado ya no cierra el modal en silencio:
              mismo banner que Add Game, con el detalle del error. */}
            {saveError && !isSaving && (
              <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3.25 py-2.5 text-[12.5px] text-destructive">
                Couldn&apos;t save your changes — {saveError.message}
              </div>
            )}
          </div>
        </div>
      </FormProvider>
    </ModalShell>
  );
};
