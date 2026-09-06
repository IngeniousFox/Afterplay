import { Clock, Info, Power } from 'lucide-react';
import {
  useOpenAtLogin,
  useSetOpenAtLogin,
  useSetTimeFormat,
  useTimeFormat,
} from '../../hooks/settings';
import { AMBER, GREEN } from '../../lib/colors';
import { revealClass, revealStyle } from '../../lib/styles';
import { CheckboxRow } from '../library/add-game/CheckboxRow';
import type { SettingsTabId } from './SettingsModal';
import { AchievementsSettingsSection } from './AchievementsSettingsSection';
import { AmbientSection } from './AmbientSection';
import { BackupSection } from './BackupSection';
import { CredentialsSection } from './CredentialsSection';
import { EmulatorsSection } from './EmulatorsSection';
import { GameFoldersSection } from './GameFoldersSection';
import { ImagesSection } from './ImagesSection';
import { LocalSaveBackupsSection } from './LocalSaveBackupsSection';
import { MemoriesSection } from './MemoriesSection';
import { OverlaySection } from './OverlaySection';
import { ExternalDataSection } from './ExternalDataSection';
import { SavesScanSection } from './SavesScanSection';
import { SettingsCard } from './SettingsCard';
import { TimeFormatSlider } from './TimeFormatSlider';
import { TriviaSection } from './TriviaSection';

// Loaded inside the existing dialog shell. Closing a tab or the dialog still
// unmounts its controls, while the shell retains the selected tab and focus.
export const SettingsContent = ({
  tabId,
  credentialsSpotlight,
}: {
  tabId: SettingsTabId;
  credentialsSpotlight: boolean;
}): React.JSX.Element => {
  const { data: openAtLogin = false, isLoading } = useOpenAtLogin();
  const setOpenAtLogin = useSetOpenAtLogin();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const setTimeFormat = useSetTimeFormat();

  return (
    <>
      {tabId === 'general' && (
        <>
          {!isLoading && (
            <div className={revealClass} style={revealStyle(1)}>
              <CheckboxRow
                checked={openAtLogin}
                onToggle={() => setOpenAtLogin.mutate(!openAtLogin)}
                title="Start with Windows"
                description="Launch Afterplay minimized to the tray when you log in, so the watcher can catch every session — even ones that start before you open the app yourself."
                accent="green"
                icon={Power}
              />
            </div>
          )}
          <SettingsCard
            layout="row"
            title="Time format"
            description="Show times in 12-hour or 24-hour format everywhere in the app."
            icon={Clock}
            color={GREEN}
            className={revealClass}
            style={revealStyle(2)}
          >
            <TimeFormatSlider value={timeFormat} onChange={(next) => setTimeFormat.mutate(next)} />
          </SettingsCard>
          <div className={revealClass} style={revealStyle(3)}>
            <AmbientSection />
          </div>
          <div className={revealClass} style={revealStyle(4)}>
            <OverlaySection />
          </div>
        </>
      )}

      {tabId === 'connections' && (
        <>
          {credentialsSpotlight && (
            <div
              className={`flex items-center gap-1.75 rounded-[9px] px-3 py-2 text-[12px] font-semibold ${revealClass}`}
              style={{ background: 'rgba(227,178,74,.1)', color: AMBER, ...revealStyle(1) }}
            >
              <Info size={13} className="flex-none" />
              Welcome! To search games and fetch artwork, Afterplay needs your own API keys — add
              them below. Everything else already works.
            </div>
          )}
          <div className={revealClass} style={revealStyle(credentialsSpotlight ? 2 : 1)}>
            <CredentialsSection spotlight={credentialsSpotlight} />
          </div>
        </>
      )}

      {tabId === 'library' && (
        <>
          <div className={revealClass} style={revealStyle(1)}>
            <GameFoldersSection />
          </div>
          <div className={revealClass} style={revealStyle(2)}>
            <EmulatorsSection />
          </div>
          <div className={revealClass} style={revealStyle(3)}>
            <ExternalDataSection />
          </div>
        </>
      )}

      {tabId === 'saves' && (
        <>
          <div className={revealClass} style={revealStyle(1)}>
            <SavesScanSection />
          </div>
          <div className={revealClass} style={revealStyle(2)}>
            <LocalSaveBackupsSection />
          </div>
        </>
      )}

      {tabId === 'journey' && (
        <>
          <div className={revealClass} style={revealStyle(1)}>
            <MemoriesSection />
          </div>
          <div className={revealClass} style={revealStyle(2)}>
            <TriviaSection />
          </div>
          <div className={revealClass} style={revealStyle(3)}>
            <AchievementsSettingsSection />
          </div>
        </>
      )}

      {tabId === 'storage' && (
        <>
          <div className={revealClass} style={revealStyle(1)}>
            <ImagesSection />
          </div>
          <div className={revealClass} style={revealStyle(2)}>
            <BackupSection />
          </div>
        </>
      )}
    </>
  );
};
