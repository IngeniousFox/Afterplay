import { useMemo } from 'react';
import { GREEN } from '../../lib/colors';
import { formatHours } from '../../lib/format';
import { CategoryBarChart } from './CategoryBarChart';
import type { Year } from './YearPicker';

type ChartSession = {
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  isManual: boolean;
};

type WhenDoYouPlayChartProps = {
  sessions: ChartSession[];
  year: Year;
  // GameStats reusa esta card para UN juego ("When do you play it?") — el
  // título por defecto es el de la página global.
  title?: string;
};

// Lunes primero, como el heatmap (SPEC: etiquetas Mon/Wed/Fri) — getDay()
// de JS empieza en domingo, de ahí el (getDay()+6)%7 de abajo.
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ¿Qué días de la semana juegas? — 7 barras con las horas totales por día,
// mismas reglas de datos que el heatmap y Hours per month: solo sesiones
// trackeadas de verdad (isManual false) y cerradas. "All Time" aquí es el
// histórico completo (es un perfil de costumbres, no una ventana de
// actividad reciente); un año concreto, solo ese año.
export const WhenDoYouPlayChart = ({
  sessions,
  year,
  title = 'When do you play?',
}: WhenDoYouPlayChartProps): React.JSX.Element => {
  const bars = useMemo(() => {
    const secondsByDay = Array.from({ length: 7 }, () => 0);
    for (const session of sessions) {
      if (session.isManual || session.endedAt === null) continue;
      if (year !== 'all' && session.startedAt.getFullYear() !== year) continue;
      const dayIndex = (session.startedAt.getDay() + 6) % 7;
      secondsByDay[dayIndex] += session.durationSec ?? 0;
    }

    return DAY_LABELS.map((label, index) => ({ label, value: secondsByDay[index] }));
  }, [sessions, year]);

  return (
    <CategoryBarChart
      title={title}
      headerRight={(peakIndex) => (peakIndex >= 0 ? `${DAY_LABELS[peakIndex]} is your day` : null)}
      bars={bars}
      formatValue={(seconds) => formatHours(seconds / 3600)}
      barGradient="linear-gradient(180deg,var(--ac),var(--ac2))"
      labelColor={GREEN}
      glowColor="rgba(47,220,126,.35)"
      maxBarWidthClass="max-w-9"
    />
  );
};
