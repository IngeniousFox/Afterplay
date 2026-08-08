import { FolderOpen, HardDriveDownload } from 'lucide-react';
import { useState } from 'react';
import { useCreateManualBackup } from '../../hooks/backup';
import {
  useBackupCount,
  useBackupIntervalHours,
  useSetBackupCount,
  useSetBackupIntervalHours,
} from '../../hooks/settings';
import { Dropdown } from '../library/add-game/Dropdown';
import { SettingsCard } from './SettingsCard';
import { TEAL } from '../../lib/colors';

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
    // 'column' y no 'row' como antes — con el intervalo y la rotación ahora
    // elegibles, el botón manual solo ya no basta para llenar la fila de la
    // derecha del layout viejo, y dos desplegables más ahí habrían quedado
    // apretados contra el título. El botón manual se queda en headerRight,
    // que es justo donde vive el gesto equivalente en Emulators/Game saves —
    // sigue siendo LA acción principal de la card, arriba y a la vista.
    <SettingsCard
      layout="column"
      title="Data backups"
      description="Your library, sessions and stats live in one small database file. Afterplay keeps a rotating local copy automatically, on the cadence below — this button saves an extra one right now, wherever you want. Game save files are separate — see the Game saves tab."
      icon={HardDriveDownload}
      color={TEAL}
      headerRight={
        <button
          type="button"
          onClick={handleBackupNow}
          disabled={createManualBackup.isPending}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/[0.03] px-3.25 py-2 text-[12.5px] font-semibold text-foreground transition-colors duration-150 hover:border-primary/45 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createManualBackup.isPending ? (
            <HardDriveDownload size={14} className="animate-pulse" />
          ) : (
            <FolderOpen size={14} />
          )}
          {createManualBackup.isPending ? 'Saving…' : 'Back up now'}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-white/5 pt-2.75">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Automatic backups</span>
          {/* Sin prop `disabled` propia: Dropdown no la tiene y no vale la
              pena sumarla al componente compartido por un solo caso — con
              backups apagados, el intervalo simplemente no significa nada,
              así que aquí basta con apagarlo VISUALMENTE.
              openDirection="up": esta card vive cerca del final de un modal
              que scrollea, y hacia abajo se sale de él — mismo criterio fijo
              a mano que AmbientSection/PlaythroughDatesHoursStatus con sus
              propios dropdowns. */}
          <div className={`w-33 flex-none ${backupsOff ? 'pointer-events-none opacity-45' : ''}`}>
            <Dropdown
              value={intervalValue}
              options={[...INTERVAL_OPTIONS]}
              onChange={(next) => setIntervalHours.mutate(Number(next))}
              renderOption={(option) => INTERVAL_LABELS[option]}
              openDirection="up"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Sin su propia etiqueta ("Keep"): el desplegable de al lado ya la
              trae en cada opción ("Keep 5", "Turned off") — repetirla aquí
              sería la misma palabra dos veces seguidas. */}
          <div className="w-28.5 flex-none">
            <Dropdown
              value={countValue}
              options={[...COUNT_OPTIONS]}
              onChange={(next) => setCount.mutate(Number(next))}
              renderOption={(option) => COUNT_LABELS[option]}
              openDirection="up"
            />
          </div>
        </div>
      </div>

      {savedPath && (
        <div className="truncate font-mono text-[10.5px] text-primary" title={savedPath}>
          Saved to {savedPath}
        </div>
      )}
      {createManualBackup.isError && (
        <div className="text-[11px] text-destructive">
          Couldn&apos;t create the backup — {createManualBackup.error.message}
        </div>
      )}
    </SettingsCard>
  );
};
