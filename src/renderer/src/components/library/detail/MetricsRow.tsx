import type { LucideIcon } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { GREEN } from '../../../lib/colors';
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
  // conteos, violeta ratios — SPEC 10.2, el vocabulario que esta fila define
  // para el resto de Stats). Los tokens salen SIEMPRE de lib/colors: los
  // cuatro hex estaban copiados aquí a mano, así que cambiar el verde de la
  // app dejaba esta fila (y sus clones) con el viejo. Esta fila y la de
  // GameStats ya tiran de los tokens; screens/Sessions.tsx sigue con sus
  // cuatro hex a pelo. Tiñe el chip del icono y el brillo de la esquina.
  accent?: string;
};

// Exportada — la vista de Sesiones (Bloque 5A) reusa esta misma card para su
// propia tira de resumen en vez de duplicar el estilo.
export const MetricCard = ({
  Icon,
  label,
  value,
  liveHint,
  accent = GREEN,
}: MetricCardProps): React.JSX.Element => (
  <div className="relative min-w-42 flex-1 overflow-hidden rounded-md border border-border bg-card px-4.5 py-4">
    {/* Brillo suave del color de la métrica en la esquina — decorativo,
        tan tenue que solo "colorea el aire" de la card. */}
    <div
      className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full blur-2xl"
      style={{ background: accent, opacity: 0.09 }}
    />
    <div className="relative flex items-center gap-2">
      <span
        className="flex h-6.5 w-6.5 flex-none items-center justify-center rounded-sm border"
        style={{ background: `${accent}1f`, borderColor: `${accent}40` }}
      >
        <Icon size={13} color={accent} />
      </span>
      <span className="text-small font-semibold text-dust">{label}</span>
    </div>
    <div className="relative mt-2.25 font-display text-[30px] leading-none font-bold text-bone tabular-nums">
      {value}
    </div>
    {liveHint && (
      <div className="relative mt-1 text-xs font-semibold text-primary tabular-nums">
        {liveHint}
      </div>
    )}
  </div>
);

// La fila de cifras grandes de Overview (detail.png): tiempo jugado (con las
// unidades pequeñas y "+Xm this session" si hay sesión en marcha), sesiones,
// gasto y coste por hora, en Big Shoulders y separadas por una línea.
const BigFigure = ({
  value,
  accent = false,
}: {
  value: string;
  accent?: boolean;
}): React.JSX.Element => (
  <span
    className={`font-display text-[clamp(44px,4.4vw,64px)] leading-[0.9] font-bold tabular-nums ${accent ? 'text-phosphor' : 'text-bone'}`}
  >
    {/* "38h 10m": las letras van más pequeñas y en Dust, como en la maqueta. */}
    {value.split(/([a-z]+)/i).map((part, index) =>
      /^[a-z]+$/i.test(part) ? (
        <span key={index} className="ml-px text-[0.5em] font-semibold text-dust">
          {part}
        </span>
      ) : (
        <span key={index}>{part}</span>
      ),
    )}
  </span>
);

const Figure = ({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  hint?: string;
}): React.JSX.Element => (
  <div className="min-w-36 flex-1 border-line pr-6 not-first:border-l not-first:pl-6">
    <BigFigure value={value} accent={accent} />
    <div className="mt-2 text-small text-dust">{label}</div>
    {hint && (
      <div className="mt-0.5 text-small font-semibold text-phosphor tabular-nums">{hint}</div>
    )}
  </div>
);

export const MetricsRow = ({ game, liveSince }: MetricsRowProps): React.JSX.Element => {
  const liveSeconds = useLiveTimer(liveSince);
  const liveMinutes = Math.floor(liveSeconds / 60);
  const sessionCount = game.iterations.reduce((sum, it) => sum + it.sessions.length, 0);

  return (
    <div className="flex flex-wrap gap-y-5">
      <Figure
        label="Time played"
        value={formatHours(game.totalHours)}
        accent
        hint={liveSince ? `+${liveMinutes}m this session` : undefined}
      />
      <Figure label="Sessions" value={String(sessionCount)} />
      <Figure label="Spent" value={formatMoney(game.totalSpend)} />
      <Figure
        label="Per hour"
        value={game.costPerHour !== null ? formatMoney(game.costPerHour) : '—'}
      />
    </div>
  );
};
