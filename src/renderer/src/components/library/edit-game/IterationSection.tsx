import { Package, Trash2 } from 'lucide-react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import type { GameDetail, IterationDetail } from '../../../../../shared/types';
import { useDeleteIteration } from '../../../hooks/iterations';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision } from '../../../lib/format';
import {
  END_EVENT_STATUS_KEYS,
  NORMAL_STATUS_OPTIONS,
  STATE_TO_STATUS_KEY,
  STATUS_META,
} from '../../../lib/gameStatus';
import type { PastStatusKey } from '../../../lib/gameStatus';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { edgeEventPickerValue } from './types';
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
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const iterationMode = useWatch({ control, name: 'iterationMode' });
  const selectedIterationId = useWatch({ control, name: 'selectedIterationId' });
  const status = useWatch({ control, name: 'status' });
  const platform = useWatch({ control, name: 'platform' });
  const format = useWatch({ control, name: 'format' });
  const origin = useWatch({ control, name: 'origin' });
  const newPlaythroughs = useWatch({ control, name: 'newPlaythroughs' });
  const deleteIteration = useDeleteIteration();

  const loadIteration = (iteration: IterationDetail): void => {
    setValue('iterationMode', 'existing');
    setValue('selectedIterationId', iteration.id);
    setValue('label', iteration.label);
    setValue('extraContent', iteration.extraContent);
    // El cast es seguro: currentState sale de latestRealStateEvent, que
    // ignora 'plan_to_play' — nunca llega aquí el estado 'plan'.
    setValue(
      'status',
      iteration.currentState
        ? (STATE_TO_STATUS_KEY[iteration.currentState] as PastStatusKey)
        : 'beaten',
    );
    setValue('platform', iteration.playedPlatform);
    setValue('format', iteration.format ?? 'digital');
    setValue('origin', iteration.origin);
    setValue(
      'hoursPlayed',
      iteration.manualTotalPlayed !== null ? String(iteration.manualTotalPlayed) : '',
    );
    // Modelo v2 — las fechas de borde SON eventos del log. Solo entran al
    // formulario (editables) cuando su dueño es un evento: un inicio que
    // viene de una sesión MEDIDA (startedBySession) se queda fuera (null) y
    // su campo se pinta en solo lectura — una medición no se falsea.
    setValue(
      'started',
      iteration.startedBySession ? null : edgeEventPickerValue(iteration.startEvent),
    );
    setValue('finished', edgeEventPickerValue(iteration.endEvent));
  };

  const selectedIteration = game.iterations.find((it) => it.id === selectedIterationId) ?? null;
  const labelsById = new Map(game.iterations.map((it) => [String(it.id), it.label]));

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
          <button
            type="button"
            onClick={() => {
              const remaining = game.iterations.filter((it) => it.id !== selectedIterationId);
              deleteIteration.mutate(selectedIterationId);
              if (remaining.length > 0) loadIteration(remaining[remaining.length - 1]);
              else setValue('iterationMode', 'none');
            }}
            disabled={deleteIteration.isPending}
            className="flex w-fit items-center gap-1.5 rounded-[9px] px-3 py-1.75 text-[12.5px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 size={13} />
            Remove playthrough
          </button>
        )}
      </div>

      {pendingList}
    </div>
  );
};

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
