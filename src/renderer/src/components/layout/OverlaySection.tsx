import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  useOverlayEnabled,
  useOverlayShortcut,
  useOverlayShortcutStatus,
  useSetOverlayEnabled,
  useSetOverlayShortcut,
} from '../../hooks/settings';
import { buttonSize, secondaryButtonClass } from '../shell/controls';
import { Switch } from '../ui/switch';
import { SettingsCard, SettingsRow } from './SettingsCard';

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
    <SettingsCard
      title="In-game overlay"
      description="A Steam-style layer over your game: live session timer, achievements at a glance and a quick note. Summon it with the shortcut, or the Guide button on your controller, which games can't see."
      flush
    >
      <SettingsRow
        labelId="settings-overlay-enabled"
        label="Show the overlay in games"
        control={
          <Switch
            checked={enabled}
            onCheckedChange={(next) => setEnabled.mutate(next)}
            aria-labelledby="settings-overlay-enabled"
          />
        }
      />
      {enabled && (
        <SettingsRow
          label="Shortcut"
          description="Works only while a game is running. Click the combo and press a new one to change it."
          control={
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
              className={cn(
                secondaryButtonClass,
                buttonSize.md,
                'tabular-nums',
                recording &&
                  'border-phosphor bg-phosphor-tint text-phosphor hover:bg-phosphor-tint',
              )}
            >
              {recording ? 'Press a combo…' : humanize(shortcut)}
            </button>
          }
        >
          {status === 'conflict' && (
            <div className="mt-1.5 flex items-center gap-1.5 text-small font-semibold text-phosphor">
              <AlertTriangle aria-hidden size={13} className="flex-none" />
              Shortcut in use by another app. Pick a different combo.
            </div>
          )}
        </SettingsRow>
      )}
    </SettingsCard>
  );
};
