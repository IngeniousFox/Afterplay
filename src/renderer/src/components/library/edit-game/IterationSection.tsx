import { Package, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import type { GameDetail, IterationDetail } from '../../../../../shared/types';
import { useDeleteIteration } from '../../../hooks/iterations';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, pluralize } from '../../../lib/format';
import { END_EVENT_STATUS_KEYS, NORMAL_STATUS_OPTIONS, STATUS_META } from '../../../lib/gameStatus';
import { StatusIcon } from '../../StatusIcon';
import { CheckboxRow } from '../add-game/CheckboxRow';
import { DateWithPrecisionPicker } from '../add-game/DateWithPrecisionPicker';
import { Dropdown } from '../add-game/Dropdown';
import { HoursPlayedField } from '../add-game/HoursPlayedField';
import { parseIsoDate } from '../add-game/precisionDate';
import { ManualPlaythroughsList } from '../add-game/ManualPlaythroughsField';
import { PlaythroughLabel } from '../add-game/PlaythroughLabel';
import { PlaythroughPlatformFormatOrigin } from '../add-game/PlaythroughPlatformFormatOrigin';
import { fieldLabelClass, textInputClass, textInputFocusClass } from '../add-game/styles';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../../ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { iterationFormValues } from './types';
import type { EditGameFormValues } from './types';

type IterationSectionProps = {
  game: GameDetail;
};

// SPEC 4.5 — dos modos del mismo formulario: 'existing' (edita un
// playthrough que ya está) y 'new' (registra uno del pasado a mano).
//
// Modelo v2: las fechas de borde de un playthrough SON eventos de su log, no
// sesiones marcadoras, y por eso aquí sí se editan — el guardado parchea el
// evento dueño de cada fecha. La única que se queda en solo lectura es la
// que sale de una sesión MEDIDA (startedBySession): una medición no se
// falsea. Corregirla de verdad pediría editar sesiones sueltas, que no
// existe.
export const IterationSection = ({ game }: IterationSectionProps): React.JSX.Element => {
  const { control, setValue, getValues } = useFormContext<EditGameFormValues>();
  const iterationMode = useWatch({ control, name: 'iterationMode' });
  const selectedIterationId = useWatch({ control, name: 'selectedIterationId' });
  const status = useWatch({ control, name: 'status' });
  const platform = useWatch({ control, name: 'platform' });
  const format = useWatch({ control, name: 'format' });
  const origin = useWatch({ control, name: 'origin' });
  const newPlaythroughs = useWatch({ control, name: 'newPlaythroughs' });
  const deleteIteration = useDeleteIteration();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const loadIteration = (iteration: IterationDetail): void => {
    setValue('iterationMode', 'existing');
    setValue('selectedIterationId', iteration.id);
    // Las reglas de cómo se lee un playthrough en este formulario (fechas de
    // borde, fallback de estado, horas manuales…) viven UNA vez, compartidas
    // con el buildDefaults de EditGameModal: escritas a mano en los dos
    // sitios ya habían derivado — ver iterationFormValues.
    // El endless del FORMULARIO, no game.endless: el dropdown de estados que
    // el usuario tiene delante sigue al checkbox — con el checkbox desmarcado
    // sobre un juego que en la DB sigue siendo endless, caer al default de
    // endless ('resting') pintaria un estado que ese dropdown ni ofrece.
    const next = iterationFormValues(iteration, getValues('endless'));
    setValue('label', next.label);
    setValue('extraContent', next.extraContent);
    setValue('status', next.status);
    setValue('platform', next.platform);
    setValue('format', next.format);
    setValue('origin', next.origin);
    setValue('hoursPlayed', next.hoursPlayed);
    setValue('started', next.started);
    setValue('finished', next.finished);
  };

  const selectedIteration = game.iterations.find((it) => it.id === selectedIterationId) ?? null;
  const labelsById = new Map(game.iterations.map((it) => [String(it.id), it.label]));

  // Borrar un playthrough arrastra en cascada TODAS sus sesiones y su log de
  // estados (ON DELETE CASCADE), así que pasa por confirmación como todo lo
  // que destruye tiempo medido (SPEC 11.8 nivel 2, mismo lenguaje que
  // DeleteSessionDialog): antes borraba a un clic directo, sin diálogo y sin
  // vuelta atrás ni pulsando Cancel. Y va con mutateAsync porque el estado
  // local NO puede adelantarse a una escritura que puede fallar — con
  // .mutate() la UI saltaba al playthrough anterior y el error no aparecía
  // por ningún sitio.
  const handleRemove = async (): Promise<void> => {
    if (!selectedIterationId) return;
    const remaining = game.iterations.filter((it) => it.id !== selectedIterationId);
    try {
      await deleteIteration.mutateAsync(selectedIterationId);
    } catch (error) {
      // El banner del diálogo lo cuenta (deleteIteration.error); aquí solo se
      // evita la promesa rechazada sin dueño del onClick.
      console.error('[edit-game] fallo borrando el playthrough:', error);
      return;
    }
    if (remaining.length > 0) loadIteration(remaining[remaining.length - 1]);
    else setValue('iterationMode', 'none');
    setConfirmingRemove(false);
  };

  // Los pendientes se numeran continuando la cuenta real del juego: si ya
  // tiene 2 guardados, el primero que prepares es el 3.
  const pendingList = (
    <Controller
      control={control}
      name="newPlaythroughs"
      render={({ field }) => (
        <ManualPlaythroughsList
          entries={field.value}
          onChange={field.onChange}
          firstNumber={game.iterations.length + 1}
          addLabel="Add manual playthrough"
        />
      )}
    />
  );

  // El juego no tiene ningún playthrough guardado: no hay nada que editar,
  // solo la lista de los que se estén preparando.
  if (iterationMode === 'none') {
    return (
      <div className="flex flex-col gap-3.5">
        {newPlaythroughs.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border py-9 text-center">
            <p className="text-[13px] font-semibold text-foreground">No playthroughs yet.</p>
            <p className="max-w-72 text-[12px] text-muted-foreground">
              Add a manual playthrough to log a run you already did outside the app.
            </p>
          </div>
        )}
        {pendingList}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-3.5 rounded-[11px] border border-border bg-white/[0.02] p-3.5">
        {/* Misma chapa numerada que los pendientes de abajo: el guardado que
            se está editando también dice cuál es de la lista. El número es su
            posición real (game.iterations viene ordenado por id ascendente),
            así que casa con el desplegable y con la numeración que continúan
            los pendientes. */}
        <PlaythroughLabel
          number={Math.max(1, game.iterations.findIndex((it) => it.id === selectedIterationId) + 1)}
        />

        {game.iterations.length > 1 && (
          <Dropdown
            value={String(selectedIterationId)}
            options={game.iterations.map((it) => String(it.id))}
            onChange={(id) => {
              const iteration = game.iterations.find((it) => String(it.id) === id);
              if (iteration) loadIteration(iteration);
            }}
            renderOption={(id) => labelsById.get(id)}
          />
        )}

        <div>
          <div className={fieldLabelClass}>LABEL</div>
          <FormInput name="label" placeholder="Playthrough 1" />
        </div>

        {selectedIteration ? (
          // Editable SOLO si la fecha viene de un evento del log (tecleada a
          // mano — corregible, el guardado parchea ese evento); si viene de
          // una sesión real trackeada, es una medición y se queda en solo
          // lectura, como siempre.
          <div className="flex gap-2.5">
            {!selectedIteration.startedBySession && selectedIteration.startEvent ? (
              <FormDatePicker name="started" label="Started" />
            ) : (
              <ReadonlyDateField label="Started" iteration={selectedIteration} field="startedAt" />
            )}
            {/* También editable SIN endEvent cuando el estado elegido deja
                fecha de salida (Playing → Beaten/Dropped/Hold): esa fecha
                fechará el evento nuevo al guardar (ver saveExistingIteration)
                en vez de caer siempre en "hoy". */}
            {selectedIteration.endEvent || END_EVENT_STATUS_KEYS.includes(status) ? (
              <FormDatePicker name="finished" label="Finished / left" />
            ) : (
              <ReadonlyDateField
                label="Finished / left"
                iteration={selectedIteration}
                field="endedAt"
              />
            )}
          </div>
        ) : (
          <div className="flex gap-2.5">
            <FormDatePicker name="started" label="Started" />
            <FormDatePicker name="finished" label="Finished / left" />
          </div>
        )}

        <FormCheckboxExtraContent />

        <div className="flex items-end gap-2.5">
          <div className="flex-1">
            <div className={fieldLabelClass}>STATUS</div>
            <FormStatusDropdown />
          </div>
          <FormHoursPlayed />
        </div>

        <PlaythroughPlatformFormatOrigin
          platform={platform}
          onPlatformChange={(value) => setValue('platform', value)}
          format={format}
          onFormatChange={(value) => setValue('format', value)}
          origin={origin}
          onOriginChange={(value) => setValue('origin', value)}
        />

        {selectedIterationId && (
          <>
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              disabled={deleteIteration.isPending}
              className="flex w-fit items-center gap-1.5 rounded-[9px] px-3 py-1.75 text-[12.5px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              <Trash2 size={13} />
              Remove playthrough
            </button>
            <RemovePlaythroughDialog
              open={confirmingRemove}
              iteration={selectedIteration}
              onClose={() => {
                if (deleteIteration.isPending) return;
                // El diálogo no se desmonta al cerrarlo, así que sin esto el
                // banner de un borrado fallido reaparecería sobre el
                // siguiente playthrough — mismo motivo que DeleteSessionDialog.
                deleteIteration.reset();
                setConfirmingRemove(false);
              }}
              onConfirm={handleRemove}
              pending={deleteIteration.isPending}
              error={deleteIteration.error}
            />
          </>
        )}
      </div>

      {pendingList}
    </div>
  );
};

// Confirmación de "Remove playthrough". Mismo lenguaje visual que
// DeleteSessionDialog/DeleteHistoryEntryDialog (nivel 2 de SPEC 11.8) pero
// vive aquí y no en un fichero compartido porque es el único sitio que lo
// usa. Dice DOS cosas que el usuario no puede adivinar: cuántas sesiones se
// van por delante, y que esto NO espera al "Save changes" del modal — es la
// única escritura del formulario que ocurre al instante, así que cerrar con
// Cancel después no la deshace.
const RemovePlaythroughDialog = ({
  open,
  iteration,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  iteration: IterationDetail | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: Error | null;
}): React.JSX.Element => (
  <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
    <AlertDialogContent className="w-full max-w-[440px] gap-0 border border-destructive/30 bg-[#121413] p-0">
      <div className="relative overflow-hidden border-b border-border">
        {/* Mismo lavado rojo de cabecera que el resto de diálogos de borrado:
            acción destructiva, dicho de un vistazo. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'linear-gradient(120deg, rgba(232,93,114,.14) 0%, transparent 60%)',
          }}
        />
        <div className="relative flex items-center gap-3 px-5.5 py-5">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-destructive/12">
            <Trash2 size={16} className="text-destructive" />
          </div>
          <AlertDialogTitle className="text-base font-extrabold text-foreground">
            Remove playthrough
          </AlertDialogTitle>
        </div>
      </div>

      <div className="px-5.5 py-5">
        <div className="text-[13.5px] leading-relaxed text-[#c4cac6]">
          This permanently deletes{' '}
          <span className="font-bold text-foreground">{iteration?.label}</span>
          {iteration && iteration.sessions.length > 0 && (
            <>
              {' '}
              and its{' '}
              <span className="font-bold text-foreground">
                {pluralize(iteration.sessions.length, 'tracked session')}
              </span>
            </>
          )}
          , along with its status history. Hours and stats will update. It happens right away —
          leaving Edit with Cancel won&apos;t bring it back. This can&apos;t be undone.
        </div>

        {error && (
          <div className="mt-3 text-[12px] text-destructive">
            Couldn&apos;t remove the playthrough — {error.message}
          </div>
        )}
      </div>

      <AlertDialogFooter className="!mx-0 !mb-0 flex-row justify-end gap-2.5 !border-t border-border !bg-transparent px-5.5 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-[10px] border border-input bg-white/3 px-4.5 py-2.5 text-[13.5px] font-semibold text-foreground hover:bg-white/6"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="[will-change:transform] flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13.5px] font-bold text-white transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(220,38,38,.4)]"
          style={{ background: '#dc2626' }}
        >
          <Trash2 size={15} />
          {pending ? 'Removing…' : 'Remove playthrough'}
        </button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const FormInput = ({
  name,
  ...props
}: {
  name: 'label';
} & React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element => {
  const { register } = useFormContext<EditGameFormValues>();
  return (
    <input {...register(name)} {...props} className={`${textInputClass} ${textInputFocusClass}`} />
  );
};

const FormHoursPlayed = (): React.JSX.Element => {
  const { register } = useFormContext<EditGameFormValues>();
  return <HoursPlayedField {...register('hoursPlayed')} />;
};

const FormStatusDropdown = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const value = useWatch({ control, name: 'status' });
  return (
    <Dropdown
      value={value}
      options={NORMAL_STATUS_OPTIONS}
      onChange={(next) => setValue('status', next)}
      renderOption={(option) => {
        const meta = STATUS_META[option];
        return (
          <span className="flex items-center gap-1.5">
            <StatusIcon meta={meta} size={13} />
            {meta.label}
          </span>
        );
      }}
    />
  );
};

const FormCheckboxExtraContent = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const checked = useWatch({ control, name: 'extraContent' });
  return (
    <CheckboxRow
      checked={checked}
      onToggle={() => setValue('extraContent', !checked)}
      title="Extra content only"
      description="This run was just for added content (DLC/expansion), not a full base-game replay."
      accent="blue"
      icon={Package}
    />
  );
};

const FormDatePicker = ({
  name,
  label,
}: {
  name: 'started' | 'finished';
  label: string;
}): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const value = useWatch({ control, name });
  // Si "Finished" todavía no tiene fecha, que abra navegado al mismo mes que
  // "Started" (sin seleccionar nada) en vez de al mes de hoy.
  const started = useWatch({ control, name: 'started' });
  return (
    <DateWithPrecisionPicker
      label={label}
      value={value}
      onChange={(next) => setValue(name, next)}
      defaultMonth={name === 'finished' && started ? parseIsoDate(started.isoDate) : undefined}
    />
  );
};

const ReadonlyDateField = ({
  label,
  iteration,
  field,
}: {
  label: string;
  iteration: IterationDetail;
  field: 'startedAt' | 'endedAt';
}): React.JSX.Element => {
  const date = iteration[field];
  const { data: timeFormat = '24h' } = useTimeFormat();
  return (
    <div className="flex-1">
      <div className={fieldLabelClass}>{label}</div>
      <Tooltip>
        <TooltipTrigger className="flex w-full items-center gap-1.5 rounded-[9px] border border-input bg-white/[0.02] px-3.25 py-2.5 text-left text-[13px] text-muted-foreground">
          {date ? formatByPrecision(date, 'day', timeFormat) : '—'}
          <span className="text-[11px]">(auto)</span>
        </TooltipTrigger>
        <TooltipContent>Derived from this playthrough&apos;s sessions.</TooltipContent>
      </Tooltip>
    </div>
  );
};
