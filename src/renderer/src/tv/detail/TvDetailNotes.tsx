import { NotebookPen } from 'lucide-react';
import { useMemo } from 'react';
import { NotesMarkdown } from '../../components/library/detail/NotesMarkdown';
import type { EventDatePrecision, GameDetail, TimeFormat } from '../../../../shared/types';
import { useTimeFormat } from '../../hooks/settings';
import { formatByPrecision } from '../../lib/format';
import { allSessions } from '../../lib/sessions';
import { notesProseClass } from '../../lib/styles';
import { cn } from '@/lib/utils';
import { useTvFocusable } from '../focusContext';
import {
  tvFocusHalo,
  tvFocusMotion,
  tvLabelClass,
  tvPanelClass,
  tvRevealClass,
  tvRevealStyle,
} from '../styles';

// Las notas completas del juego en el sofá, SOLO lectura: a la izquierda las
// notas del juego (el NotesSection de escritorio, markdown incluido) y a la
// derecha el diario — las notas de sesión que el toast fue recogiendo al
// cerrar cada partida. Escribir y corregir es tarea de escritorio; aquí solo
// se relee, que es para lo que se escribieron.

// Una entrada del diario: fecha en Dust y la nota con la barra ámbar de 2 px
// de las notas de sesión. Enfocable sin onSelect — el stick la recorre y la
// lista hace scroll, el motor silencia A.
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
      className={cn(
        'rounded-md px-[0.8em] py-[0.6em]',
        tvFocusMotion,
        focused && ['bg-raised', tvFocusHalo],
        tvRevealClass,
      )}
      style={tvRevealStyle(index)}
    >
      <div className="text-[0.92em] font-semibold text-dust tabular-nums">
        {formatByPrecision(when, datePrecision, timeFormat)}
      </div>
      <div className="mt-[0.3em] border-l-2 border-phosphor pl-[0.7em] leading-snug text-bone">
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
    // Dos columnas: las notas del juego a la izquierda y el diario a la
    // derecha; sin diario, las notas del juego ocupan todo el ancho.
    <div
      className={cn(
        'grid h-full min-h-0 gap-[1.4em]',
        sessionNotes.length > 0 ? 'grid-cols-[1.4fr_1fr]' : 'grid-cols-1',
      )}
    >
      <div className="flex min-h-0 flex-col gap-[0.8em]">
        {gameNotes ? (
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col border-l-2 border-l-phosphor',
              tvPanelClass,
              tvRevealClass,
            )}
            style={tvRevealStyle(0)}
          >
            <div className={cn('flex-none px-[1.2em] pt-[0.9em]', tvLabelClass)}>Your notes</div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-[1.2em] pt-[0.5em] pb-[1em]"
              style={{ scrollbarWidth: 'none' }}
            >
              {/* El mismo prose que NotesSection en escritorio, re-anclado a
                  la escala del sofá: prose-sm fija su tamaño en rem (raíz del
                  documento) y se saltaría la cascada em del shell TV — el
                  fontSize inline lo devuelve al redil y los hijos (em sobre
                  em) escalan solos. */}
              <div
                className={cn(notesProseClass, 'leading-relaxed')}
                style={{ fontSize: '1.08em' }}
              >
                <NotesMarkdown>{gameNotes}</NotesMarkdown>
              </div>
            </div>
          </div>
        ) : (
          // Vacío honesto: la sección existe (que se sepa que el juego admite
          // notas) pero no finge contenido — y dice claro dónde se escriben.
          <div
            className={cn(
              'flex flex-none items-center gap-[0.7em] rounded-md border border-dashed border-line-strong px-[1em] py-[0.9em]',
              tvRevealClass,
            )}
            style={tvRevealStyle(0)}
          >
            <NotebookPen className="size-[1.1em] flex-none text-dust" />
            <span className="font-semibold text-dust">
              No game notes yet — write them from your desk.
            </span>
          </div>
        )}
      </div>

      {sessionNotes.length > 0 && (
        <div
          className={cn('flex min-h-0 flex-col', tvPanelClass, tvRevealClass)}
          style={tvRevealStyle(1)}
        >
          <div className="flex flex-none items-center gap-[0.6em] px-[1.2em] pt-[0.9em]">
            <span className={tvLabelClass}>Session notes</span>
            <span className="ml-auto rounded-sm bg-phosphor-tint px-[0.6em] py-[0.05em] text-[0.92em] font-semibold text-phosphor tabular-nums">
              {sessionNotes.length}
            </span>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto px-[0.6em] pt-[0.6em] pb-[0.8em]"
            style={{
              scrollbarWidth: 'none',
              scrollPaddingTop: '0.6em',
              scrollPaddingBottom: '0.8em',
            }}
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
        </div>
      )}
    </div>
  );
};
