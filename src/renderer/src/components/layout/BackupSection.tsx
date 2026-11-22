import { FolderOpen, HardDriveDownload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useCreateManualBackup } from '../../hooks/backup';
import {
  useBackupCount,
  useBackupIntervalHours,
  useSetBackupCount,
  useSetBackupIntervalHours,
} from '../../hooks/settings';
import { Dropdown } from '../library/add-game/Dropdown';
import { buttonSize, primaryButtonClass } from '../shell/controls';
import { SettingsCard, SettingsRow, StatusLine } from './SettingsCard';

// Cada cuántas HORAS toca una copia nueva. Horas concretas y no un campo
// libre, mismo criterio que AmbientSection: lo que importa es elegir entre
// "un par de veces al día", "a diario" y "semanal", no tecleable un número
// exacto que a nadie le importa de verdad. En horas y no en días para poder
// bajar de "una vez al día" — la petición que lo trajo.
const INTERVAL_OPTIONS = ['6', '12', '24', '48', '72', '168', '336'] as const;
const INTERVAL_LABELS: Record<string, string> = {
  '6': 'Every 6 hours',
  '12': 'Every 12 hours',
  '24': 'Every day',
  '48': 'Every 2 days',
  '72': 'Every 3 days',
  '168': 'Every week',
  '336': 'Every 2 weeks',
};

// Cuántas copias conservar en rotación. '0' apaga la copia automática del
// todo — mismo lenguaje que el "Never" de Ambient mode: la opción de apagar
// vive DENTRO del mismo desplegable que el resto de valores, no como un
// toggle aparte.
const COUNT_OPTIONS = ['0', '3', '5', '10', '20'] as const;
const COUNT_LABELS: Record<string, string> = {
  '0': 'Turned off',
  '3': 'Keep 3',
  '5': 'Keep 5',
  '10': 'Keep 10',
  '20': 'Keep 20',
};

// Un valor guardado que no esté entre las opciones (config.json editado a
// mano) no puede dejar el desplegable en blanco — se enseña el más cercano.
const closestOption = (options: readonly string[], value: number, fallback: string): string => {
  if (options.includes(String(value))) return String(value);
  return options.reduce(
    (closest, option) =>
      Math.abs(Number(option) - value) < Math.abs(Number(closest) - value) ? option : closest,
    fallback,
  );
};

// Copia de seguridad a demanda, en la carpeta que elija el usuario — aparte
// de la automática (dailyBackup.ts, cadencia y rotación configurables abajo):
// esta no tiene límite ni regla de "una por intervalo", es una vía de escape
// manual explícita ("quiero una copia AHORA, donde yo decida").
export const BackupSection = (): React.JSX.Element => {
  const createManualBackup = useCreateManualBackup();
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const { data: intervalHours = 24 } = useBackupIntervalHours();
  const setIntervalHours = useSetBackupIntervalHours();
  const { data: count = 5 } = useBackupCount();
  const setCount = useSetBackupCount();
  const intervalValue = closestOption(INTERVAL_OPTIONS, intervalHours, '24');
  const countValue = closestOption(COUNT_OPTIONS, count, '5');
  const backupsOff = countValue === '0';

  const handleBackupNow = async (): Promise<void> => {
    setSavedPath(null);
    const directory = await window.api.dialog.pickFolder();
    if (!directory) return;
    const filePath = await createManualBackup.mutateAsync(directory);
    setSavedPath(filePath);
  };

  return (
    <SettingsCard
      title="Data backups"
      description="Your library, sessions and stats live in one small database file. Afterplay keeps a rotating local copy automatically, on the cadence below. Back up now saves an extra one right now, wherever you want. Game save files are separate: see Saves."
      action={
        <button
          type="button"
          onClick={handleBackupNow}
          disabled={createManualBackup.isPending}
          className={cn(primaryButtonClass, buttonSize.md, 'relative overflow-hidden')}
        >
          {/* Mientras copia, un barrido de luz cruza el botón una y otra vez
              (transform, sin repintar): está trabajando. Reduced motion: sin
              barrido; queda el icono que late. */}
          {createManualBackup.isPending && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-full w-[200%] animate-[afterplay-burn_1.3s_var(--ease-in-out)_infinite_reverse] bg-linear-to-r from-transparent via-[rgb(255_244_224/0.45)] to-transparent motion-reduce:hidden"
            />
          )}
          {createManualBackup.isPending ? (
            <HardDriveDownload
              aria-hidden
              size={15}
              className="animate-pulse motion-reduce:animate-none"
            />
          ) : (
            <FolderOpen aria-hidden size={15} />
          )}
          {createManualBackup.isPending ? 'Saving…' : 'Back up now'}
        </button>
      }
      extra={
        <>
          {savedPath && (
            <StatusLine tone="info">
              <span className="font-mono font-normal break-all">Saved to {savedPath}</span>
            </StatusLine>
          )}
          {createManualBackup.isError && (
            <StatusLine tone="error">
              Couldn&apos;t create the backup: {createManualBackup.error.message}
            </StatusLine>
          )}
        </>
      }
      flush
    >
      <SettingsRow
        label="Automatic backups"
        description="How many copies to keep in rotation. Turned off stops the automatic copy."
        control={
          <div className="w-44 flex-none">
            <Dropdown
              value={countValue}
              options={[...COUNT_OPTIONS]}
              onChange={(next) => setCount.mutate(Number(next))}
              renderOption={(option) => COUNT_LABELS[option]}
            />
          </div>
        }
      />
      <SettingsRow
        label="How often"
        description="A new copy replaces the oldest one each time."
        control={
          // Sin prop `disabled` propia: Dropdown no la tiene. Con las copias
          // apagadas el intervalo no significa nada, así que basta con
          // apagarlo a la vista.
          <div
            aria-disabled={backupsOff}
            className={cn('w-44 flex-none', backupsOff && 'pointer-events-none opacity-45')}
          >
            <Dropdown
              value={intervalValue}
              options={[...INTERVAL_OPTIONS]}
              onChange={(next) => setIntervalHours.mutate(Number(next))}
              renderOption={(option) => INTERVAL_LABELS[option]}
            />
          </div>
        }
      />
    </SettingsCard>
  );
};
