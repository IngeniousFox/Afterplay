import { Check, NotebookPen, X } from 'lucide-react';
import { useState } from 'react';
import { useSetSessionNote } from '../../hooks/sessions';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { focusRing, iconButtonClass } from '../shell/controls';
import type { SessionId } from '../../../../shared/entityIds';

type SessionNoteProps = {
  sessionId: SessionId;
  note: string | null;
};

// El diario de una sesión ("dónde lo dejé"), en su sitio de verdad: la propia
// fila de la sesión. El aviso al cerrar el juego solo es un ATAJO para
// escribirlo en caliente — aquí se puede añadir, corregir o borrar siempre,
// aunque el aviso ya se haya ido o nunca lo hayas visto.
//
// Compartido por las dos listas de sesiones (la ficha del juego y la vista
// global) para que escribir una nota se haga igual en los dos sitios.
//
// El botón de editar se ve SIEMPRE, no al pasar el ratón: una afordancia que
// solo aparece en hover no existe para quien no sabe que está ahí. Y la
// edición se confirma con botones explícitos (✓/✕), no solo con Enter o
// perdiendo el foco — mismo criterio que el editor del History de estados.
export const SessionNote = ({ sessionId, note }: SessionNoteProps): React.JSX.Element => {
  const setSessionNote = useSetSessionNote();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? '');

  const save = async (): Promise<void> => {
    if ((draft.trim() || null) === note) {
      setEditing(false);
      return;
    }
    // Antes esto cerraba el editor ANTES de que la mutación ni empezara: un
    // fallo (DB en pleno swap, IPC caído) hacía que el input desapareciera y
    // la fila volviera a la nota vieja del prop — lo que acababas de
    // escribir se perdía sin un solo indicio. Ahora el editor se queda
    // abierto con el borrador intacto hasta que se confirme de verdad.
    try {
      await setSessionNote.mutateAsync({ id: sessionId, note: draft });
    } catch (error) {
      console.error('[sessions] fallo guardando la nota:', error);
      toast.error('Could not save the note — try again.');
      return;
    }
    setEditing(false);
  };

  const cancel = (): void => {
    setDraft(note ?? '');
    setEditing(false);
  };

  // El borrador se siembra al ABRIR el editor, no solo al montar. El prop
  // `note` cambia bajo una fila YA montada: escribir la nota desde el aviso de
  // cierre o desde el HUD del overlay invalida ['sessions'] y la fila se
  // repinta sin remontarse (las listas la keyean por session.id). Con el
  // borrador congelado en el '' del montaje, pulsar el lapicero para releer la
  // nota abría el input VACÍO y confirmar mandaba '' -> updateSessionNote lo
  // guardaba como null: la nota recién escrita se BORRABA. Sembrar aquí cura
  // a los tres consumidores (SessionRow, SessionHistoryList y el HUD) sin
  // tirar un borrador a medias, que es lo que sí hace remontar por key.
  const startEditing = (): void => {
    setDraft(note ?? '');
    setEditing(true);
  };

  if (editing) {
    return (
      <div className="mt-1.5 flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save();
            if (event.key === 'Escape') cancel();
          }}
          placeholder="Where did you leave off?"
          aria-label="Session note"
          className="h-8 min-w-0 flex-1 rounded-sm border border-edge bg-inset px-2.5 text-small text-bone outline-none placeholder:text-dust focus:border-phosphor focus:shadow-focus-field"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={setSessionNote.isPending}
          className={cn(iconButtonClass, 'size-8 text-phosphor hover:text-phosphor-hi')}
          aria-label="Save note"
        >
          <Check aria-hidden size={15} />
        </button>
        <button
          type="button"
          onClick={cancel}
          className={cn(iconButtonClass, 'size-8')}
          aria-label="Cancel"
        >
          <X aria-hidden size={15} />
        </button>
      </div>
    );
  }

  if (note) {
    return (
      // w-fit y no w-full: con el ancho completo, el lapicero se iba al
      // extremo derecho de la fila y quedaba flotando lejísimos del texto.
      // Pegado al final de la nota se lee como lo que es — el gesto de editar
      // ESA nota. La nota envuelve entera: es lo que escribiste.
      <button
        type="button"
        onClick={startEditing}
        title="Edit note"
        className={cn(
          'mt-1.5 flex w-fit max-w-full items-start gap-1.5 rounded-xs border-l-2 border-phosphor/50 pl-2.5 text-left text-small text-bone hover:text-bone/80',
          focusRing,
        )}
      >
        <span className="min-w-0">{note}</span>
        <NotebookPen aria-hidden size={12} className="mt-0.75 flex-none text-dust" />
      </button>
    );
  }

  // Pastilla con borde y su color, no un texto gris suelto: escribir "dónde
  // lo dejé" es LA función de esta fila, y sin color no se adivinaba que
  // existiera. Phosphor como el resto de "pendientes" de la app, en tinte
  // suave para que invite sin competir con el título del juego.
  return (
    <button
      type="button"
      onClick={startEditing}
      className={cn(
        'mt-1.5 flex h-7 w-fit items-center gap-1.5 rounded-sm border border-phosphor/30 bg-phosphor-tint px-2 text-micro font-semibold text-phosphor',
        'transition-[background-color,border-color] duration-150 ease-out hover:border-phosphor/55 hover:bg-phosphor/16',
        focusRing,
      )}
    >
      <NotebookPen aria-hidden size={13} />
      Add a note
    </button>
  );
};
