import { MessageSquareQuote, NotebookPen } from 'lucide-react';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { EventDatePrecision, GameDetail, TimeFormat } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision } from '../../lib/format';
import { allSessions } from '../../lib/sessions';
import { notesProseClass } from '../../lib/styles';
import { useTvFocusable } from '../focusContext';
import { tvRevealClass, tvRevealStyle } from '../styles';

// Las notas completas del juego en el sofá, SOLO lectura: arriba las notas
// del juego (el NotesSection de escritorio, markdown incluido) y debajo el
// diario — las notas de sesión que el toast fue recogiendo al cerrar cada
// partida. Escribir y corregir es tarea de escritorio; aquí solo se relee,
// que es para lo que se escribieron.

// Una entrada del diario: fecha en pequeño y la nota en italic con la barra
// ámbar de las notas de sesión (el mismo lenguaje que SessionRowTv usa para
// sus notas). Enfocable sin onSelect — el stick la recorre y la lista hace
// scroll, el motor silencia A. La luz del foco vive DENTRO (fondo suave +
// anillo interior): la lista recorta y un anillo exterior se decapitaría.
const NoteRowTv = ({
  when,
  datePrecision,
  note,
  timeFormat,
  index,
}: {
  when: Date;
  datePrecision: EventDatePrecision;
  note: string;
  timeFormat: TimeFormat;
  index: number;
}): React.JSX.Element => {
  const { ref, focused } = useTvFocusable({});
  return (
    <div
      ref={ref}
      className={`rounded-[0.45em] px-[0.6em] py-[0.5em] transition-[background-color,box-shadow] duration-150 ${tvRevealClass}`}
      style={{
        ...tvRevealStyle(index),
        ...(focused
          ? {
              background: 'rgba(227,178,74,.08)',
              boxShadow: 'inset 0 0 0 1px rgba(227,178,74,.30)',
            }
          : undefined),
      }}
    >
      <div className="text-[0.58em] font-bold text-muted-foreground tabular-nums">
        {formatByPrecision(when, datePrecision, timeFormat)}
      </div>
      <div
        className="mt-[0.25em] border-l-[0.14em] pl-[0.55em] text-[0.68em] leading-snug text-white/80 italic"
        style={{ borderColor: '#e3b24a55' }}
      >
        “{note}”
      </div>
    </div>
  );
};

export const TvDetailNotes = ({ game }: { game: GameDetail }): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();

  const gameNotes = game.notes?.trim() ? game.notes.trim() : null;

  // El diario, de nuevo a viejo: toda sesión con nota, venga de la vuelta
  // que venga — el "dónde lo dejé" no entiende de playthroughs.
  const sessionNotes = useMemo(
    () => allSessions(game).filter((session) => (session.note?.trim().length ?? 0) > 0),
    [game],
  );

  return (
    // Las dos secciones se reparten el alto a partes iguales; si el diario
    // no existe, las notas del juego respiran con toda la columna (y al
    // revés: sin notas de juego, la caja vacía es flex-none y cede el resto).
    <div className="flex h-full min-h-0 flex-col gap-[1em]">
      {gameNotes ? (
        <div
          className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[0.6em] border border-white/[0.08] bg-black/70 ${tvRevealClass}`}
          style={{ ...tvRevealStyle(0), boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
        >
          {/* El aliento violeta y el lomo del cuaderno: las notas son
              memoria, y la memoria en esta casa es violeta — el mismo
              lenguaje que el panel WHERE YOU LEFT OFF de la ficha. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 170% at 0% 0%, rgba(124,134,200,.14), transparent 55%)',
            }}
          />
          <span
            aria-hidden
            className="afterplay-tv-glow absolute inset-y-0 left-0 w-[0.18em]"
            style={{
              background: 'linear-gradient(180deg, #7c86c8, #7c86c826)',
              boxShadow: '0 0 0.8em rgba(124,134,200,.55)',
            }}
          />
          {/* Las comillas de agua, medio recortadas a propósito — filigrana
              heredada del panel de la ficha, no rótulo. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -top-[0.12em] right-[0.3em] text-[2.3em] leading-none font-extrabold text-[#7c86c8]/15"
          >
            ”
          </span>
          <div className="relative flex flex-none items-center gap-[0.5em] border-b border-white/[0.07] px-[1em] py-[0.6em]">
            <NotebookPen
              className="h-[0.95em] w-[0.95em] flex-none text-[#7c86c8]"
              style={{ filter: 'drop-shadow(0 0 0.45em rgba(124,134,200,.55))' }}
            />
            <span className="text-[0.55em] font-extrabold tracking-[.18em] text-muted-foreground">
              YOUR NOTES
            </span>
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-y-auto px-[1em] py-[0.7em]"
            style={{ scrollbarWidth: 'none' }}
          >
            {/* El mismo prose que NotesSection en escritorio, pero re-anclado
                a la escala del sofá: prose-sm fija su tamaño en rem (raíz del
                documento) y se saltaría la cascada em del shell TV — el
                fontSize inline lo devuelve al redil y los hijos (em sobre em)
                escalan solos. */}
            <div className={notesProseClass} style={{ fontSize: '0.75em' }}>
              <ReactMarkdown>{gameNotes}</ReactMarkdown>
            </div>
          </div>
          {/* La lista se funde contra el borde: pista de que hay más abajo. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[1em] rounded-b-[0.6em] bg-gradient-to-t from-black/60 to-transparent"
          />
        </div>
      ) : (
        // Vacío honesto: la sección existe (que se sepa que el juego admite
        // notas) pero no finge contenido — y dice claro dónde se escriben.
        <div
          className={`flex flex-none items-center gap-[0.6em] rounded-[0.6em] border border-dashed border-white/[0.14] bg-white/[0.02] px-[1em] py-[0.8em] ${tvRevealClass}`}
          style={tvRevealStyle(0)}
        >
          <NotebookPen className="h-[1em] w-[1em] flex-none text-muted-foreground" />
          <span className="text-[0.7em] font-semibold text-muted-foreground">
            No game notes yet — write them from your desk.
          </span>
        </div>
      )}

      {sessionNotes.length > 0 && (
        <div
          className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[0.6em] border border-white/[0.08] bg-black/70 ${tvRevealClass}`}
          style={{ ...tvRevealStyle(1), boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08)' }}
        >
          {/* Aliento ámbar en la esquina: el color de las notas de sesión. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 130% at 100% 0%, rgba(227,178,74,.10), transparent 55%)',
            }}
          />
          <div className="relative flex flex-none items-center gap-[0.5em] border-b border-white/[0.07] px-[1em] py-[0.6em]">
            <MessageSquareQuote
              className="h-[0.95em] w-[0.95em] flex-none text-[#e3b24a]"
              style={{ filter: 'drop-shadow(0 0 0.45em rgba(227,178,74,.5))' }}
            />
            <span className="text-[0.55em] font-extrabold tracking-[.18em] text-muted-foreground">
              SESSION NOTES
            </span>
            <span className="ml-auto rounded-full bg-white/[0.06] px-[0.6em] py-[0.12em] text-[0.5em] font-bold text-[#e3b24a] tabular-nums shadow-[inset_0_0_0_1px_rgba(255,255,255,.10)]">
              {sessionNotes.length}
            </span>
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-y-auto px-[0.6em] py-[0.45em]"
            style={{ scrollbarWidth: 'none' }}
          >
            {sessionNotes.map((session, index) => (
              <NoteRowTv
                key={session.id}
                when={session.startedAt}
                datePrecision={session.datePrecision}
                // El filter de arriba garantiza nota con cuerpo; el trim
                // aquí solo la deja limpia para las comillas.
                note={session.note?.trim() ?? ''}
                timeFormat={timeFormat}
                index={index}
              />
            ))}
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[1em] rounded-b-[0.6em] bg-gradient-to-t from-black/60 to-transparent"
          />
        </div>
      )}
    </div>
  );
};
