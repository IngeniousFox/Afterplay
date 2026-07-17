import { Folder } from 'lucide-react';
import { Controller, useFormContext } from 'react-hook-form';
import { fieldLabelClass } from './styles';

// Compartido por Add Game y Edit Game (mismo campo, dos formularios): el
// tipado solo pide el subconjunto de campos que de verdad toca, así sirve
// para AddGameFormValues y EditGameFormValues sin castear nada.
export const ExecutablePathField = (): React.JSX.Element => {
  const { control, setValue } = useFormContext<{ executablePath: string }>();

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
              className="min-w-0 flex-1 rounded-[9px] border border-input bg-white/3 px-3.25 py-2.5 font-mono text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
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
