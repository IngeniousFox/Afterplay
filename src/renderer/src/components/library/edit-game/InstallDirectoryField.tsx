import { Folder } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { fieldLabelClass, textInputClass } from '../add-game/styles';
import { formatBytes } from '../../../lib/format';
import type { EditGameFormValues } from './types';

// Mismo campo que add-game/InstallDirectoryField.tsx (input + Browse que
// calcula el tamaño en el sitio), atado a EditGameFormValues.
export const InstallDirectoryField = (): React.JSX.Element => {
  const { control, setValue, watch } = useFormContext<EditGameFormValues>();
  const [calculating, setCalculating] = useState(false);
  const sizeBytes = watch('installSizeBytes');

  const handleBrowse = async (): Promise<void> => {
    setCalculating(true);
    try {
      const result = await window.api.dialog.pickDirectory();
      if (result) {
        setValue('installDirectory', result.path);
        setValue('installSizeBytes', result.sizeBytes);
      }
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div>
      <div className={fieldLabelClass}>INSTALL DIRECTORY</div>
      <div className="flex gap-2">
        <Controller
          control={control}
          name="installDirectory"
          render={({ field }) => (
            <input
              {...field}
              placeholder="C:\Games\…"
              className={`${textInputClass} min-w-0 flex-1 font-mono text-[12.5px]`}
            />
          )}
        />
        <button
          type="button"
          onClick={handleBrowse}
          disabled={calculating}
          className="flex flex-none items-center gap-1.75 rounded-[9px] border border-input bg-white/3 px-3.5 py-2.5 text-[13px] font-semibold text-foreground hover:bg-white/6 disabled:opacity-60"
        >
          <Folder size={15} />
          <span>{calculating ? 'Calculating…' : 'Browse'}</span>
        </button>
      </div>
      {sizeBytes !== null && !calculating && (
        <div className="mt-1.25 text-[11.5px] text-muted-foreground">
          {formatBytes(sizeBytes)} on disk
        </div>
      )}
    </div>
  );
};
