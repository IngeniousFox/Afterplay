import { CalendarClock, Sparkles } from 'lucide-react';
import { AMBER, GREEN, GRAY } from '../../lib/colors';
import type { GameRelease } from '../../lib/releaseDate';
import { countdownLabel, formatRelease, releaseCountdown } from '../../lib/releaseDate';

type ReleaseBadgeProps = {
  game: GameRelease;
};

// La fecha de salida de un juego que aún no ha salido, con su cuenta atrás
// (PLAN-TO-PLAY.md §2.5). Tres estados de urgencia, y el color hace el
// trabajo antes de que se lea el texto:
//
//   OUT NOW      verde — ya está aquí, es un empujón a promocionarlo
//   ≤ 7 días     ámbar — la espera dejó de ser abstracta
//   ≤ 30 días    gris  — hay fecha y está cerca, pero no es hoy
//   más lejos    solo la fecha, sin cuenta: "en 143 días" es ruido con
//                pinta de dato
//
// Y nunca cuenta días que no se saben: un juego de "March 2026" enseña su mes
// y punto. Contar desde su día 1 sería una precisión falsa, justo lo que la
// columna de precisión existe para evitar.
export const ReleaseBadge = ({ game }: ReleaseBadgeProps): React.JSX.Element | null => {
  const label = formatRelease(game);
  if (label === null) {
    // Sin fecha ninguna: un anunciado en TBD. Se dice, en vez de dejar el
    // hueco mudo — es información: "sí, está apuntado; no, no se sabe cuándo".
    return (
      <span className="flex-none text-[11px] font-semibold text-muted-foreground/60">
        No date yet
      </span>
    );
  }

  const countdown = releaseCountdown(game);

  if (countdown === null) {
    return (
      <span className="flex flex-none items-center gap-1.25 text-[11.5px] font-semibold text-muted-foreground tabular-nums">
        <CalendarClock size={11.5} className="flex-none" />
        {label}
      </span>
    );
  }

  const isOut = countdown.kind === 'out-now';
  const color = isOut ? GREEN : countdown.kind === 'soon' && !countdown.imminent ? GRAY : AMBER;

  return (
    <span className="flex flex-none items-center gap-1.75">
      {!isOut && (
        <span className="text-[11px] font-semibold text-muted-foreground/70 tabular-nums">
          {label}
        </span>
      )}
      <span
        className="flex items-center gap-1 rounded-lg border px-1.75 py-0.5 text-[10.5px] font-extrabold whitespace-nowrap tabular-nums"
        style={{ color, borderColor: `${color}47`, background: `${color}17` }}
      >
        {isOut && <Sparkles size={10} className="flex-none" />}
        {countdownLabel(countdown)}
      </span>
    </span>
  );
};
