import { FolderOpen, Gamepad2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useCreateEmulator, useDeleteEmulator, useEmulators } from '../../hooks/emulators';
import { usePendingSessions } from '../../hooks/sessions';
import { fieldLabelClass, textInputClass } from '../library/add-game/styles';
import {
  buttonSize,
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../shell/controls';
import { SettingsCard, StatusLine } from './SettingsCard';

// EMULADORES.md §8 — "UI sencilla para registrar un emulador (nombre + ruta
// del .exe)", viviendo en Ajustes. El watcher los vigila con el mismo
// barrido que los juegos nativos; al detectar uno, la sesión cae en la
// bandeja Pending de la vista de Sesiones.
export const EmulatorsSection = (): React.JSX.Element => {
  const { data: emulators = [] } = useEmulators();
  const createEmulator = useCreateEmulator();
  const deleteEmulator = useDeleteEmulator();
  const [name, setName] = useState('');
  const [executablePath, setExecutablePath] = useState('');

  const canAdd = name.trim() !== '' && executablePath.trim() !== '' && !createEmulator.isPending;

  const handleBrowse = async (): Promise<void> => {
    const path = await window.api.dialog.pickExecutable();
    if (path) setExecutablePath(path);
  };

  const handleAdd = async (): Promise<void> => {
    if (!canAdd) return;
    await createEmulator.mutateAsync({
      name: name.trim(),
      executablePath: executablePath.trim(),
    });
    setName('');
    setExecutablePath('');
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <SettingsCard
        title="Emulators"
        description="Add your emulators and Afterplay watches them like any other game. Time played in one lands in Sessions as pending, for you to assign to the right game. The path is this PC's."
        extra={
          // El borrado no se miraba en ningún sitio: si el DELETE se rechaza
          // (un fallo de IPC), la fila sigue donde estaba, idéntico a no
          // haber pulsado. Quitar algo tiene la obligación de decir que no
          // se hizo.
          deleteEmulator.isError && (
            <StatusLine tone="error">
              Couldn&apos;t remove the emulator: {deleteEmulator.error.message}
            </StatusLine>
          )
        }
        flush
      >
        {emulators.length === 0 ? (
          <div className="px-5 py-4 text-small text-dust">
            No emulators yet. Add the first one with the form.
          </div>
        ) : (
          <ul>
            {emulators.map((emulator) => (
              <li
                key={emulator.id}
                className="flex items-center gap-3.5 border-t border-line px-5 py-3 first:border-t-0"
              >
                <span className="flex size-9 flex-none items-center justify-center rounded-sm bg-raised text-phosphor">
                  <Gamepad2 aria-hidden size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-body font-semibold text-bone">{emulator.name}</div>
                  <div className="font-mono text-micro break-all text-dust">
                    {emulator.executablePath}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteEmulator.mutate(emulator.id)}
                  disabled={deleteEmulator.isPending}
                  aria-label={`Remove ${emulator.name}`}
                  title="Remove emulator"
                  className={cn(iconButtonClass, 'hover:text-live')}
                >
                  <X aria-hidden size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <div className="flex min-w-0 flex-col gap-5">
        <SettingsCard title="Add emulator" description="Pick the program that launches your games.">
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              handleAdd().catch(() => undefined);
            }}
          >
            <label className="block">
              <div className={fieldLabelClass}>Name</div>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. DuckStation, RetroArch…"
                className={textInputClass}
              />
            </label>
            <div>
              <label htmlFor="settings-emulator-path" className={cn(fieldLabelClass, 'block')}>
                Executable
              </label>
              <div className="flex gap-2">
                <input
                  id="settings-emulator-path"
                  value={executablePath}
                  onChange={(event) => setExecutablePath(event.target.value)}
                  placeholder="Path to the emulator's .exe"
                  className={cn(textInputClass, 'min-w-0 flex-1 font-mono')}
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className={cn(secondaryButtonClass, buttonSize.md, 'h-auto')}
                >
                  <FolderOpen aria-hidden size={15} />
                  Browse
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={!canAdd}
              className={cn(primaryButtonClass, buttonSize.md, 'self-start')}
            >
              <Plus aria-hidden size={15} />
              {createEmulator.isPending ? 'Adding…' : 'Add emulator'}
            </button>
            {createEmulator.isError && (
              <div className="text-small text-live">
                Couldn&apos;t add the emulator: {createEmulator.error.message}
              </div>
            )}
          </form>
        </SettingsCard>
        <PendingSessionsNotice />
      </div>
    </div>
  );
};

// Las sesiones de emulador que esperan juego (también de otros PCs): el
// mismo recuento que la cifra ámbar de la pestaña Sessions, con el acceso.
const PendingSessionsNotice = (): React.JSX.Element | null => {
  const { data: pending = [] } = usePendingSessions();
  if (pending.length === 0) return null;
  return (
    <SettingsCard
      tone="notice"
      title={`${pending.length} ${pending.length === 1 ? 'session' : 'sessions'} waiting`}
      description="Emulator time with no game yet. Assign each one to the game you played."
      action={
        <Link to="/sessions" className={cn(secondaryButtonClass, buttonSize.md)}>
          Open Sessions
        </Link>
      }
    />
  );
};
