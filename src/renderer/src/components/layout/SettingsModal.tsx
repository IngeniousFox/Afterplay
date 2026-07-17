import {
  useOpenAtLogin,
  useSetOpenAtLogin,
  useSetTimeFormat,
  useTimeFormat,
} from '../../hooks/settings';
import { CheckboxRow } from '../library/add-game/CheckboxRow';
import { ModalShell } from '../ui/modal-shell';
import { BackupSection } from './BackupSection';
import { CredentialsSection } from './CredentialsSection';
import { EmulatorsSection } from './EmulatorsSection';
import { SettingsCard } from './SettingsCard';
import { TimeFormatSlider } from './TimeFormatSlider';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Primer arranque sin credenciales de IGDB (ver NavRail): el modal se abre
  // solo y la sección API & Sync nace expandida con un aviso de por qué.
  credentialsSpotlight?: boolean;
};

// SPEC 3E — de momento trae "iniciar con Windows" y el formato de hora
// (12h/24h), pero vive en su propio modal para que futuros ajustes (tema,
// etc.) tengan dónde caer sin inventar otro sitio.
export const SettingsModal = ({
  open,
  onOpenChange,
  credentialsSpotlight = false,
}: SettingsModalProps): React.JSX.Element => {
  const { data: openAtLogin = false, isLoading } = useOpenAtLogin();
  const setOpenAtLogin = useSetOpenAtLogin();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const setTimeFormat = useSetTimeFormat();

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      title="Settings"
      widthClass="w-130"
      maxHClass="max-h-[80vh]"
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5.5 py-5"
    >
      {credentialsSpotlight && (
        <div
          className="rounded-[9px] px-3 py-2 text-[12px] font-semibold"
          style={{ background: 'rgba(227,178,74,.1)', color: '#e3b24a' }}
        >
          Welcome! To search games and fetch artwork, Afterplay needs your own API keys — add them
          in API &amp; Sync below. Everything else already works.
        </div>
      )}

      <CredentialsSection initiallyOpen={credentialsSpotlight} />

      {!isLoading && (
        <CheckboxRow
          checked={openAtLogin}
          onToggle={() => setOpenAtLogin.mutate(!openAtLogin)}
          title="Start with Windows"
          description="Launch Afterplay minimized to the tray when you log in, so the watcher can catch every session — even ones that start before you open the app yourself."
          accent="green"
        />
      )}

      <SettingsCard
        layout="row"
        title="Time format"
        description="Show times in 12-hour or 24-hour format everywhere in the app."
      >
        <TimeFormatSlider value={timeFormat} onChange={(next) => setTimeFormat.mutate(next)} />
      </SettingsCard>

      <BackupSection />

      <EmulatorsSection />
    </ModalShell>
  );
};
