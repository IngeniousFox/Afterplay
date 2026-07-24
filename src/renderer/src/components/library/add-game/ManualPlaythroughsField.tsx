import { Plus, Trash2 } from 'lucide-react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { NORMAL_STATUS_OPTIONS } from '../../../lib/gameStatus';
import { expandClass } from '../../../lib/styles';
import { PlaythroughDatesHoursStatus } from './PlaythroughDatesHoursStatus';
import { PlaythroughPlatformFormatOrigin } from './PlaythroughPlatformFormatOrigin';
import { fieldLabelClass, textInputClass, textInputFocusClass } from './styles';
import { EMPTY_MANUAL_PLAYTHROUGH } from './types';
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
  const { control, setValue } = useFormContext<AddGameFormValues>();
  const started = useWatch({ control, name: `extraPlaythroughs.${index}.started` });
  const finished = useWatch({ control, name: `extraPlaythroughs.${index}.finished` });
  const hoursPlayed = useWatch({ control, name: `extraPlaythroughs.${index}.hoursPlayed` });
  const pastStatus = useWatch({ control, name: `extraPlaythroughs.${index}.pastStatus` });
  const platform = useWatch({ control, name: `extraPlaythroughs.${index}.platform` });
  const format = useWatch({ control, name: `extraPlaythroughs.${index}.format` });
  const origin = useWatch({ control, name: `extraPlaythroughs.${index}.origin` });

  return (
    <div
      className={`flex flex-col gap-3 rounded-[11px] border border-border bg-white/[0.02] p-3.5 ${expandClass}`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <span
            className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10.5px] font-extrabold tabular-nums"
            style={{ background: 'rgba(133,163,214,.15)', color: '#85a3d6' }}
          >
            {index + 2}
          </span>
          <span className={fieldLabelClass}>PLAYTHROUGH</span>
        </div>
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
            <input
              {...field}
              placeholder={`Playthrough ${index + 2}`}
              className={`${textInputClass} ${textInputFocusClass}`}
            />
          )}
        />
      </div>

      <PlaythroughDatesHoursStatus
        started={started}
        onStartedChange={(value) => setValue(`extraPlaythroughs.${index}.started`, value)}
        finished={finished}
        onFinishedChange={(value) => setValue(`extraPlaythroughs.${index}.finished`, value)}
        hoursPlayed={hoursPlayed}
        onHoursPlayedChange={(event) =>
          setValue(`extraPlaythroughs.${index}.hoursPlayed`, event.target.value)
        }
        status={pastStatus}
        onStatusChange={(value) => setValue(`extraPlaythroughs.${index}.pastStatus`, value)}
        statusOptions={NORMAL_STATUS_OPTIONS}
      />

      <PlaythroughPlatformFormatOrigin
        platform={platform}
        onPlatformChange={(value) => setValue(`extraPlaythroughs.${index}.platform`, value)}
        format={format}
        onFormatChange={(value) => setValue(`extraPlaythroughs.${index}.format`, value)}
        origin={origin}
        onOriginChange={(value) => setValue(`extraPlaythroughs.${index}.origin`, value)}
      />
    </div>
  );
};
