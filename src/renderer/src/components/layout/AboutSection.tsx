import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDevices } from '../../hooks/devices';
import { useAppVersion } from '../../hooks/settings';
import { buttonSize, secondaryButtonClass } from '../shell/controls';
import { SettingsCard } from './SettingsCard';

// Ajustes → About (estados-ajustes-about.png): qué versión corre aquí, cómo se
// llama este PC y dónde guarda Afterplay sus datos. Solo lo que la app ya
// sabe contar; el concepto añade comprobar actualizaciones y exportar un
// diagnóstico, que no existen todavía.
export const AboutSection = (): React.JSX.Element => {
  const { data: appVersion } = useAppVersion();
  const { data: devices } = useDevices();
  const thisDevice = devices?.find((device) => device.isThisDevice);

  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-4">
          <span className="flex size-14 flex-none items-center justify-center rounded-md bg-raised">
            <svg aria-hidden width="30" height="30" viewBox="0 0 26 26" fill="none">
              <rect
                x="1"
                y="3"
                width="24"
                height="18"
                rx="4"
                className="stroke-phosphor"
                strokeWidth="2"
              />
              <path d="M10.5 8.2v7.6l6.2-3.8z" className="fill-phosphor" />
              <path
                d="M8 24h10"
                className="stroke-phosphor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="flex items-baseline gap-2.5">
              <span className="font-display text-page font-bold">Afterplay</span>
              {appVersion && <span className="text-body font-normal text-dust">{appVersion}</span>}
            </span>
            <span className="text-small font-normal text-dust">
              Your games, your time, on every PC.
            </span>
          </span>
        </span>
      }
      flush
    >
      <dl className="grid grid-cols-[minmax(140px,220px)_1fr] text-body">
        <dt className="border-t border-line px-5 py-3 text-dust first-of-type:border-t-0">
          Version
        </dt>
        <dd className="border-t border-line px-5 py-3 text-bone first-of-type:border-t-0">
          {appVersion ?? '—'}
        </dd>
        <dt className="border-t border-line px-5 py-3 text-dust">This PC</dt>
        <dd className="border-t border-line px-5 py-3 text-bone">{thisDevice?.name ?? '—'}</dd>
        <dt className="flex items-center border-t border-line px-5 py-3 text-dust">Data folder</dt>
        <dd className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-2.5 text-bone">
          <span className="text-small text-dust">
            Your library database, keys, backups and cached images.
          </span>
          <button
            type="button"
            onClick={() => void window.api.settings.openDataFolder()}
            className={cn(secondaryButtonClass, buttonSize.sm)}
          >
            <FolderOpen aria-hidden size={14} />
            Open
          </button>
        </dd>
      </dl>
    </SettingsCard>
  );
};
