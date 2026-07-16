import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { STATUS_META } from '../../../lib/gameStatus';
import { DateWithPrecisionPicker } from './DateWithPrecisionPicker';
import { Dropdown } from './Dropdown';
import { fieldLabelClass, textInputClass } from './styles';
import type { AddGameFormValues, PastStatusKey } from './types';
import { ENDLESS_STATUS_OPTIONS, NORMAL_STATUS_OPTIONS } from './types';

// Panel condicional que aparece cuando se marca "I played this before" —
// Started/Finished solo para juegos no-endless (un endless no tiene un
// punto de fin que registrar, ver types.ts).
export const PlayedBeforePanel = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<AddGameFormValues>();
  const endless = useWatch({ control, name: 'endless' });
  const pastStatus = useWatch({ control, name: 'pastStatus' });
  const statusOptions = endless ? ENDLESS_STATUS_OPTIONS : NORMAL_STATUS_OPTIONS;
  // Si sigue jugándolo ahora mismo, todavía no lo ha "dejado" — no hay fecha
  // de fin que anotar (igual que on_hold/dropped/beaten sí la tienen, porque
  // esos tres SÍ marcan un punto donde se dejó de jugar).
  const isOngoing = pastStatus === 'playing';

  return (
    <div className="flex flex-col gap-3 rounded-[11px] border border-border bg-white/[0.02] p-3.5">
      {!endless && (
        <div className="flex gap-2.5">
          <Controller
            control={control}
            name="started"
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
              name="finished"
              render={({ field }) => (
                <DateWithPrecisionPicker
                  label="Finished / left"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          )}
        </div>
      )}

      <div className="flex items-end gap-2.5">
        <div className="flex-1">
          <div className={fieldLabelClass}>HOURS PLAYED</div>
          <Controller
            control={control}
            name="hoursPlayed"
            render={({ field }) => (
              <input
                {...field}
                type="number"
                min={0}
                placeholder="e.g. 42"
                // Chromium cambia el valor de un <input type="number"> con la
                // rueda del ratón mientras tiene el foco — igual que si fueran
                // las flechitas, pero sin ningún indicio visual de que ha
                // pasado. Muy fácil de disparar sin querer al bajar por un
                // modal con scroll justo después de escribir aquí (bug real
                // reportado: "metí 68 y se guardó 65"). Quitar el foco al
                // recibir la rueda deja que el scroll actúe sobre la página,
                // no sobre el número.
                onWheel={(event) => event.currentTarget.blur()}
                className={textInputClass}
              />
            )}
          />
        </div>
        <div className="flex-1">
          <div className={fieldLabelClass}>STATUS</div>
          <Controller
            control={control}
            name="pastStatus"
            render={({ field }) => (
              <Dropdown<PastStatusKey>
                value={field.value}
                options={statusOptions}
                onChange={(option) => {
                  field.onChange(option);
                  // Deja de tener sentido un "Finished / left" que ya no se
                  // enseña — si había uno puesto de antes (venías de Beaten,
                  // por ejemplo), se limpia para que no viaje escondido.
                  if (option === 'playing') setValue('finished', null);
                }}
                openDirection="up"
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
    </div>
  );
};
