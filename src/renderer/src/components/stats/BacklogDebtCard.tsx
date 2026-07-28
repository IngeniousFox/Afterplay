import { Hourglass, Info } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem } from '../../../../shared/types';
import { BLUE, GRAY, VIOLET } from '../../lib/colors';
import { formatHours, pluralize } from '../../lib/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { StatCard } from './StatCard';

type BacklogSession = { startedAt: Date; durationSec: number | null };

type BacklogDebtCardProps = {
  games: GameListItem[];
  plannedGames: GameListItem[];
  sessions: BacklogSession[];
};

// Ventana para calcular el ritmo. El histórico completo miente cuando tu vida
// cambia: si llevas un año jugando la mitad, "a tu ritmo" tiene que ser el
// ritmo de AHORA, no el de cuando tenías más tiempo libre.
const PACE_WINDOW_DAYS = 90;

// Pero la ventana se RECORTA a cuándo empezaste a trackear de verdad. Sin
// esto, quien lleva 9 días con la app dividía sus horas entre 90 días y le
// salía un ritmo diez veces menor del real (caso medido: 5,7 h/semana
// reales -> 0,6 h/semana calculadas -> "6 años de backlog" en vez de
// "7 meses"). Los días en que la app ni existía no son días de no jugar.
const MIN_TRACKED_DAYS = 7;
const HOURS_PER_WEEK_MIN = 0.5;

// Deuda del backlog medida en TIEMPO, no en número de juegos.
//
// Backlog = lo que quieres jugar (Plan to Play) + lo que tienes y no has
// tocado (Unplayed). Los empezados a medias NO cuentan: eso es "lo que tienes
// en marcha", que ya se ve en Playing/On Hold. Los endless tampoco — no
// tienen final que alcanzar (misma regla que el checkbox de Add/Edit Game).
//
// "200 juegos pendientes" no dice nada; "340 horas ≈ 7 meses a tu ritmo" sí.
const DAY_MS = 24 * 60 * 60 * 1000;

type BacklogStats = {
  unplayedCount: number;
  plannedCount: number;
  pendingCount: number;
  totalHours: number;
  withoutEstimate: number;
  hoursPerWeek: number;
  trackedDays: number;
  weeks: number | null;
  finishDate: Date | null;
};

// Fuera del componente y con `now` por parámetro: leer el reloj dentro de un
// useMemo es impuro para el compilador de React (regla react-hooks/purity) —
// mismo motivo por el que lib/streaks.ts hace sus cuentas en funciones
// sueltas en vez de dentro de los hooks.
const computeBacklog = (
  games: GameListItem[],
  plannedGames: GameListItem[],
  sessions: BacklogSession[],
  now: number,
): BacklogStats => {
  // Unplayed = en la biblioteca y sin ningún estado real todavía
  // (currentState null). Un juego con playthrough empezado, terminado o
  // abandonado ya no es backlog.
  const unplayed = games.filter((game) => !game.endless && game.currentState === null);
  // Los planeados llegan con currentState 'plan_to_play' fijo, así que se
  // toman enteros — pero sin los endless, por el mismo motivo.
  const planned = plannedGames.filter((game) => !game.endless);
  const pending = [...unplayed, ...planned];

  const withEstimate = pending.filter((game) => game.hltbMain !== null);
  // Sin estimación NO se inventa nada: se cuentan aparte y se dicen en
  // pequeño. Rellenarlos con la media daría una cifra que parece exacta y
  // no lo es.
  const withoutEstimate = pending.length - withEstimate.length;
  const totalHours = withEstimate.reduce((sum, game) => sum + (game.hltbMain ?? 0), 0);

  // Ritmo real, en horas por semana. El divisor NO es la ventana fija: es el
  // tramo de esa ventana que de verdad está cubierto por el tracking (desde
  // la primera sesión registrada, si es posterior).
  const windowStart = now - PACE_WINDOW_DAYS * DAY_MS;
  const firstSessionAt = sessions.reduce<number | null>(
    (earliest, session) =>
      earliest === null || session.startedAt.getTime() < earliest
        ? session.startedAt.getTime()
        : earliest,
    null,
  );
  const paceStart = firstSessionAt === null ? null : Math.max(windowStart, firstSessionAt);
  const trackedDays = paceStart === null ? 0 : (now - paceStart) / DAY_MS;

  const recentSeconds =
    paceStart === null
      ? 0
      : sessions
          .filter((session) => session.startedAt.getTime() >= paceStart)
          .reduce((sum, session) => sum + (session.durationSec ?? 0), 0);
  // Con menos de una semana medida, cualquier cifra por semana es ruido: un
  // fin de semana intenso daría "40 h/semana" y un plazo de fantasía.
  const hoursPerWeek =
    trackedDays >= MIN_TRACKED_DAYS ? recentSeconds / 3600 / (trackedDays / 7) : 0;

  // Por debajo de media hora semanal la división da cifras absurdas
  // ("1.400 años") que no informan de nada — mejor no dar plazo.
  const weeks =
    hoursPerWeek >= HOURS_PER_WEEK_MIN && totalHours > 0 ? totalHours / hoursPerWeek : null;

  return {
    unplayedCount: unplayed.length,
    plannedCount: planned.length,
    pendingCount: pending.length,
    totalHours,
    withoutEstimate,
    hoursPerWeek,
    trackedDays,
    weeks,
    finishDate: weeks !== null ? new Date(now + weeks * 7 * DAY_MS) : null,
  };
};

export const BacklogDebtCard = ({
  games,
  plannedGames,
  sessions,
}: BacklogDebtCardProps): React.JSX.Element => {
  // El reloj se lee UNA vez al montar y se queda fijo: leerlo en cada render
  // es impuro (react-hooks/purity) y además no aporta nada — el plazo del
  // backlog no cambia entre dos repintados. Cambiar de año remonta el árbol
  // (key en Stats.tsx), así que tampoco se queda rancio en la práctica.
  const [now] = useState(() => Date.now());
  const stats = computeBacklog(games, plannedGames, sessions, now);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-bold text-foreground">Backlog debt</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Everything you want to play plus everything you haven&apos;t touched
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger className="flex-none text-muted-foreground/60 hover:text-foreground">
            <Info size={13} />
          </TooltipTrigger>
          <TooltipContent>
            Main Story times from HowLongToBeat, divided by how much you&apos;ve actually played
            recently (up to the last {PACE_WINDOW_DAYS} days, or since tracking began). Games
            you&apos;ve already started don&apos;t count — neither do endless ones.
          </TooltipContent>
        </Tooltip>
      </div>

      {stats.pendingCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <Hourglass size={26} className="text-muted-foreground/40" />
          <div className="mt-2.5 text-[13px] font-semibold text-foreground">
            Nothing waiting for you.
          </div>
          <div className="mt-1 max-w-64 text-[11.5px] text-muted-foreground">
            Every game in your library is either started or finished.
          </div>
        </div>
      ) : (
        // A lo ancho: la cifra manda a la izquierda y el desglose ocupa el
        // resto. En columna esto quedaba altísimo y encima le robaba el ancho
        // al Backlog flow, que es un gráfico de línea temporal y sin ancho no
        // se lee.
        <div className="mt-3.5 flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
          <div className="flex-none sm:w-64">
            <div className="flex items-baseline gap-2.5">
              <Hourglass size={26} color={VIOLET} className="self-center" />
              <span className="text-[42px] font-extrabold text-foreground tabular-nums">
                {Math.round(stats.totalHours)}
              </span>
              <span className="text-[14px] text-muted-foreground">hours</span>
            </div>
            <div className="mt-0.5 text-[12.5px] font-semibold text-muted-foreground">
              {stats.weeks !== null ? (
                <>
                  ≈ <span style={{ color: VIOLET }}>{humanizeWeeks(stats.weeks)}</span> at your
                  current pace
                </>
              ) : stats.trackedDays < MIN_TRACKED_DAYS ? (
                'Play for a week and Afterplay can estimate how long it will take'
              ) : (
                'Not enough recent playtime to estimate a pace'
              )}
            </div>
            {stats.withoutEstimate > 0 && (
              <div className="mt-1.5 text-[11px] text-muted-foreground/70">
                + {pluralize(stats.withoutEstimate, 'game')} with no HowLongToBeat estimate
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 border-white/5 sm:border-l sm:pl-7">
            <Split
              label="Never touched"
              count={stats.unplayedCount}
              total={stats.pendingCount}
              color={BLUE}
            />
            <Split
              label="Plan to play"
              count={stats.plannedCount}
              total={stats.pendingCount}
              color={VIOLET}
            />
            <div className="mt-0.5 flex items-center justify-between text-[11.5px]">
              <span className="text-muted-foreground">
                {stats.hoursPerWeek >= HOURS_PER_WEEK_MIN
                  ? `Playing ${formatHours(stats.hoursPerWeek)}/week lately`
                  : 'Barely playing lately'}
              </span>
              {stats.finishDate && (
                <span className="font-semibold tabular-nums" style={{ color: GRAY }}>
                  done by {monthYear(stats.finishDate)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </StatCard>
  );
};

// Una de las dos mitades del backlog, con su barra proporcional — el reparto
// entre "lo que ya tienes" y "lo que quieres" es la lectura interesante: dos
// backlogs de 340h no son iguales si uno es todo intención y el otro todo
// juegos ya comprados.
const Split = ({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}): React.JSX.Element => (
  <div className="flex items-center gap-2.5">
    <span className="w-27 flex-none text-[12px] text-muted-foreground">{label}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
        style={{ width: `${total > 0 ? (count / total) * 100 : 0}%`, background: color }}
      />
    </div>
    <span className="w-7 flex-none text-right text-[12px] font-bold tabular-nums text-foreground">
      {count}
    </span>
  </div>
);

// Semanas -> la unidad que un humano entiende sin traducir. Por encima del
// año se dan decimales ("2,5 años"): "130 semanas" no significa nada.
const humanizeWeeks = (weeks: number): string => {
  if (weeks < 1) return 'less than a week';
  if (weeks < 9) return `${Math.round(weeks)} weeks`;
  const months = weeks / 4.345;
  if (months < 18) return `${Math.round(months)} months`;
  const years = weeks / 52.18;
  return `${years.toFixed(1)} years`;
};

const monthYear = (date: Date): string =>
  date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
