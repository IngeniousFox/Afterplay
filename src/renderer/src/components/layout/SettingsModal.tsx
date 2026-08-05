import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Clock,
  CloudUpload,
  Gamepad2,
  HardDrive,
  Info,
  KeyRound,
  Power,
  Settings2,
} from 'lucide-react';
import { useState } from 'react';
import {
  useOpenAtLogin,
  useSetOpenAtLogin,
  useSetTimeFormat,
  useTimeFormat,
} from '../../hooks/settings';
import { AMBER, BLUE, GRAY, GREEN, TEAL, VIOLET } from '../../lib/colors';
import { revealClass, revealStyle } from '../../lib/styles';
import { CheckboxRow } from '../library/add-game/CheckboxRow';
import { ModalShell } from '../ui/modal-shell';
import { AchievementsSettingsSection } from './AchievementsSettingsSection';
import { AmbientSection } from './AmbientSection';
import { BackupSection } from './BackupSection';
import { CredentialsSection } from './CredentialsSection';
import { EmulatorsSection } from './EmulatorsSection';
import { GameFoldersSection } from './GameFoldersSection';
import { ImagesSection } from './ImagesSection';
import { LocalSaveBackupsSection } from './LocalSaveBackupsSection';
import { MemoriesSection } from './MemoriesSection';
import { RatingsSection } from './RatingsSection';
import { SavesScanSection } from './SavesScanSection';
import { SettingsCard } from './SettingsCard';
import { TimeFormatSlider } from './TimeFormatSlider';
import { TriviaSection } from './TriviaSection';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Primer arranque sin credenciales de IGDB (ver NavRail): el modal se abre
  // solo, aterriza en la pestaña Connections y el grupo de IGDB nace
  // desplegado con un aviso de por qué.
  credentialsSpotlight?: boolean;
};

// Las trece tarjetas de Ajustes, repartidas en seis habitaciones. Antes
// vivían todas en una sola columna de scroll (520px de ancho, sin ninguna
// jerarquía): "Backups", "Save backups" y "Game saves" aparecían sueltas y
// revueltas entre el formato de hora y los emuladores, y había que leerse
// las trece descripciones para saber cuál era cuál. La pestaña agrupa por
// PREGUNTA ("¿cómo se comporta la app?", "¿dónde están mis partidas?"), no
// por orden de llegada de cada función.
type TabId = 'general' | 'connections' | 'library' | 'saves' | 'journey' | 'storage';

type Tab = {
  id: TabId;
  label: string;
  // La frase de cabecera del panel: qué pregunta responde esta pestaña.
  blurb: string;
  icon: LucideIcon;
  // Un color de la casa por pestaña, sin repetir: la identidad visual del
  // panel activo (chip del sidebar, lavado de la cabecera del modal).
  color: string;
};

const TABS: Tab[] = [
  {
    id: 'general',
    label: 'General',
    blurb: 'How the app behaves: startup, clock and the idle screen.',
    icon: Settings2,
    color: GREEN,
  },
  {
    id: 'connections',
    label: 'Connections',
    blurb: 'Your API keys, and the cloud sync that ties your PCs together.',
    icon: KeyRound,
    color: BLUE,
  },
  {
    id: 'library',
    label: 'Library',
    blurb: 'How games get into Afterplay and how sessions get tracked.',
    icon: Gamepad2,
    color: AMBER,
  },
  {
    id: 'saves',
    label: 'Game saves',
    blurb: 'Back up your save files to the cloud, and manage the local copies.',
    icon: CloudUpload,
    color: TEAL,
  },
  {
    id: 'journey',
    label: 'Journey',
    blurb: 'The stories Afterplay writes about your playing, and your trophies.',
    icon: BookOpen,
    color: VIOLET,
  },
  {
    id: 'storage',
    label: 'Storage',
    blurb: 'What Afterplay keeps on disk, and the safety copies of your data.',
    icon: HardDrive,
    color: GRAY,
  },
];

// SPEC 3E — el modal de Ajustes. Sidebar de pestañas a la izquierda, panel
// scrollable a la derecha; el cuerpo tiene ALTURA FIJA a propósito, para que
// cambiar de pestaña no haga bailar el tamaño del modal (cada panel tiene un
// alto distinto y sin esto el modal crecía y encogía con cada clic).
export const SettingsModal = ({
  open,
  onOpenChange,
  credentialsSpotlight = false,
}: SettingsModalProps): React.JSX.Element => {
  const { data: openAtLogin = false, isLoading } = useOpenAtLogin();
  const setOpenAtLogin = useSetOpenAtLogin();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const setTimeFormat = useSetTimeFormat();

  // Radix desmonta el contenido al cerrar, así que esto se re-evalúa en cada
  // apertura: normalmente General, y Connections si venimos del primer
  // arranque sin claves.
  const [tabId, setTabId] = useState<TabId>(credentialsSpotlight ? 'connections' : 'general');
  const tab = TABS.find((candidate) => candidate.id === tabId) ?? TABS[0];

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      title="Settings"
      icon={Settings2}
      // La cabecera respira el color de la pestaña activa — la misma
      // identidad que el chip del sidebar, extendida al marco del modal.
      color={tab.color}
      widthClass="w-190"
      // Altura FIJA en píxeles, no en vh ni derivada del contenido: la misma
      // en cualquier pantalla y en cualquier pestaña — lo que sobre queda en
      // aire y lo que no quepa hace scroll en el panel derecho. OJO con
      // añadir flex-1 aquí: su flex-basis 0 ANULA la altura dentro del
      // flex-col del ModalShell y el modal vuelve a medirse por contenido,
      // saltando de tamaño entre pestañas (bug real de la primera versión).
      // El max-h es solo la red de seguridad para ventanas más bajas que el
      // propio modal.
      bodyClassName="flex h-160 max-h-[80vh] overflow-hidden"
    >
      {/* ── Sidebar de pestañas ── */}
      <div className="flex w-44 flex-none flex-col gap-1 overflow-y-auto border-r border-border px-2.5 py-3">
        {TABS.map((candidate) => {
          const active = candidate.id === tabId;
          const Icon = candidate.icon;
          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setTabId(candidate.id)}
              className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-150 ${
                active ? '' : 'hover:bg-white/[0.04]'
              }`}
              style={active ? { background: `${candidate.color}14` } : undefined}
            >
              <span
                className="flex h-7 w-7 flex-none items-center justify-center rounded-[8px] transition-colors duration-150"
                style={{
                  background: active ? `${candidate.color}24` : 'rgba(255,255,255,.05)',
                }}
              >
                <Icon
                  size={14}
                  style={{ color: active ? candidate.color : 'var(--muted-foreground)' }}
                />
              </span>
              <span
                className={`text-[12.5px] font-semibold ${
                  active ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {candidate.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Panel de la pestaña activa ──
          key={tabId}: cambiar de pestaña remonta el panel entero, y con él
          la entrada escalonada de sus tarjetas (los índices de reveal son
          POR PANEL, 0..n, no los trece de la lista antigua). */}
      <div key={tabId} className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-4.5">
        <div className={revealClass} style={revealStyle(0)}>
          <div className="flex items-center gap-2">
            <div className="text-[15px] font-extrabold tracking-[-.01em] text-foreground">
              {tab.label}
            </div>
            <div className="h-px flex-1 bg-white/5" />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">{tab.blurb}</div>
        </div>

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
              <TimeFormatSlider
                value={timeFormat}
                onChange={(next) => setTimeFormat.mutate(next)}
              />
            </SettingsCard>
            <div className={revealClass} style={revealStyle(3)}>
              <AmbientSection />
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
              <RatingsSection />
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
      </div>
    </ModalShell>
  );
};
