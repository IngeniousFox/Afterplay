import { Hourglass, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import type { GameListItem, StateEventSummary } from '../../../../shared/types';
import { BLUE, GRAY, GREEN, VIOLET } from '../../lib/colors';
import { DAY_MS } from '../../lib/dateMath';
import { formatHours, pluralize } from '../../lib/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { StatCard } from './StatCard';

type BacklogSession = { startedAt: Date; durationSec: number | null };

// Dos preguntas distintas según el filtro de año, igual que StatusBreakdown:
// "All Time" es un BALANCE (cuánto debes ahora mismo y cuánto tardarías), y
// un año concreto es el MOVIMIENTO de ese año (qué entró, qué salió, neto).
// Trasladar el balance a un año pasado daba un número hueco: lo que hace
// valiosa esta tarjeta es la proyección hacia delante, y una proyección
// desde 2024 es una profecía cuyo final ya conocemos.
type BacklogDebtCardProps =
  | {
      mode: 'all-time';
      games: GameListItem[];
      plannedGames: GameListItem[];
      sessions: BacklogSession[];
    }
  | {
      mode: 'year';
      games: GameListItem[];
      plannedGames: GameListItem[];
      stateEvents: StateEventSummary[];
      year: number;
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

// ── El movimiento de un año ────────────────────────────────────────────────
//
// Cada juego tiene una VENTANA DE DEUDA: entra cuando llega a Afterplay
// (addedAt — da igual si por Plan to Play o directo a la biblioteca sin
// jugar: las dos cosas son deuda por las mismas horas) y sale con el primer
// evento que lo pone en marcha o lo cierra (started/completed/dropped). Con
// esas dos fechas se sabe qué debía cada juego en cualquier instante, y por
// tanto qué entró y qué salió en un año concreto.
//
// La guarda que hace falta con una biblioteca llena de historial retroactivo
// como esta: un juego añadido en 2026 con un "completado en 2015" tiene la
// salida ANTES que la entrada. Ese nunca fue backlog — se descarta entero en
// vez de contarlo como un movimiento negativo imposible.
const TERMINAL_TYPES = new Set(['started', 'completed', 'dropped']);

type DebtWindow = { hours: number; enteredAt: number; leftAt: number | null };

type BacklogMovement = {
  addedHours: number;
  addedCount: number;
  clearedHours: number;
  clearedCount: number;
  netHours: number;
  // Saldo al terminar el año (o AHORA, si es el año en curso).
  endBalanceHours: number;
  balanceIsNow: boolean;
  withoutEstimate: number;
  // El año en que la biblioteca empezó a existir: todo lo que se importó
  // hacia atrás entra como deuda ESE año aunque el juego lleve en tu cuenta
  // desde 2018, así que su cifra no es comparable con la de los demás.
  isFirstYear: boolean;
};

const computeMovement = (
  games: GameListItem[],
  plannedGames: GameListItem[],
  stateEvents: StateEventSummary[],
  year: number,
  now: number,
): BacklogMovement => {
  // Primer evento que saca a cada juego de la deuda. Los replays no
  // molestan: quedarse con el MÁS TEMPRANO ya da el momento en que dejó de
  // estar pendiente por primera vez.
  const exitByGame = new Map<number, number>();
  for (const event of stateEvents) {
    if (!TERMINAL_TYPES.has(event.type)) continue;
    const time = event.occurredAt.getTime();
    const current = exitByGame.get(event.gameId);
    if (current === undefined || time < current) exitByGame.set(event.gameId, time);
  }

  // Los endless fuera, misma regla que el balance: no tienen final que
  // alcanzar, así que nunca son una deuda que se pueda saldar.
  const all = [...games, ...plannedGames].filter((game) => !game.endless);

  const windows: DebtWindow[] = [];
  let withoutEstimate = 0;
  for (const game of all) {
    const enteredAt = game.addedAt.getTime();
    const leftAt = exitByGame.get(game.id) ?? null;
    // Nunca fue backlog: se añadió ya jugado o ya terminado (la salida no es
    // posterior a la entrada).
    if (leftAt !== null && leftAt <= enteredAt) continue;

    const touchesYear =
      new Date(enteredAt).getFullYear() === year ||
      (leftAt !== null && new Date(leftAt).getFullYear() === year);
    if (game.hltbMain === null) {
      if (touchesYear) withoutEstimate++;
      continue;
    }
    windows.push({ hours: game.hltbMain, enteredAt, leftAt });
  }

  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const inYear = (time: number): boolean => time >= yearStart && time < yearEnd;

  let addedHours = 0;
  let addedCount = 0;
  let clearedHours = 0;
  let clearedCount = 0;
  let endBalanceHours = 0;
  // El saldo se corta a HOY si el año todavía no ha terminado: decir "al
  // cerrar 2026" en agosto de 2026 sería inventarse un cierre.
  const balanceAt = Math.min(yearEnd, now);
  const balanceIsNow = now < yearEnd;

  for (const window of windows) {
    if (inYear(window.enteredAt)) {
      addedHours += window.hours;
      addedCount++;
    }
    if (window.leftAt !== null && inYear(window.leftAt)) {
      clearedHours += window.hours;
      clearedCount++;
    }
    // Pendiente en el instante de corte: entró antes y aún no había salido.
    if (window.enteredAt <= balanceAt && (window.leftAt === null || window.leftAt > balanceAt)) {
      endBalanceHours += window.hours;
    }
  }

  const firstAddedAt = all.reduce<number | null>(
    (earliest, game) =>
      earliest === null || game.addedAt.getTime() < earliest ? game.addedAt.getTime() : earliest,
    null,
  );

  return {
    addedHours,
    addedCount,
    clearedHours,
    clearedCount,
    netHours: addedHours - clearedHours,
    endBalanceHours,
    balanceIsNow,
    withoutEstimate,
    isFirstYear: firstAddedAt !== null && new Date(firstAddedAt).getFullYear() === year,
  };
};

export const BacklogDebtCard = (props: BacklogDebtCardProps): React.JSX.Element => {
  // El reloj se lee UNA vez al montar — impuro leerlo en cada render, y el
  // dato no cambia entre repintados (misma razón que abajo).
  const [now] = useState(() => Date.now());

  if (props.mode === 'year') {
    return <MovementCard {...props} now={now} />;
  }
  return <BalanceCard {...props} now={now} />;
};

// ── El movimiento del año ──────────────────────────────────────────────────

const MovementCard = ({
  games,
  plannedGames,
  stateEvents,
  year,
  now,
}: Extract<BacklogDebtCardProps, { mode: 'year' }> & { now: number }): React.JSX.Element => {
  const stats = computeMovement(games, plannedGames, stateEvents, year, now);
  const grew = stats.netHours > 0;
  // Crecer viste el violeta de la deuda; encoger, el verde de la casa — es
  // LA lectura de la tarjeta y tiene que verse antes de leer el número.
  const netColor = grew ? VIOLET : GREEN;
  const moved = stats.addedCount > 0 || stats.clearedCount > 0;
  const maxSide = Math.max(stats.addedHours, stats.clearedHours, 1);

  return (
    <StatCard className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-bold text-foreground">Backlog movement</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            What you took on versus what you cleared in {year}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger className="flex-none text-muted-foreground/60 hover:text-foreground">
            <Info size={13} />
          </TooltipTrigger>
          <TooltipContent>
            Main Story times from HowLongToBeat. A game joins your backlog when it enters Afterplay
            and leaves it the moment you start, finish or drop it — games added already played never
            count. Endless games are left out, and these are today&apos;s HowLongToBeat estimates,
            not the ones from back then.
          </TooltipContent>
        </Tooltip>
      </div>

      {!moved ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <Hourglass size={26} className="text-muted-foreground/40" />
          <div className="mt-2.5 text-[13px] font-semibold text-foreground">
            Your backlog didn&apos;t move in {year}.
          </div>
          <div className="mt-1 max-w-64 text-[11.5px] text-muted-foreground">
            Nothing new took it on, nothing came off it.
          </div>
        </div>
      ) : (
        <div className="mt-3.5 flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-7">
          <div className="flex-none sm:w-64">
            <div className="flex items-baseline gap-2.5">
              {grew ? (
                <TrendingUp size={26} color={netColor} className="self-center" />
              ) : (
                <TrendingDown size={26} color={netColor} className="self-center" />
              )}
              <span className="text-[42px] font-extrabold tabular-nums" style={{ color: netColor }}>
                {grew ? '+' : '−'}
                {Math.abs(Math.round(stats.netHours))}
              </span>
              <span className="text-[14px] text-muted-foreground">hours</span>
            </div>
            <div className="mt-0.5 text-[12.5px] font-semibold text-muted-foreground">
              {stats.netHours === 0
                ? 'you broke even'
                : grew
                  ? 'your backlog grew'
                  : 'you gained ground on it'}
            </div>
            {stats.withoutEstimate > 0 && (
              <div className="mt-1.5 text-[11px] text-muted-foreground/70">
                + {pluralize(stats.withoutEstimate, 'game')} with no HowLongToBeat estimate
              </div>
            )}
            {/* El aviso que hace honesta la comparación entre años: el año en
                que empezaste a usar Afterplay se lleva de golpe todo lo que
                importaste hacia atrás y sigue pendiente. */}
            {stats.isFirstYear && (
              <div className="mt-1.5 text-[11px] text-muted-foreground/70">
                Your first year here — everything you imported counts as taken on now
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2 border-white/5 sm:border-l sm:pl-7">
            <MovementSide
              label="Took on"
              hours={stats.addedHours}
              count={stats.addedCount}
              max={maxSide}
              color={VIOLET}
            />
            <MovementSide
              label="Cleared"
              hours={stats.clearedHours}
              count={stats.clearedCount}
              max={maxSide}
              color={GREEN}
            />
            <div className="mt-0.5 flex items-center justify-between text-[11.5px]">
              <span className="text-muted-foreground">
                {stats.balanceIsNow ? `${year} so far` : `Ended ${year} owing`}
              </span>
              <span className="font-semibold tabular-nums" style={{ color: GRAY }}>
                {formatHours(stats.endBalanceHours)}
              </span>
            </div>
          </div>
        </div>
      )}
    </StatCard>
  );
};

// Un lado del movimiento (lo que entró / lo que salió), con su barra
// proporcional al lado mayor — el desequilibrio entre los dos ES la noticia.
const MovementSide = ({
  label,
  hours,
  count,
  max,
  color,
}: {
  label: string;
  hours: number;
  count: number;
  max: number;
  color: string;
}): React.JSX.Element => (
  <div className="flex items-center gap-2.5">
    <span className="w-27 flex-none text-[12px] text-muted-foreground">{label}</span>
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)]"
        style={{ width: `${(hours / max) * 100}%`, background: color }}
      />
    </div>
    <span className="w-30 flex-none text-right text-[12px] font-bold tabular-nums text-foreground">
      {formatHours(hours)}
      <span className="ml-1 font-normal text-muted-foreground">· {count}</span>
    </span>
  </div>
);

// ── El balance de siempre (All Time) ───────────────────────────────────────

const BalanceCard = ({
  games,
  plannedGames,
  sessions,
  now,
}: Extract<BacklogDebtCardProps, { mode: 'all-time' }> & { now: number }): React.JSX.Element => {
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
