import { Controller, useFormContext } from 'react-hook-form';
import { NotesEditor } from '../detail/NotesEditor';
import type { AddGameFormValues } from './types';

// Panel del desplegable "Add notes" — mismo editor rico que el resto de
// notas del juego (el modal dedicado y Edit Game), en versión compacta. Se
// lee `field.value` al montar: en el alta el campo arranca vacío y solo lo
// cambia el propio editor, así que remontar el panel (togglear "Add notes")
// conserva lo ya escrito.
export const GameNotesPanel = (): React.JSX.Element => {
  const { control } = useFormContext<AddGameFormValues>();

  return (
    <Controller
      control={control}
      name="gameNotes"
      render={({ field }) => (
        <NotesEditor value={field.value} onChange={field.onChange} minHeightClass="min-h-32" />
      )}
    />
  );
};
