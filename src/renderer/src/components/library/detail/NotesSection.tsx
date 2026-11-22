import { NotebookPen, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Session } from '../../../../../shared/types';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision } from '../../../lib/format';
import { notesProseClass } from '../../../lib/styles';
import { secondaryButtonClass, textLinkClass } from '../../shell/controls';
import { NotesMarkdown } from './NotesMarkdown';

type NotesSectionProps = {
  notes: string | null;
  // Abre el editor de notas. Opcional: sin él la sección es de solo lectura
  // (y no se pinta si no hay nada que mostrar).
  onEdit?: () => void;
  // 'preview' en Overview (altura limitada, "Edit" como enlace); 'full' en la
  // pestaña Notes (todo el texto y un botón de verdad).
  variant?: 'preview' | 'full';
};

// SPEC 10.7 — las notas del juego en markdown. Sin notas, en vez de
// desaparecer deja una invitación discreta a escribirlas: si la sección no
// existe nunca, no hay forma de descubrir que el juego admite notas.
export const NotesSection = ({
  notes,
  onEdit,
  variant = 'preview',
}: NotesSectionProps): React.JSX.Element | null => {
  if (!notes && !onEdit) return null;
  const full = variant === 'full';

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2
          className={
            full ? 'text-lead font-semibold text-bone' : 'text-small font-semibold text-dust'
          }
        >
          Notes
        </h2>
        {notes &&
          onEdit &&
          (full ? (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit notes"
              className={cn(secondaryButtonClass, 'h-8.5 px-3.5 text-body')}
            >
              <Pencil size={14} />
              Edit
            </button>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit notes"
              className={textLinkClass}
            >
              Edit
            </button>
          ))}
      </div>

      {notes ? (
        <div
          className={cn(
            'overflow-y-auto rounded-md border border-line bg-panel px-5 py-4',
            full ? 'px-7 py-6' : 'max-h-95',
          )}
        >
          <div className={notesProseClass}>
            <NotesMarkdown>{notes}</NotesMarkdown>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="flex w-full items-center gap-2.5 rounded-md border border-dashed border-line-strong px-5 py-4 text-left transition-colors duration-150 hover:border-line-hover hover:bg-bone/3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
        >
          <NotebookPen size={15} className="flex-none text-dust" />
          <span className="text-body text-dust">
            Add notes about this game — markdown supported.
          </span>
        </button>
      )}
    </section>
  );
};

// Las notas de sesión ("dónde lo dejé") de todas las sesiones, la más nueva
// arriba: la otra mitad de la pestaña Notes.
export const SessionNotesList = ({ sessions }: { sessions: Session[] }): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const withNotes = sessions.filter((session) => session.note);
  return (
    <section>
      <h2 className="mb-3 text-lead font-semibold text-bone">Session notes</h2>
      {withNotes.length === 0 ? (
        <p className="text-body text-dust">Notes you leave when a session ends show up here.</p>
      ) : (
        <ul className="flex flex-col">
          {withNotes.map((session) => (
            <li key={session.id} className="border-b border-line py-3 first:pt-0 last:border-b-0">
              <div className="text-small text-dust">
                {formatByPrecision(session.startedAt, session.datePrecision, timeFormat)}
              </div>
              <p className="mt-1 flex items-start gap-2 text-body text-bone">
                <NotebookPen size={14} className="mt-0.75 flex-none text-phosphor" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{session.note}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
