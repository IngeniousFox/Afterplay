import { Plus, Trash2 } from 'lucide-react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { NORMAL_STATUS_OPTIONS, STATUS_META } from '../../../lib/gameStatus';
import type { PastStatusKey } from '../../../lib/gameStatus';
import { NumberInput } from '../../ui/number-input';
import { DateWithPrecisionPicker } from './DateWithPrecisionPicker';
import { Dropdown } from './Dropdown';
import { parseIsoDate } from './precisionDate';
import { SegmentedButtonGroup } from './SegmentedButtonGroup';
import { fieldLabelClass, textInputClass } from './styles';
import {
  EMPTY_MANUAL_PLAYTHROUGH,
  FORMAT_OPTIONS,
  ORIGIN_SEGMENT_OPTIONS,
  PLATFORM_OPTIONS,
} from './types';
import type { AddGameFormValues } from './types';

// PlayedBeforePanel ya cubre el PRIMER playthrough pasado (started/finished/
// hoursPlayed/pastStatus sueltos, arriba en el formulario) — esto añade los
// que hagan falta de más, con los mismos campos por-iteración que Edit Game
// pide en su modo "+ Add manual" (edit-game/IterationSection.tsx). Al
// guardar, cada entrada se crea con el mismo guion (ver addManualPlaythrough
// en AddGameModal.tsx).
export const ManualPlaythroughsField = (): React.JSX.Element => {
  const { control } = useFormContext<AddGameFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'extraPlaythroughs' });

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, index) => (
        <PlaythroughEntry key={field.id} index={index} onRemove={() => remove(index)} />
      ))}
      <button
        type="button"
        onClick={() => append(EMPTY_MANUAL_PLAYTHROUGH)}
        className="flex w-fit items-center gap-1.5 rounded-[9px] border border-input bg-white/[0.03] px-3.5 py-1.75 text-[12.5px] font-semibold text-foreground hover:bg-white/[0.06]"
      >
        <Plus size={13} />
        Add another playthrough
      </button>
    </div>
  );
};

const PlaythroughEntry = ({
  index,
  onRemove,
}: {
  index: number;
  onRemove: () => void;
}): React.JSX.Element => {
  const { control } = useFormContext<AddGameFormValues>();
  const pastStatus = useWatch({ control, name: `extraPlaythroughs.${index}.pastStatus` });
  const started = useWatch({ control, name: `extraPlaythroughs.${index}.started` });
  // Igual que PlayedBeforePanel: sigue jugándolo ahora mismo = todavía no lo
  // ha "dejado", no hay fecha de fin que anotar.
  const isOngoing = pastStatus === 'playing';

  return (
    <div className="flex flex-col gap-3 rounded-[11px] border border-border bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between gap-2.5">
        <div className={fieldLabelClass}>PLAYTHROUGH {index + 2}</div>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1.5 rounded-[9px] px-2.5 py-1 text-[12px] font-semibold text-destructive hover:bg-destructive/10"
        >
          <Trash2 size={13} />
          Remove
        </button>
      </div>

      <div>
        <div className={fieldLabelClass}>LABEL</div>
        <Controller
          control={control}
          name={`extraPlaythroughs.${index}.label`}
          render={({ field }) => (
            <input {...field} placeholder={`Playthrough ${index + 2}`} className={textInputClass} />
          )}
        />
      </div>

      <div className="flex gap-2.5">
        <Controller
          control={control}
          name={`extraPlaythroughs.${index}.started`}
          render={({ field }) => (
            <DateWithPrecisionPicker
              label="Started"
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        {!isOngoing && (
          <Controller
            control={control}
            name={`extraPlaythroughs.${index}.finished`}
            render={({ field }) => (
              <DateWithPrecisionPicker
                label="Finished / left"
                value={field.value}
                onChange={field.onChange}
                defaultMonth={started ? parseIsoDate(started.isoDate) : undefined}
              />
            )}
          />
        )}
      </div>

      <div className="flex items-end gap-2.5">
        <div className="flex-1">
          <div className={fieldLabelClass}>HOURS PLAYED</div>
          <Controller
            control={control}
            name={`extraPlaythroughs.${index}.hoursPlayed`}
            render={({ field }) => (
              <NumberInput {...field} min={0} placeholder="e.g. 42" className={textInputClass} />
            )}
          />
        </div>
        <div className="flex-1">
          <div className={fieldLabelClass}>STATUS</div>
          <Controller
            control={control}
            name={`extraPlaythroughs.${index}.pastStatus`}
            render={({ field }) => (
              <Dropdown<PastStatusKey>
                value={field.value}
                options={NORMAL_STATUS_OPTIONS}
                onChange={field.onChange}
                renderOption={(option) => {
                  const meta = STATUS_META[option];
                  return (
                    <span className="flex items-center gap-2" style={{ color: meta.color }}>
                      <meta.Icon size={14} />
                      <span>{meta.label}</span>
                    </span>
                  );
                }}
              />
            )}
          />
        </div>
      </div>

      <div>
        <div className={fieldLabelClass}>PLATFORM</div>
        <Controller
          control={control}
          name={`extraPlaythroughs.${index}.platform`}
          render={({ field }) => (
            <Dropdown
              value={field.value}
              options={PLATFORM_OPTIONS}
              onChange={field.onChange}
              renderOption={(option) => option}
              searchable
            />
          )}
        />
      </div>

      <div>
        <div className={fieldLabelClass}>FORMAT</div>
        <Controller
          control={control}
          name={`extraPlaythroughs.${index}.format`}
          render={({ field }) => (
            <SegmentedButtonGroup
              value={field.value}
              options={FORMAT_OPTIONS}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      <div>
        <div className={fieldLabelClass}>ORIGIN</div>
        <Controller
          control={control}
          name={`extraPlaythroughs.${index}.origin`}
          render={({ field }) => (
            <SegmentedButtonGroup
              value={field.value}
              options={ORIGIN_SEGMENT_OPTIONS}
              onChange={field.onChange}
              wrap
            />
          )}
        />
      </div>
    </div>
  );
};
