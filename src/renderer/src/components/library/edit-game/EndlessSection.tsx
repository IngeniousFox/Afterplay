import { Controller, useFormContext } from 'react-hook-form';
import { ENDLESS_STATUS_OPTIONS, STATUS_META } from '../../../lib/gameStatus';
import type { PastStatusKey } from '../../../lib/gameStatus';
import { NumberInput } from '../../ui/number-input';
import { Dropdown } from '../add-game/Dropdown';
import { fieldLabelClass, textInputClass } from '../add-game/styles';
import type { EditGameFormValues } from './types';

// Contrapartida de IterationSection para juegos ENDLESS: sin playthroughs
// discretos que editar, pero sí lo que Add Game ya dejaba registrar para
// endless — horas jugadas fuera de la app (manualTotalPlayed del playthrough
// contenedor) y su estado (Playing/Resting/Dropped). Antes esto era solo un
// aviso de "Tracked by sessions" sin campos; lo jugado por fuera no se podía
// tocar una vez creado el juego.
export const EndlessSection = (): React.JSX.Element => {
  const { control } = useFormContext<EditGameFormValues>();

  return (
    <div className="flex flex-col gap-3.5 rounded-[11px] border border-border bg-white/[0.02] p-3.5">
      <div className={fieldLabelClass}>ENDLESS TRACKING</div>
      <div className="rounded-[9px] bg-white/[0.02] px-3 py-2 text-[12px] text-muted-foreground">
        No playthroughs — sessions add up on their own. Log hours you played outside the app and
        keep its status current here.
      </div>

      <div className="flex items-end gap-2.5">
        <div className="flex-1">
          <div className={fieldLabelClass}>
            HOURS PLAYED{' '}
            <span className="font-medium tracking-normal normal-case">· outside the app</span>
          </div>
          <Controller
            control={control}
            name="hoursPlayed"
            render={({ field }) => (
              <NumberInput {...field} min={0} placeholder="e.g. 120" className={textInputClass} />
            )}
          />
        </div>
        <div className="flex-1">
          <div className={fieldLabelClass}>STATUS</div>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Dropdown<PastStatusKey>
                value={field.value}
                options={ENDLESS_STATUS_OPTIONS}
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
    </div>
  );
};
