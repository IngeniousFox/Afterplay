import ReactMarkdown from 'react-markdown';

type NotesSectionProps = {
  notes: string | null;
};

// SPEC 10.7 / prototipo — sección "Notes" solo si el juego tiene notas
// (no hay ningún toggle de visibilidad, simplemente no se pinta si no hay
// nada que mostrar). Markdown vía react-markdown + prose de Tailwind.
export const NotesSection = ({ notes }: NotesSectionProps): React.JSX.Element | null => {
  if (!notes) return null;

  return (
    <div className="mt-7.5">
      <div className="mb-3.25 text-[11px] font-bold tracking-[.13em] text-muted-foreground">
        NOTES
      </div>
      <div className="max-h-95 overflow-y-auto rounded-[14px] border border-border bg-card px-6 py-5">
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{notes}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};
