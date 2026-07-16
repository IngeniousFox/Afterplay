import { X } from 'lucide-react';
import {
  useOpenAtLogin,
  useSetOpenAtLogin,
  useSetTimeFormat,
  useTimeFormat,
} from '../../hooks/settings';
import { CheckboxRow } from '../library/add-game/CheckboxRow';
import { Dialog, DialogContent } from '../ui/dialog';
import { EmulatorsSection } from './EmulatorsSection';
import { TimeFormatSlider } from './TimeFormatSlider';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// SPEC 3E — de momento trae "iniciar con Windows" y el formato de hora
// (12h/24h), pero vive en su propio modal para que futuros ajustes (tema,
// etc.) tengan dónde caer sin inventar otro sitio.
export const SettingsModal = ({ open, onOpenChange }: SettingsModalProps): React.JSX.Element => {
  const { data: openAtLogin = false, isLoading } = useOpenAtLogin();
  const setOpenAtLogin = useSetOpenAtLogin();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const setTimeFormat = useSetTimeFormat();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] w-100 max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[18px] border border-input bg-[#121413] p-0 shadow-[0_30px_80px_rgba(0,0,0,.6)]"
      >
        <div className="flex items-center justify-between border-b border-border px-5.5 py-4.5">
          <div className="text-[17px] font-extrabold tracking-[-.01em] text-foreground">
            Settings
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-[9px] border border-border bg-white/3 text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5.5 py-5">
          {!isLoading && (
            <CheckboxRow
              checked={openAtLogin}
              onToggle={() => setOpenAtLogin.mutate(!openAtLogin)}
              title="Start with Windows"
              description="Launch Afterplay minimized to the tray when you log in, so the watcher can catch every session — even ones that start before you open the app yourself."
              borderColorChecked="rgba(47,220,126,.7)"
              fillColorChecked="#2fdc7e"
              checkIconColor="#08120c"
            />
          )}

          <div
            className="flex items-center justify-between gap-3 rounded-[10px] bg-white/[0.02] px-3.25 py-2.75"
            style={{ border: '1px solid var(--border)' }}
          >
            <div className="flex-1">
              <div className="text-[13.5px] font-semibold text-foreground">Time format</div>
              <div className="mt-0.25 text-xs text-muted-foreground">
                Show times in 12-hour or 24-hour format everywhere in the app.
              </div>
            </div>
            <TimeFormatSlider value={timeFormat} onChange={(next) => setTimeFormat.mutate(next)} />
          </div>

          <EmulatorsSection />
        </div>
      </DialogContent>
    </Dialog>
  );
};
