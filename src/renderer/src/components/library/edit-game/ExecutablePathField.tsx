import { Folder } from 'lucide-react';
import { Controller, useFormContext } from 'react-hook-form';
import { fieldLabelClass, textInputClass } from '../add-game/styles';
import type { EditGameFormValues } from './types';

// Mismo campo que add-game/ExecutablePathField.tsx (input + Browse que abre
// el picker nativo de fichero), pero atado a EditGameFormValues — el campo
// que hacía falta editar aquí era el ejecutable, no el install directory.
export const ExecutablePathField = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<EditGameFormValues>();

  const handleBrowse = async (): Promise<void> => {
    const path = await window.api.dialog.pickExecutable();
    if (path) setValue('executablePath', path);
  };

  return (
    <div>
      <div className={fieldLabelClass}>
        EXECUTABLE PATH <span className="font-medium tracking-normal normal-case">· optional</span>
      </div>
      <div className="flex gap-2">
        <Controller
          control={control}
          name="executablePath"
          render={({ field }) => (
            <input
              {...field}
              placeholder="C:\Games\…\game.exe"
              className={`${textInputClass} min-w-0 flex-1 font-mono text-[12.5px]`}
            />
          )}
        />
        <button
          type="button"
          onClick={handleBrowse}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/3 px-3.5 py-2.5 text-[13px] font-semibold text-foreground hover:bg-white/6"
        >
          <Folder size={15} />
          <span>Browse</span>
        </button>
      </div>
    </div>
  );
};
