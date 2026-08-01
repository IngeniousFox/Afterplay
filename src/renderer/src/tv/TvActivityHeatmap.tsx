import { useMemo } from 'react';
import type { SessionWithGame } from '../../../shared/types';
import type { Year } from '../components/stats/YearPicker';
import { addDays, startOfDay } from '../lib/dateMath';
import { formatHours } from '../lib/format';
import { isMeasuredSession } from '../lib/sessionStats';

// EL MAPA DE ACTIVIDAD, portado tal cual del escritorio (ActivityHeatmap):
// una columna por semana, siete filas por día, y cinco niveles de verde
// según cuánto jugaste ese día respecto a tu mejor día del periodo.
//
// En una tele la rejilla completa SÍ se lee: no se leen los días sueltos
// (para eso está el tooltip que aquí no existe), se lee el PATRÓN — dónde
// hubo racha, dónde hubo sequía. Por eso viaja al modo TV con sus mismos
// colores y su misma regla, solo que con celdas más grandes y sin hover.

const ROLLING_WEEKS = 52;
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
// Los mismos cinco tonos del prototipo (Backlog.html, heatColor).
const LEVEL_COLORS = [
  'rgba(255,255,255,.045)',
  'rgba(47,220,126,.28)',
  'rgba(47,220,126,.48)',
  'rgba(47,220,126,.72)',
  'rgba(47,220,126,1)',
];

const mondayOf = (date: Date): Date => {
  const day = startOfDay(date);
  // getDay(): domingo = 0. Lunes primero, como el resto de la casa.
  return addDays(day, -((day.getDay() + 6) % 7));
};

export const TvActivityHeatmap = ({
  sessions,
  year,
}: {
  sessions: SessionWithGame[];
  year: Year;
}): React.JSX.Element => {
  const { cells, monthLabels, weeks, activeDays, bestHours } = useMemo(() => {
    const today = startOfDay(new Date());
    let rangeStart: Date;
    let rangeEnd: Date;
    if (year === 'all') {
      rangeEnd = today;
      rangeStart = mondayOf(addDays(today, -(ROLLING_WEEKS - 1) * 7));
    } else {
      rangeStart = mondayOf(new Date(year, 0, 1));
      rangeEnd = startOfDay(new Date(year, 11, 31));
    }
    const weekCount = Math.max(
      1,
      Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / (7 * 24 * 3600 * 1000)) + 1,
    );

    // Solo sesiones MEDIDAS y cerradas alimentan el color — igual que el
    // escritorio: una sesión abierta aún no ha "sumado" su día.
    const secondsByDay = new Map<number, number>();
    for (const session of sessions) {
      if (!isMeasuredSession(session) || session.endedAt === null) continue;
      const dayMs = startOfDay(session.startedAt).getTime();
      secondsByDay.set(dayMs, (secondsByDay.get(dayMs) ?? 0) + (session.durationSec ?? 0));
    }
    const maxSeconds = Math.max(0, ...secondsByDay.values());
    const levelFor = (seconds: number): number => {
      if (seconds <= 0 || maxSeconds <= 0) return 0;
      const frac = seconds / maxSeconds;
      if (frac <= 0.25) return 1;
      if (frac <= 0.5) return 2;
      if (frac <= 0.75) return 3;
      return 4;
    };

    const list: { level: number; key: number }[] = [];
    const labels: string[] = [];
    let previousMonth = -1;
    let played = 0;

    for (let week = 0; week < weekCount; week++) {
      const weekStart = addDays(rangeStart, week * 7);
      const month = weekStart.getMonth();
      // La primera semana puede ser un resto del año anterior (alinear a
      // lunes tira hacia atrás): su rótulo se pisaría con el del mes real.
      const isLeadingSpillover = week === 0 && year !== 'all' && weekStart.getFullYear() !== year;
      labels.push(
        !isLeadingSpillover && month !== previousMonth
          ? weekStart.toLocaleDateString('en-US', { month: 'short' })
          : '',
      );
      previousMonth = month;

      for (let day = 0; day < 7; day++) {
        const dayDate = addDays(weekStart, day);
        const dayMs = dayDate.getTime();
        const inRange =
          dayMs <= Math.min(rangeEnd.getTime(), today.getTime()) &&
          (year === 'all' || dayDate.getFullYear() === year);
        const level = inRange ? levelFor(secondsByDay.get(dayMs) ?? 0) : 0;
        if (level > 0) played++;
        list.push({ level, key: dayMs });
      }
    }

    return {
      cells: list,
      monthLabels: labels,
      weeks: weekCount,
      activeDays: played,
      bestHours: maxSeconds / 3600,
    };
  }, [sessions, year]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[0.45em]">
      <div className="flex flex-none items-baseline gap-[0.55em]">
        <span className="text-[0.55em] font-extrabold tracking-[.18em] text-muted-foreground">
          ACTIVITY
        </span>
        <span className="text-[0.6em] font-bold text-[#2fdc7e] tabular-nums">
          {activeDays} days played
        </span>
        {bestHours > 0 && (
          <span className="text-[0.55em] font-semibold text-muted-foreground/70">
            best day · {formatHours(bestHours)}
          </span>
        )}
        {/* La leyenda de intensidad, siempre visible (en escritorio también
            lo está): sin ella, cinco verdes son cinco verdes. */}
        <span className="ml-auto flex items-center gap-[0.3em]">
          <span className="text-[0.5em] font-semibold text-muted-foreground/60">Less</span>
          {LEVEL_COLORS.map((color) => (
            <span
              key={color}
              className="h-[0.5em] w-[0.5em] rounded-[0.12em]"
              style={{ background: color }}
            />
          ))}
          <span className="text-[0.5em] font-semibold text-muted-foreground/60">More</span>
        </span>
      </div>

      {/* La rejilla ESTIRA para llenar el panel: un mapa flotando en medio de
          un panel alto se leía como un hueco, no como una pieza. El techo lo
          pone la pantalla (la fila que lo contiene), no el mapa. */}
      <div className="flex min-h-0 flex-1 gap-[0.35em]">
        {/* Los días de la semana, alternos para que quepan sin apretar. */}
        <div className="flex flex-none flex-col justify-between pt-[0.9em] pb-[0.05em] text-[0.45em] font-semibold text-muted-foreground/55">
          {DAY_LABELS.map((label, index) => (
            <span key={index} className="leading-none">
              {label}
            </span>
          ))}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[0.2em]">
          {/* Los rótulos de mes, alineados con su columna de semana. */}
          <div
            className="grid flex-none gap-[0.12em] text-[0.45em] font-bold tracking-[.06em] text-muted-foreground/60"
            style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
          >
            {monthLabels.map((label, index) => (
              <span key={index} className="leading-none whitespace-nowrap">
                {label}
              </span>
            ))}
          </div>
          {/* La rejilla: columna-mayor (semana a semana), como el prototipo. */}
          <div
            className="grid min-h-0 flex-1 gap-[0.12em]"
            style={{
              gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`,
              gridTemplateRows: 'repeat(7, minmax(0, 1fr))',
              gridAutoFlow: 'column',
            }}
          >
            {cells.map((cell) => (
              <span
                key={cell.key}
                className="rounded-[0.12em]"
                style={{
                  background: LEVEL_COLORS[cell.level],
                  // Un puntito de brillo solo en los días fuertes: el mapa
                  // respira sin que ningún día pida turno.
                  boxShadow: cell.level >= 3 ? '0 0 0.35em rgba(47,220,126,.45)' : undefined,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
