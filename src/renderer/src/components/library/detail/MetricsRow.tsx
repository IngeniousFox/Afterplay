import { Calendar, Clock, DollarSign, Gauge } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { formatHours, formatMoney } from '../../../lib/format';

type MetricsRowProps = {
  game: GameDetail;
  liveSince: Date | null;
};

export type MetricCardProps = {
  Icon: LucideIcon;
  label: string;
  value: string;
  liveHint?: string;
  // Color de identidad de la métrica (verde tiempo, ámbar dinero, azul
  // conteos, violeta ratios — mismo vocabulario que el resto de Stats).
  // Tiñe el chip del icono y el brillo decorativo de la esquina.
  accent?: string;
};

// Exportada — la vista de Sesiones (Bloque 5A) reusa esta misma card para su
// propia tira de resumen en vez de duplicar el estilo.
export const MetricCard = ({
  Icon,
  label,
  value,
  liveHint,
  accent = '#2fdc7e',
}: MetricCardProps): React.JSX.Element => (
  <div className="relative min-w-42 flex-1 overflow-hidden rounded-[13px] border border-border bg-card px-4.5 py-4">
    {/* Brillo suave del color de la métrica en la esquina — decorativo,
        tan tenue que solo "colorea el aire" de la card. */}
    <div
      className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full blur-2xl"
      style={{ background: accent, opacity: 0.09 }}
    />
    <div className="relative flex items-center gap-2">
      <span
        className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-[7px] border"
        style={{ background: `${accent}1f`, borderColor: `${accent}40` }}
      >
        <Icon size={13} color={accent} />
      </span>
      <span className="text-[10.5px] font-bold tracking-[.09em] text-muted-foreground">
        {label}
      </span>
    </div>
    <div className="relative mt-2.25 text-[25px] font-extrabold text-foreground tabular-nums">
      {value}
    </div>
    {liveHint && (
      <div className="relative mt-1 text-xs font-semibold text-primary tabular-nums">
        {liveHint}
      </div>
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
        accent="#2fdc7e"
      />
      <MetricCard
        Icon={Gauge}
        label="COST / HOUR"
        value={game.costPerHour !== null ? formatMoney(game.costPerHour) : '—'}
        accent="#7c86c8"
      />
      <MetricCard Icon={Calendar} label="SESSIONS" value={String(sessionCount)} accent="#85a3d6" />
      <MetricCard
        Icon={DollarSign}
        label="TOTAL SPENT"
        value={formatMoney(game.totalSpend)}
        accent="#e3b24a"
      />
    </div>
  );
};
