import { Info, Trash2 } from 'lucide-react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { GameDetail, IterationDetail } from '../../../../../shared/types';
import { useDeleteIteration } from '../../../hooks/iterations';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision } from '../../../lib/format';
import { STATE_TO_STATUS_KEY, STATUS_META } from '../../../lib/gameStatus';
import { CheckboxRow } from '../add-game/CheckboxRow';
import { DateWithPrecisionPicker } from '../add-game/DateWithPrecisionPicker';
import { Dropdown } from '../add-game/Dropdown';
import { SegmentedButtonGroup } from '../add-game/SegmentedButtonGroup';
import { fieldLabelClass, textInputClass } from '../add-game/styles';
import {
  FORMAT_OPTIONS,
  NORMAL_STATUS_OPTIONS,
  ORIGIN_OPTIONS,
  PLATFORM_OPTIONS,
} from '../add-game/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { EMPTY_ITERATION_FIELDS } from './types';
import type { EditGameFormValues } from './types';

type IterationSectionProps = {
  game: GameDetail;
};

const STATUS_DROPDOWN_OPTIONS = NORMAL_STATUS_OPTIONS;

// SPEC 4.5 — dos modos del mismo formulario: 'existing' (fechas derivadas de
// sus sesiones, solo lectura) y 'new' (pide fechas para generar las sesiones
// de borde de un playthrough manual). Nunca se editan fechas de una
// iteración que ya tiene sesiones — para eso haría falta poder editar
// sesiones sueltas, que no existe todavía.
export const IterationSection = ({ game }: IterationSectionProps): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const iterationMode = useWatch({ control, name: 'iterationMode' });
  const selectedIterationId = useWatch({ control, name: 'selectedIterationId' });
  const deleteIteration = useDeleteIteration();

  const loadIteration = (iteration: IterationDetail): void => {
    setValue('iterationMode', 'existing');
    setValue('selectedIterationId', iteration.id);
    setValue('label', iteration.label);
    setValue('extraContent', iteration.extraContent);
    setValue(
      'status',
      iteration.currentState ? STATE_TO_STATUS_KEY[iteration.currentState] : 'beaten',
    );
    setValue('platform', iteration.playedPlatform);
    setValue('format', iteration.format ?? 'digital');
    setValue('origin', iteration.origin);
    setValue(
      'hoursPlayed',
      iteration.manualTotalPlayed !== null ? String(iteration.manualTotalPlayed) : '',
    );
  };

  const startNewManual = (): void => {
    setValue('iterationMode', 'new');
    setValue('selectedIterationId', null);
    setValue('label', EMPTY_ITERATION_FIELDS.label);
    setValue('started', EMPTY_ITERATION_FIELDS.started);
    setValue('finished', EMPTY_ITERATION_FIELDS.finished);
    setValue('extraContent', EMPTY_ITERATION_FIELDS.extraContent);
    setValue('status', EMPTY_ITERATION_FIELDS.status);
    setValue('platform', EMPTY_ITERATION_FIELDS.platform);
    setValue('format', EMPTY_ITERATION_FIELDS.format);
    setValue('origin', EMPTY_ITERATION_FIELDS.origin);
    setValue('hoursPlayed', EMPTY_ITERATION_FIELDS.hoursPlayed);
  };

  const selectedIteration = game.iterations.find((it) => it.id === selectedIterationId) ?? null;
  const labelsById = new Map(game.iterations.map((it) => [String(it.id), it.label]));

  if (iterationMode === 'none') {
    return (
      <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border py-9 text-center">
        <p className="text-[13px] font-semibold text-foreground">No playthroughs yet.</p>
        <p className="max-w-72 text-[12px] text-muted-foreground">
          Add a manual playthrough to log a run you already did outside the app.
        </p>
        <button
          type="button"
          onClick={startNewManual}
          className="mt-1 rounded-[9px] border border-input bg-white/[0.03] px-3.5 py-1.75 text-[12.5px] font-semibold text-foreground hover:bg-white/[0.06]"
        >
          + Add manual playthrough
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 rounded-[11px] border border-border bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between gap-2.5">
        <div className={fieldLabelClass}>PLAYTHROUGH</div>
        {iterationMode === 'new' ? (
          game.iterations.length > 0 && (
            <button
              type="button"
              onClick={() => loadIteration(game.iterations[game.iterations.length - 1])}
              className="text-[12px] font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={startNewManual}
            className="text-[12px] font-semibold text-foreground hover:underline"
          >
            + Add manual
          </button>
        )}
      </div>

      {iterationMode === 'existing' && game.iterations.length > 1 && (
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

      {iterationMode === 'new' && (
        <div
          className="flex items-center gap-1.75 rounded-[9px] px-3 py-2 text-[12px] font-semibold"
          style={{ background: 'rgba(133,163,214,.1)', color: '#85a3d6' }}
        >
          <Info size={13} />
          Manual playthrough — enter the dates you played it outside the app.
        </div>
      )}

      <div>
        <div className={fieldLabelClass}>LABEL</div>
        <FormInput name="label" placeholder="Playthrough 1" />
      </div>

      {iterationMode === 'existing' && selectedIteration ? (
        <div className="flex gap-2.5">
          <ReadonlyDateField label="Started" iteration={selectedIteration} field="startedAt" />
          <ReadonlyDateField
            label="Finished / left"
            iteration={selectedIteration}
            field="endedAt"
          />
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
        <div className="flex-1">
          <div className={fieldLabelClass}>HOURS PLAYED</div>
          <FormInput name="hoursPlayed" type="number" min={0} step="0.5" placeholder="0" />
        </div>
      </div>

      <div>
        <div className={fieldLabelClass}>PLATFORM</div>
        <FormPlatformDropdown />
      </div>

      <div>
        <div className={fieldLabelClass}>FORMAT</div>
        <FormSegmented name="format" options={FORMAT_OPTIONS} />
      </div>

      <div>
        <div className={fieldLabelClass}>ORIGIN</div>
        <FormSegmented
          name="origin"
          options={ORIGIN_OPTIONS.map((option) => ({ value: option, label: option }))}
          wrap
        />
      </div>

      {iterationMode === 'existing' && selectedIterationId && (
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
  );
};

const FormInput = ({
  name,
  ...props
}: {
  name: 'label' | 'platform' | 'hoursPlayed';
} & React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element => {
  const { register } = useFormContext<EditGameFormValues>();
  return <input {...register(name)} {...props} className={textInputClass} />;
};

const FormSegmented = ({
  name,
  options,
  wrap,
}: {
  name: 'format' | 'origin';
  options: { value: string; label: string }[];
  wrap?: boolean;
}): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const value = useWatch({ control, name });
  return (
    <SegmentedButtonGroup
      value={value}
      options={options}
      onChange={(next) => setValue(name, next)}
      wrap={wrap}
    />
  );
};

const FormPlatformDropdown = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const value = useWatch({ control, name: 'platform' });
  return (
    <Dropdown
      value={value}
      options={PLATFORM_OPTIONS}
      onChange={(next) => setValue('platform', next)}
      renderOption={(option) => option}
    />
  );
};

const FormStatusDropdown = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();
  const value = useWatch({ control, name: 'status' });
  return (
    <Dropdown
      value={value}
      options={STATUS_DROPDOWN_OPTIONS}
      onChange={(next) => setValue('status', next)}
      renderOption={(option) => {
        const meta = STATUS_META[option];
        return (
          <span className="flex items-center gap-1.5">
            <meta.Icon size={13} color={meta.color} fill={meta.filled ? meta.color : 'none'} />
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
      borderColorChecked="rgba(133,163,214,.6)"
      fillColorChecked="#85a3d6"
      checkIconColor="#0a0b0a"
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
  return (
    <DateWithPrecisionPicker
      label={label}
      value={value}
      onChange={(next) => setValue(name, next)}
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
