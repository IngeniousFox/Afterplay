import { Cpu, FolderOpen, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useCreateEmulator, useDeleteEmulator, useEmulators } from '../../hooks/emulators';
import { accentGradientStyle, revealClass, revealStyle } from '../../lib/styles';
import { fieldLabelClass, textInputClass, textInputFocusClass } from '../library/add-game/styles';
import { SettingsCard } from './SettingsCard';

const VIOLET = '#7c86c8';

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
    <SettingsCard
      layout="column"
      title="Emulators"
      description="Watched like any game — sessions they generate land in Sessions as pending, for you to assign to the right game."
      icon={Cpu}
      color={VIOLET}
      className={revealClass}
      style={revealStyle(5)}
    >
      {emulators.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {emulators.map((emulator, index) => (
            <div
              key={emulator.id}
              className={`group/emu flex items-center gap-2.5 rounded-[9px] border border-border bg-white/[0.02] px-2.75 py-2 transition-colors duration-150 hover:border-white/15 hover:bg-white/[0.035] ${revealClass}`}
              style={revealStyle(Math.min(index, 4))}
            >
              <div
                className="flex h-7 w-7 flex-none items-center justify-center rounded-md"
                style={{ background: `${VIOLET}1a` }}
              >
                <Cpu size={13} style={{ color: VIOLET }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-foreground">
                  {emulator.name}
                </div>
                <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {emulator.executablePath}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteEmulator.mutate(emulator.id)}
                disabled={deleteEmulator.isPending}
                title="Remove emulator"
                className="flex-none rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/emu:opacity-100 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div>
          <div className={fieldLabelClass}>NAME</div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. DuckStation, RetroArch…"
            className={`${textInputClass} ${textInputFocusClass}`}
          />
        </div>
        <div>
          <div className={fieldLabelClass}>EXECUTABLE</div>
          <div className="flex gap-1.5">
            <input
              value={executablePath}
              onChange={(event) => setExecutablePath(event.target.value)}
              placeholder="Path to the emulator's .exe"
              className={`${textInputClass} ${textInputFocusClass} min-w-0 flex-1 font-mono text-[11.5px]`}
            />
            <button
              type="button"
              onClick={handleBrowse}
              title="Browse for the executable"
              className="flex flex-none items-center justify-center rounded-[9px] border border-input bg-white/[0.03] px-3 text-muted-foreground transition-colors duration-150 hover:border-primary/45 hover:text-foreground"
            >
              <FolderOpen size={15} />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className="[will-change:transform] flex w-fit items-center gap-1.75 rounded-[9px] px-3.5 py-2 text-[12.5px] font-bold transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] disabled:cursor-not-allowed disabled:opacity-50 enabled:hover:-translate-y-1 enabled:hover:shadow-[0_10px_24px_rgba(47,220,126,.32)]"
          style={accentGradientStyle}
        >
          <Plus size={14} />
          {createEmulator.isPending ? 'Adding…' : 'Add emulator'}
        </button>
        {createEmulator.isError && (
          <div className="text-[12px] text-destructive">
            Couldn&apos;t add the emulator — {createEmulator.error.message}
          </div>
        )}
      </div>
    </SettingsCard>
  );
};
