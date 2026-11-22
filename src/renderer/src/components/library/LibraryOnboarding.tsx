import { Check, FolderPlus, KeyRound, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScanFolders, useSetScanFolders } from '../../hooks/scan';
import { useCredentials } from '../../hooks/settings';
import {
  buttonSize,
  primaryButtonClass,
  secondaryButtonClass,
  textLinkClass,
} from '../shell/controls';
import { useShell } from '../shell/shellContext';

// EL PRIMER ARRANQUE (estados-vacio-biblioteca.png): una biblioteca vacía no
// es un error, es el principio. Tres pasos numerados y, abajo, la salida para
// quien ya usa Afterplay en otro PC. El paso pendiente más temprano va
// resaltado; los hechos llevan un check.
//
// Cada paso hace lo que ya hacía la app en su sitio: las claves abren Ajustes
// en su sección (el mismo aviso de bienvenida del primer arranque), "Add a
// folder" es el mismo selector que Ajustes > Game folders, y Add game abre el
// alta de siempre.

type Step = {
  title: string;
  text: string;
  done: boolean;
  doneText: string;
  action: React.ReactNode;
};

export const LibraryOnboarding = (): React.JSX.Element => {
  const shell = useShell();
  const { data: credentials } = useCredentials();
  const { data: folders = [] } = useScanFolders();
  const setFolders = useSetScanFolders();
  const hasKeys = Boolean(credentials?.twitchClientId && credentials.twitchClientSecret);

  const addFolder = async (): Promise<void> => {
    const folder = await window.api.dialog.pickFolder();
    if (!folder || folders.includes(folder)) return;
    await setFolders.mutateAsync([...folders, folder]).catch(() => undefined);
  };

  const steps: Step[] = [
    {
      title: 'Add your API keys',
      text: 'To search games and fetch artwork, Afterplay needs your own IGDB and SteamGridDB keys. Everything else already works.',
      done: hasKeys,
      doneText: 'Your IGDB keys are in place.',
      action: (
        <button
          type="button"
          onClick={() => shell.openSettings({ credentials: true })}
          className={cn(hasKeys ? secondaryButtonClass : primaryButtonClass, buttonSize.md)}
        >
          <KeyRound aria-hidden size={15} />
          {hasKeys ? 'Review keys' : 'Open Integrations'}
        </button>
      ),
    },
    {
      title: 'Point at your game folders',
      text: "Afterplay scans them to find each game's folder and executable, so you do not browse for them by hand.",
      done: folders.length > 0,
      doneText: `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} to scan.`,
      action: (
        <button
          type="button"
          onClick={() => void addFolder()}
          disabled={setFolders.isPending}
          className={cn(secondaryButtonClass, buttonSize.md)}
        >
          <FolderPlus aria-hidden size={15} />
          Add a folder
        </button>
      ),
    },
    {
      title: 'Add your first game',
      text: 'Search by name, or pick one the scan already found. Time played starts counting the next time you launch it.',
      done: false,
      doneText: '',
      action: (
        <button
          type="button"
          onClick={shell.openAddGame}
          className={cn(secondaryButtonClass, buttonSize.md)}
        >
          <Plus aria-hidden size={15} />
          Add game
        </button>
      ),
    },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <div className="mx-auto flex w-full max-w-240 flex-col items-center text-center">
      <h2 className="font-display text-[64px] leading-[1.05] font-bold text-bone">
        Your library starts here
      </h2>
      <p className="mt-3 max-w-160 text-lead text-dust">
        Afterplay keeps your games, sessions and notes in one place, and times your play on its own.
        Three steps fill it.
      </p>

      <ol className="mt-9 grid w-full gap-4 text-left md:grid-cols-3">
        {steps.map((step, index) => {
          const highlighted = index === current;
          return (
            <li
              key={step.title}
              aria-current={highlighted ? 'step' : undefined}
              className={cn(
                'flex flex-col rounded-md border bg-panel p-6',
                highlighted
                  ? 'border-phosphor/70 shadow-[0_0_24px_rgb(255_179_71/0.12)]'
                  : 'border-line',
              )}
            >
              <span
                className={cn(
                  'font-display text-[44px] leading-none font-bold',
                  highlighted ? 'text-phosphor' : 'text-dust',
                )}
              >
                {step.done ? (
                  <Check aria-label="Done" size={36} className="text-success" />
                ) : (
                  index + 1
                )}
              </span>
              <h3 className="mt-4 text-lead font-semibold text-bone">{step.title}</h3>
              <p className="mt-2 flex-1 text-small text-dust">
                {step.done ? step.doneText : step.text}
              </p>
              <div className="mt-5">{step.action}</div>
            </li>
          );
        })}
      </ol>

      <p className="mt-7 text-small text-dust">
        Already use Afterplay on another PC?{' '}
        <button
          type="button"
          onClick={() => shell.openSettings({ section: 'sync' })}
          className={textLinkClass}
        >
          Join with a code
        </button>
      </p>
    </div>
  );
};
