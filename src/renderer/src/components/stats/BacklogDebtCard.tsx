import { cn } from '../../lib/utils';
import { Hourglass, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { PACE_WINDOW_DAYS, type SessionStats } from '../../../../shared/domain/sessionStats';
import type { GameListItem, StateEventSummary } from '../../../../shared/types';
import { DAY_MS } from '../../lib/dateMath';
import { formatHours, pluralize } from '../../lib/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { StatCard } from './StatCard';
import type { GameId } from '../../../../shared/entityIds';

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
      // El ritmo reciente, ya calculado por el main (F-41).
      pace: SessionStats['pace'];
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
// ritmo de AHORA, no el de cuando tenías más tiempo libre. La ventana
// (PACE_WINDOW_DAYS) es la que usa el main para sumar los segundos recientes.

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
  pace: SessionStats['pace'],
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
  const firstSessionAt = pace.firstSessionAt;
  const paceStart = firstSessionAt === null ? null : Math.max(windowStart, firstSessionAt);
  const trackedDays = paceStart === null ? 0 : (now - paceStart) / DAY_MS;

  // Las sesiones que arrancaron desde el inicio de la ventana: si la primera
  // es posterior, son todas, y si no, son las de los últimos 90 días.
  const recentSeconds = paceStart === null ? 0 : pace.recentSeconds;
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
  const exitByGame = new Map<GameId, number>();
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
  const moved = stats.addedCount > 0 || stats.clearedCount > 0;
  const maxSide = Math.max(stats.addedHours, stats.clearedHours, 1);

  return (
    <StatCard className="afterplay-debt-card afterplay-movement-card relative flex h-full flex-col overflow-hidden">
      <div className="afterplay-debt-header flex items-start justify-between gap-4">
        <div>
          <div className="text-[16px] leading-tight font-semibold text-bone">Backlog movement</div>
          <div className="text-small text-dust">
            What you took on versus what you cleared in {year}, in HowLongToBeat hours
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger
            className="flex-none text-dust hover:text-bone"
            aria-label="About this card"
          >
            <Info size={14} />
          </TooltipTrigger>
          <TooltipContent>
            Main Story times from HowLongToBeat. A game joins your backlog when it enters Afterplay
            and leaves it the moment you start, finish or drop it. Games added already played never
            count. Endless games are left out, and these are today&apos;s HowLongToBeat estimates,
            not the ones from back then.
          </TooltipContent>
        </Tooltip>
      </div>

      {!moved ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <Hourglass size={26} className="text-dust" />
          <div className="mt-2.5 text-body font-semibold text-bone">
            Your backlog didn&apos;t move in {year}.
          </div>
          <div className="mt-1 max-w-64 text-small text-dust">
            Nothing new took it on, nothing came off it.
          </div>
        </div>
      ) : (
        <div className="afterplay-movement-stage mt-4 grid gap-8 min-[1040px]:grid-cols-[minmax(230px,0.7fr)_minmax(0,1.6fr)]">
          <div className="afterplay-movement-hero">
            <div className="flex items-center gap-2.5">
              {grew ? (
                <TrendingUp size={26} className="text-phosphor" />
              ) : (
                <TrendingDown size={26} className="text-tube" />
              )}
              <span
                className={cn(
                  'font-display text-[56px] leading-none font-bold tabular-nums',
                  grew ? 'text-phosphor' : 'text-tube',
                )}
              >
                {grew ? '+' : '−'}
                {Math.abs(Math.round(stats.netHours))}
              </span>
              <span className="text-body text-dust">hours</span>
            </div>
            <div className="mt-1 text-body text-bone">
              {stats.netHours === 0
                ? 'You broke even'
                : grew
                  ? 'Your backlog grew'
                  : 'You gained ground on it'}
            </div>
            {stats.withoutEstimate > 0 && (
              <div className="mt-1.5 text-small text-dust">
                + {pluralize(stats.withoutEstimate, 'game')} with no HowLongToBeat estimate
              </div>
            )}
            {/* El aviso que hace honesta la comparación entre años: el año en
                que empezaste a usar Afterplay se lleva de golpe todo lo que
                importaste hacia atrás y sigue pendiente. */}
            {stats.isFirstYear && (
              <div className="mt-1.5 text-small text-dust">
                Your first year here: everything you imported counts as taken on now
              </div>
            )}
            <div className="mt-3 text-small text-dust">Information, never a guilt counter.</div>
          </div>

          <div className="afterplay-movement-comparison flex min-w-0 flex-col justify-center gap-4">
            <MovementSide
              label="Entered the backlog"
              hours={stats.addedHours}
              count={stats.addedCount}
              countLabel="added"
              max={maxSide}
              barClass="bg-phosphor"
            />
            <MovementSide
              label="Left it (started, completed or dropped)"
              hours={stats.clearedHours}
              count={stats.clearedCount}
              countLabel="cleared"
              max={maxSide}
              barClass="bg-tube"
            />
            <div className="flex items-center justify-between border-t border-line pt-2.5 text-body">
              <span className="text-dust">
                {stats.balanceIsNow ? `Balance, ${year} so far` : `Ended ${year} owing`}
              </span>
              <span className="font-semibold text-bone tabular-nums">
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
  countLabel,
  max,
  barClass,
}: {
  label: string;
  hours: number;
  count: number;
  countLabel: string;
  max: number;
  barClass: string;
}): React.JSX.Element => (
  <div className="afterplay-movement-side">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="text-small text-dust">{label}</span>
      <span className="text-small text-dust">
        {pluralize(count, 'game')} {countLabel}
      </span>
    </div>
    <div className="font-display text-[36px] leading-none font-bold text-bone tabular-nums">
      {formatHours(hours)}
    </div>
    <div className="afterplay-movement-track mt-1.5 h-2.5 overflow-hidden rounded-[2px] bg-inset">
      <div
        className={cn(
          'afterplay-movement-fill h-full origin-left rounded-[2px]',
          'animate-[afterplay-grow-x_600ms_var(--ease-out)_backwards] motion-reduce:animate-none',
          barClass,
        )}
        style={{ width: `${(hours / max) * 100}%` }}
      />
    </div>
  </div>
);

// ── El balance de siempre (All Time) ───────────────────────────────────────

const BalanceCard = ({
  games,
  plannedGames,
  pace,
  now,
}: Extract<BacklogDebtCardProps, { mode: 'all-time' }> & { now: number }): React.JSX.Element => {
  const stats = computeBacklog(games, plannedGames, pace, now);
  const halfwayDate = stats.weeks !== null ? new Date(now + (stats.weeks / 2) * 7 * DAY_MS) : null;

  return (
    <StatCard className="afterplay-debt-card relative flex h-full flex-col overflow-hidden">
      <div className="afterplay-debt-header flex items-start justify-between gap-4">
        <div className="flex items-start gap-2.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[16px] leading-tight font-semibold text-bone">Backlog debt</div>
              <span className="afterplay-debt-mode rounded-sm border border-line-strong px-1.5 py-0.5 text-micro text-dust">
                Pace forecast
              </span>
            </div>
            <div className="text-small text-dust">
              Everything you want to play plus everything you haven&apos;t touched
            </div>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger
            className="flex-none text-dust hover:text-bone"
            aria-label="About this card"
          >
            <Info size={14} />
          </TooltipTrigger>
          <TooltipContent>
            Main Story times from HowLongToBeat, divided by how much you&apos;ve actually played
            recently (up to the last {PACE_WINDOW_DAYS} days, or since tracking began). Games
            you&apos;ve already started don&apos;t count, and neither do endless ones.
          </TooltipContent>
        </Tooltip>
      </div>

      {stats.pendingCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <Hourglass size={26} className="text-dust" />
          <div className="mt-2.5 text-body font-semibold text-bone">Nothing waiting for you.</div>
          <div className="mt-1 max-w-64 text-small text-dust">
            Every game in your library is either started or finished.
          </div>
        </div>
      ) : (
        <div className="afterplay-debt-stage mt-4 grid gap-8 min-[1040px]:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.75fr)]">
          <div className="afterplay-debt-hero relative min-w-0">
            <div className="afterplay-debt-kicker text-small text-dust">Estimated playtime</div>
            <div className="afterplay-debt-total flex items-baseline gap-1.5">
              <strong
                className="font-display text-[clamp(48px,5vw,64px)] leading-none font-bold text-bone tabular-nums"
                data-debt-hours
              >
                {Math.round(stats.totalHours).toLocaleString('en-US')}
              </strong>
              <span className="font-display text-[24px] leading-none font-bold text-dust">h</span>
            </div>
            <div className="afterplay-debt-human mt-1.5 text-small text-dust">
              {stats.weeks !== null ? (
                <>
                  <span className="font-semibold text-bone">≈ {humanizeWeeks(stats.weeks)}</span> at
                  your current pace
                </>
              ) : stats.trackedDays < MIN_TRACKED_DAYS ? (
                'Play for a week and Afterplay can estimate how long it will take'
              ) : (
                'Not enough recent playtime to estimate a pace'
              )}
            </div>
            <div className="afterplay-debt-coverage mt-2 flex flex-wrap gap-x-2 gap-y-1 text-small text-dust">
              <span>
                {stats.estimatedCount}/{stats.pendingCount} games estimated
              </span>
              {stats.withoutEstimate > 0 && (
                <span>+ {pluralize(stats.withoutEstimate, 'game')} outside the forecast</span>
              )}
            </div>
          </div>

          <div className="afterplay-debt-forecast min-w-0">
            <div className="afterplay-debt-forecast-head flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
              <div>
                <span className="block text-small text-dust">Projected horizon</span>
                <strong
                  className={cn(
                    'block font-display text-[30px] leading-tight font-bold',
                    stats.finishDate ? 'text-phosphor' : 'text-bone',
                  )}
                >
                  {stats.finishDate ? monthYear(stats.finishDate) : 'Not enough signal'}
                </strong>
              </div>
              <div className="afterplay-debt-pace text-right">
                <span className="block text-small text-dust">Recent pace</span>
                <strong className="block font-display text-[30px] leading-tight font-bold text-bone">
                  {stats.hoursPerWeek >= HOURS_PER_WEEK_MIN
                    ? `${formatHours(stats.hoursPerWeek)} a week`
                    : 'Below 30m a week'}
                </strong>
              </div>
            </div>

            {stats.finishDate && halfwayDate ? (
              <div className="afterplay-debt-horizon mx-1 mt-4 mb-4">
                <div className="afterplay-debt-horizon-rail relative h-1.5 rounded-full bg-[linear-gradient(90deg,var(--color-phosphor),rgb(255_179_71/0.25))]">
                  <span
                    className={cn(
                      'afterplay-debt-horizon-beam absolute -top-px left-0 z-2 h-2 w-[16%] rounded-full',
                      'bg-[linear-gradient(90deg,transparent,rgb(255_194_102/0.9),transparent)] blur-[1px]',
                      'animate-[afterplay-debt-beam_3.8s_ease-in-out_infinite] motion-reduce:hidden',
                    )}
                  />
                  <i className="afterplay-debt-horizon-dot afterplay-debt-horizon-dot--start absolute top-1/2 left-0 z-3 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-phosphor" />
                  <i className="afterplay-debt-horizon-dot afterplay-debt-horizon-dot--middle absolute top-1/2 left-1/2 z-3 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-phosphor bg-panel" />
                  <i className="afterplay-debt-horizon-dot afterplay-debt-horizon-dot--end absolute top-1/2 left-full z-3 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-phosphor shadow-glow-bar" />
                </div>
                <div className="afterplay-debt-horizon-labels mt-2 grid grid-cols-3 gap-2 text-small font-semibold text-bone [&>span]:flex [&>span]:min-w-0 [&>span]:flex-col [&>span:last-child]:items-end [&>span:nth-child(2)]:items-center">
                  <span>
                    <small className="text-micro font-normal text-dust">Now</small>
                    Today
                  </span>
                  <span>
                    <small className="text-micro font-normal text-dust">Halfway</small>
                    {monthYear(halfwayDate)}
                  </span>
                  <span>
                    <small className="text-micro font-normal text-dust">Finish line</small>
                    {monthYear(stats.finishDate)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="afterplay-debt-horizon afterplay-debt-horizon--quiet mx-1 mt-4 mb-4 min-h-10.5 rounded-sm border border-dashed border-line-strong p-3 text-center text-small text-dust">
                Keep tracking recent sessions and the horizon will appear here.
              </div>
            )}

            <div className="afterplay-debt-composition flex h-2 gap-0.5 overflow-hidden rounded-[2px] bg-inset [&_span]:min-w-0 [&_span]:origin-left [&_span]:animate-[afterplay-grow-x_600ms_var(--ease-out)_backwards] motion-reduce:[&_span]:animate-none">
              <span
                className="bg-tube"
                style={{
                  width: `${stats.totalHours > 0 ? (stats.unplayedHours / stats.totalHours) * 100 : 0}%`,
                }}
              />
              <span
                className="bg-phosphor"
                style={{
                  width: `${stats.totalHours > 0 ? (stats.plannedHours / stats.totalHours) * 100 : 0}%`,
                }}
              />
            </div>

            <div className="afterplay-debt-sources mt-2 grid grid-cols-2 gap-4">
              <DebtSource
                label="Never touched"
                count={stats.unplayedCount}
                hours={stats.unplayedHours}
                dotClass="bg-tube"
              />
              <DebtSource
                label="Plan to play"
                count={stats.plannedCount}
                hours={stats.plannedHours}
                dotClass="bg-phosphor"
              />
            </div>
          </div>
        </div>
      )}
    </StatCard>
  );
};

// Una de las dos mitades del backlog — el reparto entre "lo que ya tienes" y
// "lo que quieres" es la lectura interesante: dos backlogs de 340h no son
// iguales si uno es todo intención y el otro todo juegos ya comprados.
const DebtSource = ({
  label,
  count,
  hours,
  dotClass,
}: {
  label: string;
  count: number;
  hours: number;
  dotClass: string;
}): React.JSX.Element => (
  <div
    className="afterplay-debt-source relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-3 border-t border-line pt-2 pl-4"
    data-debt-source={label}
  >
    <span className="truncate text-body font-semibold text-bone">{label}</span>
    <small className="truncate text-small text-dust">{formatHours(hours)} estimated</small>
    <i className={cn('absolute top-3.5 left-0 size-2 rounded-full', dotClass)} />
    <strong
      className="col-start-2 row-span-2 row-start-1 self-center font-display text-[32px] leading-none font-bold text-bone tabular-nums"
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
