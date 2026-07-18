import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatHours, formatMoney } from '../../lib/format';

export type YearMetrics = {
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
};

type YearOverYearCompareProps = {
  current: YearMetrics;
  previous: YearMetrics;
  previousYear: number;
};

// Verde de acento / rojo de Dropped, mismos significados de color que el
// resto de la app — no colores de semáforo inventados aparte.
const GOOD_COLOR = '#2fdc7e';
const BAD_COLOR = '#e85d72';
const NEUTRAL_COLOR = 'var(--muted-foreground)';

type Tone = 'good' | 'bad' | 'neutral';

const toneColor: Record<Tone, string> = {
  good: GOOD_COLOR,
  bad: BAD_COLOR,
  neutral: NEUTRAL_COLOR,
};
const toneIcon: Record<Tone, LucideIcon> = { good: TrendingUp, bad: TrendingDown, neutral: Minus };

// "más/menos que el año pasado" para GAMES/HOURS: subir de actividad se lee
// como positivo, bajar como negativo — no hay lectura "objetivamente mejor"
// posible aquí, es solo dirección de la variación.
const directionalTone = (delta: number): Tone =>
  delta > 0 ? 'good' : delta < 0 ? 'bad' : 'neutral';
// Para COST/HOUR, al revés: pagar MENOS por hora jugada es mejor rendimiento
// del dinero, así que bajar es lo bueno.
const inverseTone = (delta: number): Tone => (delta < 0 ? 'good' : delta > 0 ? 'bad' : 'neutral');

const Chip = ({ tone, children }: { tone: Tone; children: React.ReactNode }): React.JSX.Element => {
  const color = toneColor[tone];
  const Icon = toneIcon[tone];
  return (
    <div
      className="flex min-w-42 flex-1 items-center gap-2 rounded-[11px] border px-3.5 py-2.5"
      style={{ borderColor: `${color}33`, background: `${color}0d` }}
    >
      <Icon size={14} className="flex-none" color={color} />
      <span className="text-[12px] font-semibold text-foreground">{children}</span>
    </div>
  );
};

// Fila de comparación con el año anterior, debajo de las 4 métricas — SOLO
// cuando hay un año concreto filtrado (nunca en "All Time", que no tiene un
// "año pasado" con el que compararse) y ese año anterior tiene actividad
// registrada de verdad (Stats.tsx lo gatea con `years.includes(previousYear)`
// — comparar contra un año vacío saldría siempre "todo menos", ruido sin
// información). Estilo recap: una frase corta y coloreada por chip, nada de
// tablas.
export const YearOverYearCompare = ({
  current,
  previous,
  previousYear,
}: YearOverYearCompareProps): React.JSX.Element => {
  const gamesDelta = current.totalGames - previous.totalGames;
  const hoursDelta = current.totalHours - previous.totalHours;
  const spentDelta = current.totalSpent - previous.totalSpent;
  const costDelta =
    current.costPerHour !== null && previous.costPerHour !== null
      ? current.costPerHour - previous.costPerHour
      : null;

  return (
    <div className="mt-2.5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
      <Chip tone={directionalTone(gamesDelta)}>
        {gamesDelta === 0
          ? `Same as ${previousYear}`
          : `${Math.abs(gamesDelta)} ${gamesDelta > 0 ? 'more' : 'fewer'} than ${previousYear}`}
      </Chip>

      <Chip tone={directionalTone(hoursDelta)}>
        {Math.abs(hoursDelta) < 0.05
          ? `Same as ${previousYear}`
          : `${formatHours(Math.abs(hoursDelta))} ${hoursDelta > 0 ? 'more' : 'less'} than ${previousYear}`}
      </Chip>

      {/* Igual que Cost/Hour: gastar MENOS que el año pasado se lee como
          positivo (verde), gastar más como negativo (rojo) — mismo criterio
          "menos dinero es mejor", no una moralina sobre el gasto en sí. */}
      <Chip tone={inverseTone(spentDelta)}>
        {Math.abs(spentDelta) < 0.005
          ? `Same as ${previousYear}`
          : `${formatMoney(Math.abs(spentDelta))} ${spentDelta > 0 ? 'more' : 'less'} than ${previousYear}`}
      </Chip>

      <Chip tone={costDelta === null ? 'neutral' : inverseTone(costDelta)}>
        {costDelta === null
          ? `No comparison for ${previousYear}`
          : Math.abs(costDelta) < 0.005
            ? `Same as ${previousYear}`
            : `${formatMoney(Math.abs(costDelta))} ${costDelta > 0 ? 'more' : 'cheaper'} per hour vs ${previousYear}`}
      </Chip>
    </div>
  );
};
