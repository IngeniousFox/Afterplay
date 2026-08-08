import { AlertTriangle, Keyboard, MonitorUp } from 'lucide-react';
import { useState } from 'react';
import { GREEN } from '../../lib/colors';
import {
  useOverlayEnabled,
  useOverlayShortcut,
  useOverlayShortcutStatus,
  useSetOverlayEnabled,
  useSetOverlayShortcut,
} from '../../hooks/settings';
import { CheckboxRow } from '../library/add-game/CheckboxRow';
import { SettingsCard } from './SettingsCard';

// Ajustes del overlay in-game (OVERLAY.md §12): toggle maestro (off por
// defecto, §14.13) + atajo configurable con la colisión A LA VISTA — si otro
// programa tiene el atajo, esta pantalla lo dice; fallar en silencio está
// prohibido por diseño (§6.1).

// Del KeyboardEvent al accelerator de Electron. Solo combos con al menos un
// modificador: una tecla pelada como atajo GLOBAL secuestraría esa tecla al
// sistema entero mientras juegas.
const acceleratorFrom = (event: React.KeyboardEvent): string | null => {
  const key = event.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (parts.length === 0) return null;

  if (key === ' ') parts.push('Space');
  else if (/^[a-z]$/i.test(key)) parts.push(key.toUpperCase());
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key) || /^[0-9]$/.test(key)) parts.push(key);
  else return null;

  return parts.join('+');
};

const humanize = (accelerator: string): string =>
  accelerator.replaceAll('CommandOrControl', 'Ctrl').replaceAll('+', ' + ');

export const OverlaySection = (): React.JSX.Element => {
  const { data: enabled = false } = useOverlayEnabled();
  const { data: shortcut = '' } = useOverlayShortcut();
  const { data: status = 'inactive' } = useOverlayShortcutStatus();
  const setEnabled = useSetOverlayEnabled();
  const setShortcut = useSetOverlayShortcut();
  const [recording, setRecording] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <CheckboxRow
        checked={enabled}
        onToggle={() => setEnabled.mutate(!enabled)}
        title="In-game overlay"
        description="A Steam-style layer over your game: live session timer, achievements at a glance and a quick note. Summon it with the shortcut — or the Guide button on your controller, which games can't see."
        accent="green"
        icon={MonitorUp}
      />
      {enabled && (
        <SettingsCard
          layout="row"
          title="Overlay shortcut"
          description="Works only while a game is running. Click the combo and press a new one to change it."
          icon={Keyboard}
          color={GREEN}
          extra={
            status === 'conflict' ? (
              <div className="mt-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-400">
                <AlertTriangle size={12} className="flex-none" />
                Shortcut in use by another app — pick a different combo.
              </div>
            ) : undefined
          }
        >
          <button
            type="button"
            onClick={() => setRecording(true)}
            onBlur={() => setRecording(false)}
            onKeyDown={(event) => {
              if (!recording) return;
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Escape') {
                setRecording(false);
                return;
              }
              const accelerator = acceleratorFrom(event);
              if (accelerator) {
                setShortcut.mutate(accelerator);
                setRecording(false);
              }
            }}
            className={`rounded-[9px] border px-3 py-1.5 text-[12.5px] font-bold tabular-nums transition-colors duration-150 ${
              recording
                ? 'border-primary/60 bg-primary/10 text-primary'
                : 'border-input bg-white/[0.03] text-foreground hover:bg-white/[0.06]'
            }`}
          >
            {recording ? 'Press a combo…' : humanize(shortcut)}
          </button>
        </SettingsCard>
      )}
    </div>
  );
};
