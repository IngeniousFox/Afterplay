import {
  useOpenAtLogin,
  useSetOpenAtLogin,
  useSetTimeFormat,
  useTimeFormat,
} from '../../hooks/settings';
import { useSavesStatus } from '../../hooks/saves';
import { Switch } from '../ui/switch';
import { AboutSection } from './AboutSection';
import { AchievementsSettingsSection } from './AchievementsSettingsSection';
import { AmbientSection } from './AmbientSection';
import { BackupSection } from './BackupSection';
import { CloudIdentitySection } from './CloudIdentitySection';
import { CloudInventorySection } from './CloudInventorySection';
import { CredentialsSection } from './CredentialsSection';
import { EmulatorsSection } from './EmulatorsSection';
import { ExternalDataSection } from './ExternalDataSection';
import { GameFoldersSection } from './GameFoldersSection';
import { ImagesSection } from './ImagesSection';
import { LocalSaveBackupsSection } from './LocalSaveBackupsSection';
import { MemoriesSection } from './MemoriesSection';
import { OverlaySection } from './OverlaySection';
import { SavesScanSection } from './SavesScanSection';
import { SettingsCard, SettingsNotice, SettingsRow } from './SettingsCard';
import type { SettingsSectionId } from './SettingsSections';
import { SyncSection } from './SyncSection';
import { TimeFormatSlider } from './TimeFormatSlider';
import { TriviaSection } from './TriviaSection';

// El contenido de cada sección de la página de Ajustes (screens/Settings).
// Se carga en su propio fragmento: los controles solo se descargan al entrar.
// Cada sección reparte sus bloques en una o dos columnas; por debajo de
// 1280 px todo cae a una columna.
export const SettingsContent = ({
  section,
  credentialsSpotlight,
}: {
  section: SettingsSectionId;
  credentialsSpotlight: boolean;
}): React.JSX.Element => {
  switch (section) {
    case 'general':
      return (
        <div className="flex max-w-[1100px] flex-col gap-5">
          <StartupAndTime />
          <AmbientSection />
          <OverlaySection />
        </div>
      );
    case 'library':
      return (
        <div className="flex flex-col gap-5">
          <GameFoldersSection />
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <ExternalDataSection />
            <ImagesSection />
          </div>
        </div>
      );
    case 'emulators':
      return <EmulatorsSection />;
    case 'saves':
      return <SavesLayout />;
    case 'integrations':
      return (
        <div className="flex flex-col gap-5">
          {credentialsSpotlight && (
            <SettingsNotice>
              <span className="font-bold">Welcome!</span> To search games and fetch artwork,
              Afterplay needs your own API keys. Add them below; everything else already works.
            </SettingsNotice>
          )}
          <CredentialsSection spotlight={credentialsSpotlight} />
        </div>
      );
    case 'sync':
      return <SyncSection />;
    case 'achievements':
      return (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <AchievementsSettingsSection />
          <div className="flex min-w-0 flex-col gap-5">
            <MemoriesSection />
            <TriviaSection />
          </div>
        </div>
      );
    case 'backups':
      return (
        <div className="max-w-[1100px]">
          <BackupSection />
        </div>
      );
    case 'about':
      return (
        <div className="max-w-[1100px]">
          <AboutSection />
        </div>
      );
  }
};

// General → Startup and time: arrancar con Windows y el formato de hora.
const StartupAndTime = (): React.JSX.Element => {
  const { data: openAtLogin = false, isLoading } = useOpenAtLogin();
  const setOpenAtLogin = useSetOpenAtLogin();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const setTimeFormat = useSetTimeFormat();

  return (
    <SettingsCard title="Startup and time" flush>
      {!isLoading && (
        <SettingsRow
          labelId="settings-open-at-login"
          label="Start with Windows"
          description="Launch Afterplay minimized to the tray when you log in, so the watcher can catch every session, even ones that start before you open the app yourself."
          control={
            <Switch
              checked={openAtLogin}
              onCheckedChange={(next) => setOpenAtLogin.mutate(next)}
              aria-labelledby="settings-open-at-login"
            />
          }
        />
      )}
      <SettingsRow
        label="Time format"
        description="Show times in 12-hour or 24-hour format everywhere in the app."
        control={
          <TimeFormatSlider value={timeFormat} onChange={(next) => setTimeFormat.mutate(next)} />
        }
      />
    </SettingsCard>
  );
};

// Saves: a la izquierda lo que se respalda (escaneo y copias locales); a la
// derecha la identidad de este PC en la nube y lo que hay de verdad en el
// bucket, que solo existe si hay bucket al que preguntar.
const SavesLayout = (): React.JSX.Element => {
  const { data: status } = useSavesStatus();
  // Sin bucket la columna derecha se quedaría casi siempre vacía: todo en una.
  if (!status?.r2Configured) {
    return (
      <div className="flex max-w-[1100px] flex-col gap-5">
        <CloudIdentitySection />
        <SavesScanSection />
        <LocalSaveBackupsSection />
      </div>
    );
  }
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <SavesScanSection />
        <LocalSaveBackupsSection />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <CloudIdentitySection />
        <CloudInventorySection />
      </div>
    </div>
  );
};
