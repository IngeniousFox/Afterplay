import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useSessionsInRange } from '../../hooks/sessions';
import { useNow } from '../../hooks/useNow';
import { addDays, startOfDay } from '../../lib/dateMath';
import { formatHours } from '../../lib/format';

// "This week" de Home: horas, sesiones y juegos de la semana en curso (de
// lunes a domingo), con una barra por día. Sale de las sesiones que
// ARRANCARON en la semana (useSessionsInRange, la misma consulta que el
// heatmap); una sesión abierta cuenta hasta ahora.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const shortDate = (date: Date): string =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// "14h 05m": horas y minutos con cero a la izquierda (README-sistema, cifras).
const splitHours = (seconds: number): { hours: number; minutes: string } => {
  const totalMinutes = Math.round(seconds / 60);
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: String(totalMinutes % 60).padStart(2, '0'),
  };
};

export const WeekPanel = (): React.JSX.Element => {
  // La semana se recalcula si la app sigue abierta al cambiar de día.
  const now = useNow(true, 60_000);
  const todayMs = startOfDay(new Date(now)).getTime();
  const range = useMemo(() => {
    const today = new Date(todayMs);
    const from = addDays(today, -((today.getDay() + 6) % 7));
    return { from, to: addDays(from, 7) };
  }, [todayMs]);
  const todayIndex = (new Date(todayMs).getDay() + 6) % 7;

  const { data: sessions = [], isLoading } = useSessionsInRange(range);

  const days = DAY_LABELS.map(() => 0);
  const games = new Set<string>();
  for (const session of sessions) {
    const index = Math.round(
      (startOfDay(session.startedAt).getTime() - range.from.getTime()) / 86_400_000,
    );
    if (index < 0 || index > 6) continue;
    const seconds =
      session.durationSec ??
      Math.max(0, ((session.endedAt?.getTime() ?? now) - session.startedAt.getTime()) / 1000);
    days[index] += seconds;
    games.add(String(session.gameId));
  }
  const total = days.reduce((sum, value) => sum + value, 0);
  const longest = Math.max(...days);
  const { hours, minutes } = splitHours(total);

  return (
    <section
      aria-label="This week"
      className="flex min-w-0 flex-col rounded-md border border-line bg-panel px-6 pt-5 pb-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lead font-semibold text-bone">This week</h2>
        <span className="text-small text-dust">
          {shortDate(range.from)} to {shortDate(addDays(range.from, 6))}
        </span>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
        <div className="flex flex-col-reverse">
          <dt className="mt-1 text-small text-dust">played</dt>
          <dd className="font-display text-stat font-bold text-phosphor tabular-nums">
            {hours}
            <span className="text-[0.45em] font-semibold text-dust">h</span>
            {minutes}
            <span className="text-[0.45em] font-semibold text-dust">m</span>
          </dd>
        </div>
        <div className="flex flex-col-reverse border-l border-line pl-8">
          <dt className="mt-1 text-small text-dust">
            {sessions.length === 1 ? 'session' : 'sessions'}
          </dt>
          <dd className="font-display text-stat font-bold text-bone tabular-nums">
            {sessions.length}
          </dd>
        </div>
        <div className="flex flex-col-reverse border-l border-line pl-8">
          <dt className="mt-1 text-small text-dust">{games.size === 1 ? 'game' : 'games'}</dt>
          <dd className="font-display text-stat font-bold text-bone tabular-nums">{games.size}</dd>
        </div>
      </dl>

      {!isLoading && sessions.length === 0 && (
        <p className="mt-3 text-small text-dust">Nothing played yet this week.</p>
      )}

      {/* Escala = el día más largo; los días vacíos conservan un tope de 3 px. */}
      <ol className="mt-auto grid grid-cols-7 gap-2 pt-5" aria-label="Time played per day">
        {days.map((seconds, index) => {
          const today = index === todayIndex;
          const height = longest > 0 ? Math.max(3, Math.round((seconds / longest) * 64)) : 3;
          const label = `${DAY_NAMES[index]}: ${seconds > 0 ? formatHours(seconds / 3600) : 'nothing'}`;
          return (
            <li
              key={DAY_LABELS[index]}
              className="flex flex-col items-center gap-1.5"
              title={label}
            >
              <span className="sr-only">{label}</span>
              <span aria-hidden className="flex h-16 w-full items-end">
                <span
                  className={cn(
                    'w-full rounded-xs',
                    today ? 'bg-phosphor shadow-glow-bar' : 'bg-raised-hover',
                  )}
                  style={{ height }}
                />
              </span>
              <span
                aria-hidden
                className={cn('text-micro', today ? 'font-semibold text-phosphor' : 'text-dust')}
              >
                {DAY_LABELS[index]}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
