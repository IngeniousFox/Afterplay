import { NotebookPen, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { notesProseClass } from '../../../lib/styles';

type NotesSectionProps = {
  notes: string | null;
  // Abre el editor de notas. Opcional: sin él la sección es de solo lectura
  // y se comporta como antes (no se pinta si no hay nada que mostrar).
  onEdit?: () => void;
};

// SPEC 10.7 / prototipo — sección "Notes" en markdown. Rediseño: el lápiz
// aparece al pasar el ratón (antes había que abrir el modal de Edit Game
// entero para tocar una nota) y, sin notas, en vez de desaparecer del todo
// deja una invitación discreta a escribirlas — si la sección no existe
// nunca, no hay forma de descubrir que el juego admite notas.
export const NotesSection = ({ notes, onEdit }: NotesSectionProps): React.JSX.Element | null => {
  if (!notes && !onEdit) return null;

  return (
    <div className="group/notes mt-7.5">
      <div className="mb-3.25 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-[.13em] text-muted-foreground">NOTES</span>
        {notes && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label="Edit notes"
            className="rounded-md p-1 text-muted-foreground opacity-0 group-hover/notes:opacity-100 hover:bg-white/6 hover:text-foreground"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>

      {notes ? (
        <div className="max-h-95 overflow-y-auto rounded-[14px] border border-border bg-card px-6 py-5">
          <div className={notesProseClass}>
            <ReactMarkdown>{notes}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="flex w-full items-center gap-2.5 rounded-[14px] border border-dashed border-input bg-white/[0.015] px-6 py-4.5 text-left hover:border-input/80 hover:bg-white/[0.03]"
        >
          <NotebookPen size={15} className="flex-none text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">
            Add notes about this game — markdown supported.
          </span>
        </button>
      )}
    </div>
  );
};
