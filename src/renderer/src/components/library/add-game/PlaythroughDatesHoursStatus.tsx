import { STATUS_META } from '../../../lib/gameStatus';
import type { PastStatusKey } from '../../../lib/gameStatus';
import { DateWithPrecisionPicker } from './DateWithPrecisionPicker';
import { Dropdown } from './Dropdown';
import { HoursPlayedField } from './HoursPlayedField';
import { parseIsoDate } from './precisionDate';
import type { PrecisionDateValue } from './precisionDate';
import { fieldLabelClass } from './styles';

type PlaythroughDatesHoursStatusProps = {
  started: PrecisionDateValue | null;
  onStartedChange: (value: PrecisionDateValue | null) => void;
  finished: PrecisionDateValue | null;
  onFinishedChange: (value: PrecisionDateValue | null) => void;
  hoursPlayed: string;
  onHoursPlayedChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  status: PastStatusKey;
  onStatusChange: (value: PastStatusKey) => void;
  statusOptions: PastStatusKey[];
  statusOpenDirection?: 'up' | 'down';
  // PlayedBeforePanel oculta SOLO la fila de fechas para un juego endless
  // (Hours+Status se sigue pidiendo igual) — Hours/Status no dependen de
  // esto, por eso es un prop aparte y no una condición interna del bloque.
  showDates?: boolean;
};

// Bloque Started/Finished + Hours + Status, compartido por PlayedBeforePanel
// (el primer playthrough de Add Game) y ManualPlaythroughsField (sus
// playthroughs extra) — mismo layout, mismos componentes, misma regla de
// "sigues jugándolo -> sin fecha de fin que anotar". Elegir "Playing" limpia
// `finished` SIEMPRE aquí (antes solo lo hacía PlayedBeforePanel; el guardado
// ya descartaba un `finished` viejo con isOngoing, pero dejaba un valor
// fantasma en el form si volvías a cambiar de estado — se unifica al fundir
// los dos sitios en uno).
// EditGameModal (IterationSection) NO usa este bloque: su modo "+ Add
// manual" enseña Finished siempre sin ocultarlo por estado y pinta el
// dropdown de estado con su propio renderOption — comportamiento propio,
// no una duplicación de este componente.
export const PlaythroughDatesHoursStatus = ({
  started,
  onStartedChange,
  finished,
  onFinishedChange,
  hoursPlayed,
  onHoursPlayedChange,
  status,
  onStatusChange,
  statusOptions,
  statusOpenDirection,
  showDates = true,
}: PlaythroughDatesHoursStatusProps): React.JSX.Element => {
  // Sigues jugándolo ahora mismo = todavía no lo has "dejado", no hay fecha
  // de fin que anotar (a diferencia de on_hold/dropped/beaten, que sí marcan
  // un punto donde se dejó de jugar).
  const isOngoing = status === 'playing';

  return (
    <>
      {showDates && (
        <div className="flex gap-2.5">
          <DateWithPrecisionPicker label="Started" value={started} onChange={onStartedChange} />
          {!isOngoing && (
            <DateWithPrecisionPicker
              label="Finished / left"
              value={finished}
              onChange={onFinishedChange}
              defaultMonth={started ? parseIsoDate(started.isoDate) : undefined}
            />
          )}
        </div>
      )}

      <div className="flex items-end gap-2.5">
        <HoursPlayedField value={hoursPlayed} onChange={onHoursPlayedChange} />
        <div className="flex-1">
          <div className={fieldLabelClass}>STATUS</div>
          <Dropdown<PastStatusKey>
            value={status}
            options={statusOptions}
            onChange={(option) => {
              onStatusChange(option);
              if (option === 'playing') onFinishedChange(null);
            }}
            openDirection={statusOpenDirection}
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
        </div>
      </div>
    </>
  );
};
