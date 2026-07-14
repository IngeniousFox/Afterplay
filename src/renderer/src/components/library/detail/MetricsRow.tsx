import { Calendar, Clock, DollarSign, Gauge } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { formatHours, formatMoney } from '../../../lib/format';

type MetricsRowProps = {
  game: GameDetail;
  liveSince: Date | null;
};

const MetricCard = ({
  Icon,
  label,
  value,
  liveHint,
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  liveHint?: string;
}): React.JSX.Element => (
  <div className="min-w-42 flex-1 rounded-[13px] border border-border bg-card px-4.5 py-4">
    <div className="flex items-center gap-1.75 text-muted-foreground">
      <Icon size={14} />
      <span className="text-[10.5px] font-bold tracking-[.09em]">{label}</span>
    </div>
    <div className="mt-2.25 text-[25px] font-extrabold text-foreground tabular-nums">{value}</div>
    {liveHint && (
      <div className="mt-1 text-xs font-semibold text-primary tabular-nums">{liveHint}</div>
    )}
  </div>
);

// SPEC 10.7 — fila de 4 métricas: Total Hours (+"Xm this session" si hay
// sesión activa), Cost/Hour, Sessions, Total Spent.
export const MetricsRow = ({ game, liveSince }: MetricsRowProps): React.JSX.Element => {
  const liveSeconds = useLiveTimer(liveSince);
  const liveMinutes = Math.floor(liveSeconds / 60);
  const sessionCount = game.iterations.reduce((sum, it) => sum + it.sessions.length, 0);

  return (
    <div className="flex flex-wrap gap-3.5">
      <MetricCard
        Icon={Clock}
        label="TOTAL HOURS"
        value={formatHours(game.totalHours)}
        liveHint={liveSince ? `+${liveMinutes}m this session` : undefined}
      />
      <MetricCard
        Icon={Gauge}
        label="COST / HOUR"
        value={game.costPerHour !== null ? formatMoney(game.costPerHour) : '—'}
      />
      <MetricCard Icon={Calendar} label="SESSIONS" value={String(sessionCount)} />
      <MetricCard Icon={DollarSign} label="TOTAL SPENT" value={formatMoney(game.totalSpend)} />
    </div>
  );
};
