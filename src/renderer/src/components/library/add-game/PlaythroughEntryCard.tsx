import { Trash2 } from 'lucide-react';
import { NORMAL_STATUS_OPTIONS } from '../../../lib/gameStatus';
import { expandClass } from '../../../lib/styles';
import { PlaythroughDatesHoursStatus } from './PlaythroughDatesHoursStatus';
import { PlaythroughLabel } from './PlaythroughLabel';
import { PlaythroughPlatformFormatOrigin } from './PlaythroughPlatformFormatOrigin';
import { fieldLabelClass, textInputClass, textInputFocusClass } from './styles';
import type { ManualPlaythroughEntry } from './types';

type PlaythroughEntryCardProps = {
  // Número que se enseña en la chapa y en el placeholder de la etiqueta — lo
  // decide quien lo usa, porque no es lo mismo contar los "de más" de Add
  // Game que continuar la numeración de los que el juego ya tiene en Edit.
  number: number;
  entry: ManualPlaythroughEntry;
  onChange: (entry: ManualPlaythroughEntry) => void;
  onRemove: () => void;
};

// Tarjeta de UN playthrough manual pendiente de crear. Presentacional del
// todo (valor + onChange, sin tocar react-hook-form): así la usan tanto Add
// Game, donde son entradas de `extraPlaythroughs`, como Edit Game, donde son
// las que se van apilando antes de guardar — mismo aspecto y mismos campos en
// los dos sitios, que era justo el problema (en Edit se editaba uno suelto
// con otra pinta).
export const PlaythroughEntryCard = ({
  number,
  entry,
  onChange,
  onRemove,
}: PlaythroughEntryCardProps): React.JSX.Element => (
  <div
    className={`flex flex-col gap-3 rounded-[11px] border border-border bg-white/[0.02] p-3.5 ${expandClass}`}
  >
    <div className="flex items-center justify-between gap-2.5">
      <PlaythroughLabel number={number} />
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
      <input
        value={entry.label}
        onChange={(event) => onChange({ ...entry, label: event.target.value })}
        placeholder={`Playthrough ${number}`}
        className={`${textInputClass} ${textInputFocusClass}`}
      />
    </div>

    <PlaythroughDatesHoursStatus
      started={entry.started}
      onStartedChange={(value) => onChange({ ...entry, started: value })}
      finished={entry.finished}
      onFinishedChange={(value) => onChange({ ...entry, finished: value })}
      hoursPlayed={entry.hoursPlayed}
      onHoursPlayedChange={(event) => onChange({ ...entry, hoursPlayed: event.target.value })}
      status={entry.pastStatus}
      onStatusChange={(value) => onChange({ ...entry, pastStatus: value })}
      statusOptions={NORMAL_STATUS_OPTIONS}
    />

    <PlaythroughPlatformFormatOrigin
      platform={entry.platform}
      onPlatformChange={(value) => onChange({ ...entry, platform: value })}
      format={entry.format}
      onFormatChange={(value) => onChange({ ...entry, format: value })}
      origin={entry.origin}
      onOriginChange={(value) => onChange({ ...entry, origin: value })}
    />
  </div>
);
