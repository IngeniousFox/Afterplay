import { cn } from '../../lib/utils';
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
  unplayedHours: number;
  plannedHours: number;
  estimatedCount: number;
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
  const unplayedHours = unplayed.reduce((sum, game) => sum + (game.hltbMain ?? 0), 0);
  const plannedHours = planned.reduce((sum, game) => sum + (game.hltbMain ?? 0), 0);

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
    unplayedHours,
    plannedHours,
    estimatedCount: withEstimate.length,
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
    <StatCard
      className={cn(
        'afterplay-debt-card afterplay-movement-card flex h-full flex-col relative overflow-hidden',
        '[background:radial-gradient(circle_at_16%_120%,_rgba(124,_134,_200,_0.1),_transparent_34%),_radial-gradient(circle_at_88%_-45%,_rgba(47,_220,_126,_0.045),_transparent_36%),_var(--card)]',
        "[&::before]:content-[''] [&::before]:absolute [&::before]:inset-0 [&::before]:pointer-events-none",
        '[&::before]:opacity-[0.22]',
        '[&::before]:[background-image:linear-gradient(rgba(255,_255,_255,_0.018)_1px,_transparent_1px)]',
        '[&::before]:[background-size:100%_34px]',
        '[&::before]:[mask-image:linear-gradient(90deg,_transparent,_#000_38%,_#000)]',
        '[&_>_*]:relative [&_>_*]:z-1',
      )}
    >
      <div className="afterplay-debt-header flex items-start justify-between gap-4">
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
        <div className="afterplay-movement-stage grid grid-cols-[minmax(230px,_0.75fr)_minmax(0,_1.6fr)] gap-4.5 mt-[15px] [@media(max-width:_1040px)]:grid-cols-1">
          <div
            className={cn(
              'afterplay-movement-hero py-3.5 px-4 rounded-[12px]',
              '[border:1px_solid_color-mix(in_srgb,_var(--movement-accent)_20%,_rgba(255,_255,_255,_0.05))]',
              '[background:linear-gradient(_135deg,_color-mix(in_srgb,_var(--movement-accent)_9%,_transparent),_rgba(0,_0,_0,_0.11)_)]',
            )}
            style={{ '--movement-accent': netColor } as React.CSSProperties}
          >
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

          <div
            className={cn(
              'afterplay-movement-comparison py-3.5 px-4 rounded-[12px] flex min-w-0 flex-col justify-center gap-[5px]',
              '[border:1px_solid_rgba(255,_255,_255,_0.055)] [background:rgba(0,_0,_0,_0.1)]',
            )}
          >
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
  <div
    className={cn(
      'afterplay-movement-side flex items-center gap-2.5 py-1.5 px-[7px] rounded-[8px]',
      '[transition:background-color_200ms_ease,_transform_240ms_cubic-bezier(0.22,_1,_0.36,_1)]',
      '[&:hover]:[background:rgba(255,_255,_255,_0.025)] [&:hover]:[transform:translateX(2px)]',
      'motion-reduce:animate-none motion-reduce:transition-none',
    )}
  >
    <span className="w-27 flex-none text-[12px] text-muted-foreground">{label}</span>
    <div className="afterplay-movement-track h-1.5 flex-1 overflow-hidden rounded-[99px] [background:rgba(255,_255,_255,_0.055)]">
      <div
        className={cn(
          'afterplay-movement-fill h-full rounded-[inherit] origin-left',
          'animate-[afterplay-grow-x_650ms_cubic-bezier(0.22,_1,_0.36,_1)_backwards]',
          'motion-reduce:animate-none motion-reduce:transition-none',
        )}
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
  const halfwayDate = stats.weeks !== null ? new Date(now + (stats.weeks / 2) * 7 * DAY_MS) : null;

  return (
    <StatCard
      className={cn(
        'afterplay-debt-card flex h-full flex-col relative overflow-hidden',
        '[background:radial-gradient(circle_at_16%_120%,_rgba(124,_134,_200,_0.1),_transparent_34%),_radial-gradient(circle_at_88%_-45%,_rgba(47,_220,_126,_0.045),_transparent_36%),_var(--card)]',
        "[&::before]:content-[''] [&::before]:absolute [&::before]:inset-0 [&::before]:pointer-events-none",
        '[&::before]:opacity-[0.22]',
        '[&::before]:[background-image:linear-gradient(rgba(255,_255,_255,_0.018)_1px,_transparent_1px)]',
        '[&::before]:[background-size:100%_34px]',
        '[&::before]:[mask-image:linear-gradient(90deg,_transparent,_#000_38%,_#000)]',
        '[&_>_*]:relative [&_>_*]:z-1',
      )}
    >
      <div className="afterplay-debt-header flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[14px] font-bold text-foreground">Backlog debt</div>
              <span
                className={cn(
                  'afterplay-debt-mode py-[3px] px-1.5 rounded-[99px] text-[10px] font-black tracking-[0.1em] leading-none',
                  '[border:1px_solid_rgba(124,_134,_200,_0.2)] text-[rgba(167,_175,_231,_0.82)]',
                  '[background:rgba(124,_134,_200,_0.07)]',
                )}
              >
                PACE FORECAST
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Everything you want to play plus everything you haven&apos;t touched
            </div>
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
        <div className="afterplay-debt-stage grid grid-cols-[minmax(245px,_0.78fr)_minmax(0,_1.75fr)] gap-4.5 mt-[15px] [@media(max-width:_1040px)]:grid-cols-1">
          <div
            className={cn(
              'afterplay-debt-hero relative flex min-w-0 items-center gap-[15px] overflow-hidden py-[15px] px-4 rounded-[12px]',
              '[border:1px_solid_rgba(124,_134,_200,_0.15)]',
              '[background:linear-gradient(135deg,_rgba(124,_134,_200,_0.09),_rgba(0,_0,_0,_0.11))]',
              '[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.025)]',
              '[transition:border-color_240ms_ease,_box-shadow_260ms_ease,_transform_300ms_cubic-bezier(0.22,_1,_0.36,_1)]',
              "[&::after]:content-[''] [&::after]:absolute [&::after]:-right-12 [&::after]:-bottom-17 [&::after]:w-37.5",
              '[&::after]:h-37.5 [&::after]:rounded-[50%] [&::after]:pointer-events-none [&::after]:[background:#7c86c8]',
              '[&::after]:opacity-[0.05] [&::after]:[filter:blur(18px)]',
              '[&:hover]:[border-color:rgba(124,_134,_200,_0.28)]',
              '[&:hover]:[box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.04),_0_12px_30px_rgba(0,_0,_0,_0.18)]',
              '[&:hover]:[transform:translateY(-2px)]',
              '[&:hover_.afterplay-debt-hourglass_svg]:[transform:rotate(180deg)]',
              'motion-reduce:animate-none motion-reduce:transition-none',
            )}
          >
            <div
              className={cn(
                'afterplay-debt-hourglass relative flex w-14.5 h-14.5 flex-none items-center justify-center rounded-[50%]',
                '[border:1px_solid_rgba(124,_134,_200,_0.24)] text-[#9ba5ec] [background:rgba(124,_134,_200,_0.075)]',
                '[box-shadow:inset_0_0_18px_rgba(124,_134,_200,_0.06),_0_0_25px_rgba(124,_134,_200,_0.06)]',
                '[&_span]:absolute [&_span]:inset-1.75 [&_span]:[border:1px_dashed_rgba(155,_165,_236,_0.2)]',
                '[&_span]:rounded-[50%] [&_span]:animate-spin [&_span]:[animation-duration:14s]',
                '[&_svg]:relative [&_svg]:z-1 [&_svg]:[filter:drop-shadow(0_0_8px_rgba(155,_165,_236,_0.24))]',
                '[&_svg]:[transition:transform_680ms_cubic-bezier(0.22,_1,_0.36,_1)]',
                'motion-reduce:[&_span]:animate-none motion-reduce:[&_span]:transition-none motion-reduce:[&_svg]:animate-none',
                'motion-reduce:[&_svg]:transition-none',
              )}
              aria-hidden="true"
            >
              <span />
              <Hourglass size={30} strokeWidth={1.7} />
            </div>
            <div className="min-w-0">
              <div className="afterplay-debt-kicker text-white/45 text-[10px] font-black tracking-[0.12em] uppercase">
                ESTIMATED PLAYTIME
              </div>
              <div className="afterplay-debt-total flex items-baseline gap-[7px] mt-px">
                <strong
                  className="text-foreground text-[clamp(34px,_3.5vw,_50px)] font-black tracking-[-0.05em] leading-none [tab-size:4]"
                  data-debt-hours
                >
                  {Math.round(stats.totalHours).toLocaleString('en-US')}
                </strong>
                <span className="text-muted-foreground text-[11px]">hours</span>
              </div>
              <div className="afterplay-debt-human mt-1.5 text-[11px] font-semibold text-muted-foreground">
                {stats.weeks !== null ? (
                  <>
                    <span className="text-[#9ba5ec] font-[850]">
                      ≈ {humanizeWeeks(stats.weeks)}
                    </span>{' '}
                    at your current pace
                  </>
                ) : stats.trackedDays < MIN_TRACKED_DAYS ? (
                  'Play for a week and Afterplay can estimate how long it will take'
                ) : (
                  'Not enough recent playtime to estimate a pace'
                )}
              </div>
              <div className="afterplay-debt-coverage flex flex-wrap gap-y-1 gap-x-2 mt-2 text-[11px] text-white/50">
                <span>
                  {stats.estimatedCount}/{stats.pendingCount} games estimated
                </span>
                {stats.withoutEstimate > 0 && (
                  <span className="text-[rgba(227,_178,_74,_0.8)]">
                    + {pluralize(stats.withoutEstimate, 'game')} outside the forecast
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="afterplay-debt-forecast min-w-0 pt-3 px-3.5 pb-[11px] rounded-[12px] [border:1px_solid_rgba(255,_255,_255,_0.055)] [background:rgba(0,_0,_0,_0.1)]">
            <div
              className={cn(
                'afterplay-debt-forecast-head flex items-start justify-between gap-3.5',
                '[&_span]:text-white/45 [&_span]:text-[10px] [&_span]:font-black [&_span]:tracking-[0.12em]',
                '[&_span]:uppercase',
                '[&_>_div_>_strong]:block [&_>_div_>_strong]:mt-0.75 [&_>_div_>_strong]:text-foreground',
                '[&_>_div_>_strong]:text-[16px] [&_>_div_>_strong]:font-[850]',
              )}
            >
              <div>
                <span>PROJECTED HORIZON</span>
                <strong>
                  {stats.finishDate ? monthYear(stats.finishDate) : 'Not enough signal'}
                </strong>
              </div>
              <div
                className={cn(
                  'afterplay-debt-pace py-[5px] px-2 rounded-[8px] text-right',
                  '[&_span]:text-white/45 [&_span]:text-[10px] [&_span]:font-black [&_span]:tracking-[0.12em]',
                  '[&_span]:uppercase',
                  '[&_strong]:block [&_strong]:mt-0.75',
                  '[border:1px_solid_rgba(124,_134,_200,_0.14)] [background:rgba(124,_134,_200,_0.055)]',
                  '[&_strong]:text-[#a4ade9] [&_strong]:text-[11.5px] [&_strong]:font-extrabold',
                )}
              >
                <span>RECENT PACE</span>
                <strong>
                  {stats.hoursPerWeek >= HOURS_PER_WEEK_MIN
                    ? `${formatHours(stats.hoursPerWeek)} / week`
                    : 'Below 30m / week'}
                </strong>
              </div>
            </div>

            {stats.finishDate && halfwayDate ? (
              <div className="afterplay-debt-horizon mt-4 mx-1 mb-[13px]">
                <div
                  className={cn(
                    'afterplay-debt-horizon-rail relative h-1 rounded-[99px]',
                    '[background:linear-gradient(90deg,_rgba(124,_134,_200,_0.28),_#7c86c8_70%,_#b1b9f1)]',
                    '[box-shadow:0_0_15px_rgba(124,_134,_200,_0.12)]',
                    "[&::after]:content-[''] [&::after]:absolute [&::after]:[inset:-5px_0]",
                    '[&::after]:[background:repeating-linear-gradient(_90deg,_transparent_0,_transparent_calc(12.5%_-_1px),_rgba(255,_255,_255,_0.09)_calc(12.5%_-_1px),_rgba(255,_255,_255,_0.09)_12.5%_)]',
                    '[&::after]:[mask-image:linear-gradient(#0000,_#000_40%,_#000_60%,_#0000)]',
                  )}
                >
                  <span
                    className={cn(
                      'afterplay-debt-horizon-beam absolute z-2 -top-0.5 left-0 w-[16%] h-2 rounded-[99px]',
                      '[background:linear-gradient(90deg,_transparent,_rgba(205,_211,_255,_0.95),_transparent)] [filter:blur(1px)]',
                      'animate-[afterplay-debt-beam_3.8s_ease-in-out_infinite]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                  />
                  <i
                    className={cn(
                      'afterplay-debt-horizon-dot afterplay-debt-horizon-dot--start absolute z-3 top-1/2 w-2 h-2 rounded-[50%]',
                      '[border:2px_solid_#111512] [background:#a5aeea] [box-shadow:0_0_9px_rgba(124,_134,_200,_0.45)]',
                      '[transform:translate(-50%,_-50%)] left-0',
                    )}
                  />
                  <i
                    className={cn(
                      'afterplay-debt-horizon-dot afterplay-debt-horizon-dot--middle absolute z-3 top-1/2 w-2 h-2 rounded-[50%]',
                      '[border:2px_solid_#111512] [background:#a5aeea] [box-shadow:0_0_9px_rgba(124,_134,_200,_0.45)]',
                      '[transform:translate(-50%,_-50%)] left-1/2',
                    )}
                  />
                  <i
                    className={cn(
                      'afterplay-debt-horizon-dot afterplay-debt-horizon-dot--end absolute z-3 top-1/2 w-2 h-2 rounded-[50%]',
                      '[border:2px_solid_#111512] [box-shadow:0_0_9px_rgba(124,_134,_200,_0.45)] [transform:translate(-50%,_-50%)]',
                      'left-full [background:#d2d7ff]',
                    )}
                  />
                </div>
                <div
                  className={cn(
                    'afterplay-debt-horizon-labels grid grid-cols-[repeat(3,_1fr)] mt-[7px] text-[11px] font-bold text-white/[0.52]',
                    '[&_span]:flex [&_span]:flex-col [&_span]:gap-0.25',
                    '[&_span:nth-child(2)]:items-center',
                    '[&_span:last-child]:items-end',
                    '[&_small]:text-white/45 [&_small]:text-[10px] [&_small]:font-black [&_small]:tracking-[0.11em]',
                  )}
                >
                  <span>
                    <small>NOW</small>
                    Today
                  </span>
                  <span>
                    <small>HALFWAY</small>
                    {monthYear(halfwayDate)}
                  </span>
                  <span>
                    <small>FINISH LINE</small>
                    {monthYear(stats.finishDate)}
                  </span>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'afterplay-debt-horizon afterplay-debt-horizon--quiet mt-4 mx-1 mb-[13px] min-h-10.5 p-3.25',
                  '[border:1px_dashed_rgba(255,_255,_255,_0.08)] rounded-[9px] text-muted-foreground text-[10px] text-center',
                )}
              >
                Keep tracking recent sessions and the horizon will appear here.
              </div>
            )}

            <div
              className={cn(
                'afterplay-debt-composition flex h-[5px] gap-0.5 overflow-hidden rounded-[99px]',
                '[background:rgba(255,_255,_255,_0.045)]',
                '[&_span]:min-w-0 [&_span]:rounded-[inherit] [&_span]:[box-shadow:0_0_9px_currentColor] [&_span]:origin-left',
                '[&_span]:animate-[afterplay-grow-x_700ms_cubic-bezier(0.22,_1,_0.36,_1)_backwards]',
                'motion-reduce:[&_span]:animate-none motion-reduce:[&_span]:transition-none',
              )}
            >
              <span
                style={{
                  width: `${stats.totalHours > 0 ? (stats.unplayedHours / stats.totalHours) * 100 : 0}%`,
                  background: BLUE,
                }}
              />
              <span
                style={{
                  width: `${stats.totalHours > 0 ? (stats.plannedHours / stats.totalHours) * 100 : 0}%`,
                  background: VIOLET,
                }}
              />
            </div>

            <div className="afterplay-debt-sources grid grid-cols-2 gap-[7px] mt-[7px]">
              <DebtSource
                label="Never touched"
                count={stats.unplayedCount}
                hours={stats.unplayedHours}
                color={BLUE}
              />
              <DebtSource
                label="Plan to play"
                count={stats.plannedCount}
                hours={stats.plannedHours}
                color={VIOLET}
              />
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
const DebtSource = ({
  label,
  count,
  hours,
  color,
}: {
  label: string;
  count: number;
  hours: number;
  color: string;
}): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-debt-source relative grid grid-cols-[minmax(0,_1fr)_auto] grid-rows-[auto_auto] gap-y-px gap-x-2.5',
      'overflow-hidden pt-2 pr-2.5 pb-2 pl-[13px] rounded-[9px] [border:1px_solid_rgba(255,_255,_255,_0.055)]',
      '[background:rgba(255,_255,_255,_0.018)]',
      '[transition:border-color_200ms_ease,_background-color_200ms_ease,_transform_260ms_cubic-bezier(0.22,_1,_0.36,_1)]',
      '[&:hover]:[border-color:color-mix(in_srgb,_var(--debt-source)_28%,_rgba(255,_255,_255,_0.06))]',
      '[&:hover]:[background:color-mix(in_srgb,_var(--debt-source)_6%,_rgba(255,_255,_255,_0.018))]',
      '[&:hover]:[transform:translateY(-2px)]',
      'motion-reduce:animate-none motion-reduce:transition-none',
    )}
    data-debt-source={label}
    style={{ '--debt-source': color } as React.CSSProperties}
  >
    <span className="overflow-hidden text-white/[0.72] text-[11.5px] font-[750] text-ellipsis whitespace-nowrap">
      {label}
    </span>
    <small className="overflow-hidden text-muted-foreground text-[11px] text-ellipsis whitespace-nowrap">
      {formatHours(hours)} estimated
    </small>
    <i className="absolute top-2 bottom-2 left-0 w-0.75 rounded-[0_99px_99px_0] [background:var(--debt-source)] opacity-[0.72]" />
    <strong
      className="[grid-row:1_/_3] [grid-column:2] self-center text-(--debt-source) text-[20px] font-black leading-none [tab-size:3]"
      data-debt-count
    >
      {count}
    </strong>
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
