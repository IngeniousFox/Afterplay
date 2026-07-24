import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Download,
  Gamepad2,
  Package,
  Star,
  Tag,
} from 'lucide-react';
import { useState } from 'react';
import type { GameDetail, IterationDetail, TimeFormat } from '../../../../../shared/types';
import { useUpdateIteration } from '../../../hooks/iterations';
import { useTimeFormat } from '../../../hooks/settings';
import { useCountUp } from '../../../hooks/useCountUp';
import { AMBER } from '../../../lib/colors';
import { humanizeSpanByPrecision } from '../../../lib/dateMath';
import { formatByPrecision, formatHours, formatMoney } from '../../../lib/format';
import { getGameStatusMeta } from '../../../lib/gameStatus';
import { StatusIcon } from '../../StatusIcon';
import { InfoChip } from './InfoChip';
import { StatTile } from './StatTile';

const GREEN = '#2fdc7e';
// Píldoras por página — las que caben en el ancho del sidebar sin apretarse.
const PER_PAGE = 4;
// Mismo pager que CompletedGallery/HltbCompareList en Stats.
const pagerButtonClass =
  'flex h-5.5 w-5.5 items-center justify-center rounded-[6px] border border-input bg-white/[0.03] text-muted-foreground hover:text-foreground disabled:opacity-35 disabled:hover:text-muted-foreground';

type PlaythroughPanelProps = {
  game: GameDetail;
  // Controlado desde GameDetail (no estado propio): HowLongToBeatCard
  // necesita saber cuál es el playthrough elegido para mover su marcador,
  // así que la selección vive un nivel más arriba, no aquí dentro.
  selectedIteration: IterationDetail;
  onSelectIteration: (id: number) => void;
};

// La tira de viaje: inicio ──── cuánto duró ──── desenlace. Un playthrough es
// un tramo de tiempo, y verlo como tramo dice cosas que dos fechas sueltas en
// filas separadas no dicen (que te duró tres semanas, o que llevas dos meses
// enganchado).
const JourneyStrip = ({
  iteration,
  timeFormat,
}: {
  iteration: IterationDetail;
  timeFormat: TimeFormat;
}): React.JSX.Element | null => {
  if (!iteration.startedAt) return null;

  const status = getGameStatusMeta(iteration.currentState);
  const isOngoing = iteration.endedAt === null;
  // Modelo v2 — la precisión de cada fecha derivada: un inicio medido por
  // sesión real es un instante exacto (datetime); uno tecleado a mano lleva
  // la precisión de su evento. El fin siempre viene de un evento.
  const startedPrecision = iteration.startedBySession
    ? ('datetime' as const)
    : (iteration.startEvent?.datePrecision ?? 'day');
  const endedPrecision = iteration.endEvent?.datePrecision ?? 'day';
  // Un playthrough en marcha se mide contra AHORA («llevas 3 semanas»), uno
  // cerrado contra su fecha de fin. Por precisión: con fechas de solo año/mes
  // no se puede hablar de días (ver humanizeSpanByPrecision) — "ahora" sí es
  // un instante exacto, así que en los que siguen abiertos manda la precisión
  // del inicio.
  const span = humanizeSpanByPrecision(
    iteration.startedAt,
    iteration.endedAt ?? new Date(),
    startedPrecision,
    iteration.endedAt ? endedPrecision : 'datetime',
  );

  return (
    <div className="rounded-[12px] border border-border bg-white/[0.02] px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[9.5px] font-bold tracking-[.12em] text-muted-foreground">
            STARTED
          </div>
          <div className="mt-0.75 truncate text-[12.5px] font-semibold text-foreground">
            {formatByPrecision(iteration.startedAt, startedPrecision, timeFormat)}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div
            className="text-[9.5px] font-bold tracking-[.12em]"
            style={{ color: isOngoing ? GREEN : `${status.color}cc` }}
          >
            {isOngoing ? 'ONGOING' : status.label.toUpperCase()}
          </div>
          <div className="mt-0.75 truncate text-[12.5px] font-semibold text-foreground">
            {iteration.endedAt
              ? formatByPrecision(iteration.endedAt, endedPrecision, timeFormat)
              : 'Still going'}
          </div>
        </div>
      </div>

      <div className="mt-2.75 flex items-center gap-2">
        <span className="h-1.75 w-1.75 flex-none rounded-full bg-muted-foreground" />
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span className="flex-none text-[10.5px] font-semibold whitespace-nowrap text-muted-foreground">
          {/* "Same year so far" no se lee bien — con un tramo que no es una
              duración, el sufijo sobra. */}
          {isOngoing && !span.startsWith('Same') ? `${span} so far` : span}
        </span>
        <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{
            background: isOngoing ? GREEN : status.color,
            ...(isOngoing ? { animation: 'afterplay-pulse-dot 1.4s infinite' } : {}),
          }}
        />
      </div>
    </div>
  );
};

const RatingRow = ({
  rating,
  onRate,
}: {
  rating: 1 | 2 | 3 | 4 | 5 | null;
  onRate: (value: number) => void;
}): React.JSX.Element => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-[10px] font-bold tracking-[.12em] text-muted-foreground">MY RATING</span>
    <div className="flex items-center gap-0.75">
      {[1, 2, 3, 4, 5].map((value) => {
        const on = rating !== null && value <= rating;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onRate(value === rating ? 0 : value)}
            aria-label={`Rate ${value} out of 5`}
            className="flex-none cursor-pointer p-0.5 transition-transform hover:scale-115"
          >
            <Star size={17} color={AMBER} fill={on ? AMBER : 'none'} strokeWidth={1.7} />
          </button>
        );
      })}
    </div>
  </div>
);

// Card "Playthrough" del sidebar. Rediseño sobre el prototipo: en vez de
// ocho filas `label —— valor` con el mismo peso visual, tres bloques con
// jerarquía — el tramo de tiempo (la historia), las dos medidas que importan
// (horas y gasto) y la ficha técnica reducida a píldoras.
export const PlaythroughPanel = ({
  game,
  selectedIteration,
  onSelectIteration,
}: PlaythroughPanelProps): React.JSX.Element => {
  const updateIteration = useUpdateIteration();
  const { data: timeFormat = '24h' } = useTimeFormat();
  const iteration = selectedIteration;
  const hours = useCountUp(iteration.hours);
  const spend = useCountUp(iteration.spend);
  const status = getGameStatusMeta(iteration.currentState);
  const hasSeveral = game.iterations.length > 1;

  const totalPages = Math.max(1, Math.ceil(game.iterations.length / PER_PAGE));
  const selectedIndex = game.iterations.findIndex((it) => it.id === iteration.id);
  const pageOfSelected = Math.floor(Math.max(0, selectedIndex) / PER_PAGE);
  const [page, setPage] = useState(pageOfSelected);
  // La página SIGUE a la selección cuando esta cambia desde fuera (GameDetail
  // salta al playthrough más nuevo si el watcher crea uno con la ficha
  // abierta) — si no, el elegido quedaría en una página que no se está
  // viendo. Patrón de "ajustar estado durante el render", sin useEffect,
  // igual que el resto de la app.
  const [seenSelectedId, setSeenSelectedId] = useState(iteration.id);
  if (iteration.id !== seenSelectedId) {
    setSeenSelectedId(iteration.id);
    setPage(pageOfSelected);
  }
  // Acotada, no confiada al estado: borrar un playthrough puede dejar `page`
  // fuera de rango sin que ningún click lo haya pedido.
  const currentPage = Math.min(page, totalPages - 1);
  // El índice original viaja con cada elemento: la etiqueta "#3" es su
  // posición en el juego, no en la página.
  const shownIterations = game.iterations
    .map((it, index) => ({ iteration: it, index }))
    .slice(currentPage * PER_PAGE, (currentPage + 1) * PER_PAGE);

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[13.5px] font-bold text-foreground">Playthrough</div>
        {/* El estado sube a la cabecera: es la respuesta a "¿en qué quedó
            esto?" y antes estaba enterrado como la tercera fila de ocho. */}
        <span
          className="flex items-center gap-1.25 text-[12px] font-semibold"
          style={{ color: status.color }}
        >
          <StatusIcon meta={status} size={13} />
          {status.label}
        </span>
      </div>

      {hasSeveral && (
        // Píldoras paginadas en vez de un desplegable: comparar recorridos es
        // justo el motivo por el que existe este selector, y con un dropdown
        // hay que abrirlo y cerrarlo para ver el siguiente. Con muchos
        // playthroughs se pagina (mismo pager que la galería Completed de
        // Stats) en lugar de apilar veinte píldoras en el sidebar.
        <div className="mt-3">
          {totalPages > 1 && (
            <div className="mb-1.75 flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage === 0}
                aria-label="Earlier playthroughs"
                className={pagerButtonClass}
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {currentPage + 1}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage === totalPages - 1}
                aria-label="Later playthroughs"
                className={pagerButtonClass}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {shownIterations.map(({ iteration: it, index }) => {
              const active = it.id === iteration.id;
              const ongoing = it.currentState === 'started';
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onSelectIteration(it.id)}
                  className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold"
                  style={
                    active
                      ? { color: GREEN, borderColor: `${GREEN}59`, background: `${GREEN}14` }
                      : {
                          color: 'var(--muted-foreground)',
                          borderColor: 'var(--border)',
                          background: 'rgba(255,255,255,.028)',
                        }
                  }
                >
                  {ongoing && (
                    <span
                      className="h-1.25 w-1.25 flex-none rounded-full"
                      style={{ background: GREEN, animation: 'afterplay-pulse-dot 1.4s infinite' }}
                    />
                  )}
                  <span>#{index + 1}</span>
                  <span className="opacity-60">{formatHours(it.hours)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3.5 flex flex-col gap-2.5">
        <JourneyStrip iteration={iteration} timeFormat={timeFormat} />

        <div className="grid grid-cols-2 gap-2">
          <StatTile color={GREEN} label="PLAYED" value={formatHours(hours)} />
          <StatTile
            color={AMBER}
            label="SPENT"
            value={iteration.spend > 0 ? formatMoney(spend) : 'Free'}
          />
        </div>

        <RatingRow
          rating={iteration.rating}
          onRate={(value) =>
            updateIteration.mutate({
              id: iteration.id,
              // 0 = quitar la nota (click en la estrella ya activa).
              patch: { rating: value === 0 ? null : (value as 1 | 2 | 3 | 4 | 5) },
            })
          }
        />

        {/* Ficha técnica: etiquetas, no medidas — una fila de píldoras en
            lugar de tres filas con su propio borde inferior cada una. */}
        <div className="flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
          <InfoChip Icon={Gamepad2}>{iteration.playedPlatform}</InfoChip>
          <InfoChip Icon={iteration.format === 'physical' ? Disc3 : Download}>
            {iteration.format === 'physical' ? 'Physical' : 'Digital'}
          </InfoChip>
          <InfoChip Icon={Tag}>
            <span className="capitalize">{iteration.origin}</span>
          </InfoChip>
          {iteration.extraContent && (
            <InfoChip Icon={Package} color="#85a3d6">
              Extra content only
            </InfoChip>
          )}
        </div>
      </div>
    </div>
  );
};
