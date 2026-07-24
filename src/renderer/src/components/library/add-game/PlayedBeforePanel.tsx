import { useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { ENDLESS_STATUS_OPTIONS, NORMAL_STATUS_OPTIONS } from '../../../lib/gameStatus';
import { DateWithPrecisionPicker } from './DateWithPrecisionPicker';
import { PlaythroughDatesHoursStatus } from './PlaythroughDatesHoursStatus';
import { PlaythroughLabel } from './PlaythroughLabel';
import { todayValue } from './precisionDate';
import type { AddGameFormValues } from './types';

// Panel condicional que aparece cuando se marca "I played this before" —
// Started/Finished solo para juegos no-endless (un endless no tiene un
// punto de fin que registrar, ver types.ts); Hours+Status se piden igual.
//
// Un endless SÍ necesita poder fechar desde cuándo está en ese estado ("lo
// dejé en Resting en marzo"), así que en su lugar se pide UNA fecha: la de
// inicio, que es la que `writeInitialPlaythrough` acaba usando para fechar el
// evento de estado cuando no hay fecha de fin. Sin ella, todo endless jugado
// en el pasado se registraba como si el estado hubiera cambiado hoy.
export const PlayedBeforePanel = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<AddGameFormValues>();
  const endless = useWatch({ control, name: 'endless' });
  const started = useWatch({ control, name: 'started' });
  const finished = useWatch({ control, name: 'finished' });
  const hoursPlayed = useWatch({ control, name: 'hoursPlayed' });
  const pastStatus = useWatch({ control, name: 'pastStatus' });
  const statusOptions = endless ? ENDLESS_STATUS_OPTIONS : NORMAL_STATUS_OPTIONS;
  // Hoy, fijado al montar el panel (no en cada render, que daría un objeto
  // nuevo cada vez). Se usa SOLO como valor mostrado del picker de endless: el
  // campo del formulario sigue en null mientras no se toque, y el backend ya
  // cae a hoy por su cuenta en ese caso — así lo que se ve y lo que se guarda
  // coinciden sin tener que escribir en el form al abrir. Y si luego se
  // desmarca "endless", el campo Started de un juego normal no queda
  // prerrellenado con hoy, que ahí sería incorrecto.
  const [today] = useState(todayValue);

  return (
    <div className="flex flex-col gap-3 rounded-[11px] border border-border bg-white/[0.02] p-3.5">
      <PlaythroughLabel number={1} />
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

      {endless && (
        <DateWithPrecisionPicker
          label="Since"
          value={started ?? today}
          onChange={(value) => setValue('started', value)}
        />
      )}
    </div>
  );
};
