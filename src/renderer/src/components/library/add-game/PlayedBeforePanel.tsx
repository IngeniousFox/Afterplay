import { useFormContext, useWatch } from 'react-hook-form';
import { ENDLESS_STATUS_OPTIONS, NORMAL_STATUS_OPTIONS } from '../../../lib/gameStatus';
import { PlaythroughDatesHoursStatus } from './PlaythroughDatesHoursStatus';
import type { AddGameFormValues } from './types';

// Panel condicional que aparece cuando se marca "I played this before" —
// Started/Finished solo para juegos no-endless (un endless no tiene un
// punto de fin que registrar, ver types.ts); Hours+Status se piden igual.
export const PlayedBeforePanel = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<AddGameFormValues>();
  const endless = useWatch({ control, name: 'endless' });
  const started = useWatch({ control, name: 'started' });
  const finished = useWatch({ control, name: 'finished' });
  const hoursPlayed = useWatch({ control, name: 'hoursPlayed' });
  const pastStatus = useWatch({ control, name: 'pastStatus' });
  const statusOptions = endless ? ENDLESS_STATUS_OPTIONS : NORMAL_STATUS_OPTIONS;

  return (
    <div className="flex flex-col gap-3 rounded-[11px] border border-border bg-white/[0.02] p-3.5">
      <PlaythroughDatesHoursStatus
        showDates={!endless}
        started={started}
        onStartedChange={(value) => setValue('started', value)}
        finished={finished}
        onFinishedChange={(value) => setValue('finished', value)}
        hoursPlayed={hoursPlayed}
        onHoursPlayedChange={(event) => setValue('hoursPlayed', event.target.value)}
        status={pastStatus}
        onStatusChange={(value) => setValue('pastStatus', value)}
        statusOptions={statusOptions}
        statusOpenDirection="up"
      />
    </div>
  );
};
