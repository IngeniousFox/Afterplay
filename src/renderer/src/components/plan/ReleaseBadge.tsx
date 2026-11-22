import { CalendarClock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GameRelease } from '../../lib/releaseDate';
import { countdownLabel, formatRelease, releaseCountdown } from '../../lib/releaseDate';

type ReleaseBadgeProps = {
  game: GameRelease;
};

// La fecha de salida de un juego que aún no ha salido, con su cuenta atrás
// (PLAN-TO-PLAY.md §2.5). Tres estados de urgencia, y el color hace el
// trabajo antes de que se lea el texto:
//
//   OUT NOW      verde (Beaten) — ya está aquí, es un empujón a promocionarlo
//   ≤ 7 días     Phosphor — la espera dejó de ser abstracta
//   ≤ 30 días    Dust — hay fecha y está cerca, pero no es hoy
//   más lejos    solo la fecha, sin cuenta: "en 143 días" es ruido
//
// Y nunca cuenta días que no se saben: un juego de "March 2026" enseña su mes
// y punto.
export const ReleaseBadge = ({ game }: ReleaseBadgeProps): React.JSX.Element | null => {
  const label = formatRelease(game);
  if (label === null) {
    // Sin fecha ninguna: un anunciado en TBD. Se dice, en vez de dejar el
    // hueco mudo — es información.
    return <span className="flex-none text-micro font-medium text-dust">No date yet</span>;
  }

  const countdown = releaseCountdown(game);

  if (countdown === null) {
    return (
      <span className="flex flex-none items-center gap-1 text-micro font-medium text-dust tabular-nums">
        <CalendarClock aria-hidden size={12} className="flex-none" />
        {label}
      </span>
    );
  }

  const isOut = countdown.kind === 'out-now';
  const quiet = countdown.kind === 'soon' && !countdown.imminent;

  return (
    <span className="flex flex-none items-center gap-1.5">
      {!isOut && <span className="text-micro font-medium text-dust tabular-nums">{label}</span>}
      <span
        className={cn(
          'flex items-center gap-1 rounded-sm border px-1.5 py-px text-micro font-semibold whitespace-nowrap tabular-nums',
          isOut
            ? 'border-st-beaten/40 bg-st-beaten/10 text-st-beaten'
            : quiet
              ? 'border-line-strong bg-bone/4 text-dust'
              : 'border-phosphor/40 bg-phosphor-tint text-phosphor',
        )}
      >
        {isOut && <Sparkles aria-hidden size={11} className="flex-none" />}
        {countdownLabel(countdown)}
      </span>
    </span>
  );
};
