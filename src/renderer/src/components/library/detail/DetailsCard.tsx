import { Building2, Calendar, Clock, Folder, Gamepad2, RotateCcw, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, formatBytes } from '../../../lib/format';

type DetailsCardProps = {
  game: GameDetail;
};

const Row = ({
  Icon,
  label,
  value,
  last = false,
}: {
  Icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  last?: boolean;
}): React.JSX.Element => (
  <div
    className={`flex items-center justify-between py-2.25 ${last ? '' : 'border-b border-white/5'}`}
  >
    <span className="flex items-center gap-2.25 text-[12.5px] text-muted-foreground">
      <Icon size={15} />
      {label}
    </span>
    <span className="text-right text-[13px] font-semibold text-foreground">{value}</span>
  </div>
);

// SPEC 10.7 / prototipo — card "Details" del sidebar. Features se
// intercambia por Genres (viene de IGDB, no es editable a mano).
export const DetailsCard = ({ game }: DetailsCardProps): React.JSX.Element => {
  const { data: timeFormat = '24h' } = useTimeFormat();
  const replays = Math.max(0, game.iterations.length - 1);
  const replaysLabel = replays === 0 ? 'Never' : `${replays} ${replays === 1 ? 'time' : 'times'}`;

  const lastSession = game.iterations
    .flatMap((it) => it.sessions)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  const recentActivity = lastSession
    ? formatByPrecision(lastSession.startedAt, 'day', timeFormat)
    : '—';

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="mb-2 text-[13.5px] font-bold text-foreground">Details</div>
      <Row Icon={Gamepad2} label="Developer" value={game.developer ?? '—'} />
      <Row Icon={Building2} label="Publisher" value={game.publisher ?? '—'} />
      <Row Icon={Calendar} label="Released" value={game.releaseYear ?? '—'} />
      {/* Un endless nunca llega a "Beaten" (no existe ese estado para él,
          ver ENDLESS_STATUS_OPTIONS) — su única forma de generar una
          iteración nueva es Dropped -> empezar de cero, que no es lo que
          "replayed" da a entender (terminarlo y volver a jugarlo entero). */}
      {!game.endless && <Row Icon={RotateCcw} label="Times replayed" value={replaysLabel} />}
      <Row Icon={Clock} label="Recent activity" value={recentActivity} />
      {game.installDirectory && (
        <div className="border-b border-white/5 py-2.75">
          <div className="mb-1.25 flex items-center gap-2.25 text-[12.5px] text-muted-foreground">
            <Folder size={15} />
            Install directory
          </div>
          <div className="font-mono text-xs font-semibold break-all text-foreground">
            {game.installDirectory}
          </div>
          {game.installSizeBytes !== null && (
            <div className="mt-0.75 text-[11.5px] text-muted-foreground tabular-nums">
              {formatBytes(game.installSizeBytes)}
            </div>
          )}
        </div>
      )}
      <Row
        Icon={Tag}
        label="Genres"
        value={game.genres && game.genres.length > 0 ? game.genres.join(', ') : '—'}
        last
      />
    </div>
  );
};
