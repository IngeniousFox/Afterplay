import { Check, NotebookPen, X } from 'lucide-react';
import { useState } from 'react';
import { useSetSessionNote } from '../../hooks/sessions';
import { AMBER } from '../../lib/colors';

type SessionNoteProps = {
  sessionId: number;
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
    setEditing(false);
    if ((draft.trim() || null) === note) return;
    await setSessionNote.mutateAsync({ id: sessionId, note: draft });
  };

  const cancel = (): void => {
    setDraft(note ?? '');
    setEditing(false);
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
          className="min-w-0 flex-1 rounded-md border border-input bg-white/[0.03] px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary/45"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={setSessionNote.isPending}
          className="flex-none rounded-md p-1.5 text-primary hover:bg-primary/10 disabled:opacity-50"
          aria-label="Save note"
        >
          <Check size={13} />
        </button>
        <button
          type="button"
          onClick={cancel}
          className="flex-none rounded-md p-1.5 text-muted-foreground hover:bg-white/6"
          aria-label="Cancel"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  if (note) {
    return (
      // w-fit y no w-full: con el ancho completo, el lapicero se iba al
      // extremo derecho de la fila y quedaba flotando lejísimos del texto,
      // como si fuera de otra cosa. Pegado al final de la nota se lee como lo
      // que es — el gesto de editar ESA nota. max-w-full para que una nota
      // larga siga cortando bien.
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Edit note"
        className="mt-1.5 flex w-fit max-w-full items-start gap-1.5 border-l-2 pl-2.5 text-left text-[12.5px] text-[#b7bdb8] hover:text-foreground"
        style={{ borderColor: `${AMBER}55` }}
      >
        <span className="min-w-0">{note}</span>
        <NotebookPen size={11} className="mt-0.75 flex-none opacity-45" />
      </button>
    );
  }

  // Pastilla con borde y su color, no un texto gris suelto: escribir "dónde
  // lo dejé" es LA función de esta fila, y en gris al 70% no se veía ni se
  // adivinaba que existiera. Ámbar como el resto de "pendientes" de la app
  // (rachas, gasto, sesiones sin asignar) y en reposo apagado, para que
  // invite sin competir con el título del juego.
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="mt-1.5 flex w-fit items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[11.5px] font-semibold transition-colors duration-150"
      style={{ borderColor: `${AMBER}40`, background: `${AMBER}12`, color: AMBER }}
    >
      <NotebookPen size={12} />
      Add a note
    </button>
  );
};
