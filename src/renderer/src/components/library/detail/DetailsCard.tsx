import { Folder, HardDrive } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useTimeFormat } from '../../../hooks/settings';
import { formatByPrecision, formatBytes } from '../../../lib/format';
import { InfoChip } from './InfoChip';

type DetailsCardProps = {
  game: GameDetail;
};

// Celda de la rejilla de ficha: etiqueta diminuta arriba, dato debajo. Dos
// por fila ocupan lo que antes ocupaba UNA fila `label —— valor`, y al ir
// alineadas en columna se comparan de un vistazo.
export const Cell = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.JSX.Element => (
  <div className="min-w-0">
    <div className="text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">{label}</div>
    <div
      className="mt-0.75 truncate text-[12.5px] font-semibold text-foreground"
      title={typeof value === 'string' ? value : undefined}
    >
      {value}
    </div>
  </div>
);

// Card "Details" del sidebar. Rediseño sobre el prototipo: los datos de
// catálogo (que son etiquetas cortas) van en rejilla de dos columnas en vez
// de seis filas apiladas, los géneros dejan de ser un `join(', ')` que se
// corta feo para ser píldoras, y la carpeta de instalación gana bloque
// propio con su tamaño — es lo único aquí que es una ruta larga de verdad.
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
      <div className="text-[13.5px] font-bold text-foreground">Details</div>

      <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Cell label="DEVELOPER" value={game.developer ?? '—'} />
        <Cell label="PUBLISHER" value={game.publisher ?? '—'} />
        <Cell label="RELEASED" value={game.releaseYear ?? '—'} />
        {/* Un endless nunca llega a "Beaten" (no existe ese estado para él,
            ver ENDLESS_STATUS_OPTIONS) — su única forma de generar una
            iteración nueva es Dropped -> empezar de cero, que no es lo que
            "replayed" da a entender (terminarlo y volver a jugarlo entero). */}
        {game.endless ? (
          <Cell label="LAST PLAYED" value={recentActivity} />
        ) : (
          <>
            <Cell label="REPLAYED" value={replaysLabel} />
            <Cell label="LAST PLAYED" value={recentActivity} />
          </>
        )}
      </div>

      {game.genres && game.genres.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3.5">
          <div className="mb-2 text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
            GENRES
          </div>
          <div className="flex flex-wrap gap-1.5">
            {game.genres.map((genre) => (
              <InfoChip key={genre}>{genre}</InfoChip>
            ))}
          </div>
        </div>
      )}

      {game.installDirectory && (
        <div className="mt-4 border-t border-white/5 pt-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
              INSTALLED AT
            </span>
            {game.installSizeBytes !== null && (
              <span className="flex items-center gap-1.25 text-[11px] font-semibold text-muted-foreground tabular-nums">
                <HardDrive size={11} />
                {formatBytes(game.installSizeBytes)}
              </span>
            )}
          </div>
          {/* truncate + title en vez de break-all: la ruta completa sigue
              disponible al pasar el ratón, pero no rompe la card en cinco
              líneas cuando el juego vive en una carpeta anidada. */}
          <div
            className="flex items-center gap-2 rounded-[9px] border border-border bg-white/[0.02] px-2.5 py-2"
            title={game.installDirectory}
          >
            <Folder size={13} className="flex-none text-muted-foreground" />
            <span className="truncate font-mono text-[11.5px] text-foreground">
              {game.installDirectory}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
