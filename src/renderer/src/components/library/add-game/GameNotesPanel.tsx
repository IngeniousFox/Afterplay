import { Controller, useFormContext } from 'react-hook-form';
import { Textarea } from '../../ui/textarea';
import { textInputClass } from './styles';
import type { AddGameFormValues } from './types';

// Panel del desplegable "Add notes" — mismo contenedor que PlayedBeforePanel
// (border-input, bg-white/[0.02], p-3.5), reutilizado tal cual para
// mantener la misma familia visual de "toggle + panel" que playedBefore/
// endless ya usan en este modal.
export const GameNotesPanel = (): React.JSX.Element => {
  const { control } = useFormContext<AddGameFormValues>();

  return (
    <div className="rounded-[11px] border border-input bg-white/[0.02] p-3.5">
      <Controller
        control={control}
        name="gameNotes"
        render={({ field }) => (
          <Textarea
            {...field}
            placeholder="Markdown supported…"
            className={`${textInputClass} min-h-24 font-mono`}
          />
        )}
      />
    </div>
  );
};
