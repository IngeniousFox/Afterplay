import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Gamepad2,
  Info,
  KeyRound,
  Library,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Trophy,
} from 'lucide-react';

// Las nueve secciones de la página de Ajustes (Fósforo, decisión 4), en el
// orden del índice lateral. La sección vive en la URL (/settings/<id>) para
// que el LED de sync, los avisos de claves y la paleta puedan abrir una
// concreta, y para que volver atrás devuelva a la misma.
//
// Reparto respecto a las seis pestañas del modal antiguo: Images pasa de
// Storage a Library; Emulators sale de Library; Connections se parte en
// Integrations (claves) y Sync; Journey se llama Achievements; los Data
// backups de Storage son Backups; y About es nuevo (versión, PC, carpeta).
export type SettingsSectionId =
  | 'general'
  | 'library'
  | 'emulators'
  | 'saves'
  | 'integrations'
  | 'sync'
  | 'achievements'
  | 'backups'
  | 'about';

export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  // La frase junto al título: qué pregunta responde la sección.
  blurb: string;
  icon: LucideIcon;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'general',
    label: 'General',
    blurb: 'How the app behaves: startup, clock, the idle screen and the overlay.',
    icon: SlidersHorizontal,
  },
  {
    id: 'library',
    label: 'Library',
    blurb: 'How games get into Afterplay, and the images and data they carry.',
    icon: Library,
  },
  {
    id: 'emulators',
    label: 'Emulators',
    blurb: 'Programs Afterplay times as games of their own.',
    icon: Gamepad2,
  },
  {
    id: 'saves',
    label: 'Saves',
    blurb: 'Back up your save files to the cloud, and manage the local copies.',
    icon: Save,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    blurb: 'Your API keys, and the services Afterplay talks to.',
    icon: KeyRound,
  },
  {
    id: 'sync',
    label: 'Sync',
    blurb: 'Keep your library, sessions and plan the same on every device.',
    icon: RefreshCw,
  },
  {
    id: 'achievements',
    label: 'Achievements',
    blurb: 'Your trophies, and the stories Afterplay writes about your playing.',
    icon: Trophy,
  },
  {
    id: 'backups',
    label: 'Backups',
    blurb: 'Safety copies of your library database.',
    icon: Archive,
  },
  {
    id: 'about',
    label: 'About',
    blurb: 'What this PC runs, and where Afterplay keeps its data.',
    icon: Info,
  },
];

export const isSettingsSection = (value: string | undefined): value is SettingsSectionId =>
  SETTINGS_SECTIONS.some((section) => section.id === value);

export const settingsPath = (section: SettingsSectionId = 'general'): string =>
  `/settings/${section}`;

// El estado de navegación con el que se abre Integrations en el primer
// arranque sin claves: aviso de bienvenida y el grupo de IGDB desplegado.
export type SettingsLocationState = { credentialsSpotlight?: boolean } | null;
