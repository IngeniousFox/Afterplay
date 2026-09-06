import { cn } from '../lib/utils';
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock,
  DollarSign,
  Flame,
  Gamepad2,
  Gauge,
  Route,
  TimerReset,
  Trophy,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AchievementsShowcase } from '../components/stats/AchievementsShowcase';
import { ActivityHeatmap } from '../components/stats/ActivityHeatmap';
import { BacklogDebtCard } from '../components/stats/BacklogDebtCard';
import { BacklogFlowChart } from '../components/stats/BacklogFlowChart';
import { Journey } from '../components/stats/Journey';
import { CompletedGallery } from '../components/stats/CompletedGallery';
import { GameAgeDonut } from '../components/stats/GameAgeDonut';
import { GenreRadar } from '../components/stats/GenreRadar';
import { HltbCompareList } from '../components/stats/HltbCompareList';
import { HoursByMonthChart } from '../components/stats/HoursByMonthChart';
import { MostPlayedList } from '../components/stats/MostPlayedList';
import { SessionLengthHistogram } from '../components/stats/SessionLengthHistogram';
import { SpendByMonthChart } from '../components/stats/SpendByMonthChart';
import { StatusBreakdown } from '../components/stats/StatusBreakdown';
import { StreakCard } from '../components/stats/StreakCard';
import { WhenDoYouPlayChart } from '../components/stats/WhenDoYouPlayChart';
import {
  YearMetricComparison,
  type YearComparisonBaseline,
} from '../components/stats/YearOverYearCompare';
import type { Year } from '../components/stats/YearPicker';
import { YearPicker } from '../components/stats/YearPicker';
import { GameCover } from '../components/GameCover';
import { useGames, usePlannedGames } from '../hooks/games';
import { useSessions } from '../hooks/sessions';
import { useSpendEvents } from '../hooks/spend';
import { useStateEvents } from '../hooks/stateEvents';
import { useCountUp } from '../hooks/useCountUp';
import { useImageSrc } from '../hooks/useImageSrc';
import { AMBER, BLUE, GREEN, VIOLET } from '../lib/colors';
import { yearsDesc } from '../lib/dateMath';
import { formatHours, formatMoney } from '../lib/format';
import { mapGenreToAxis } from '../lib/genreAxes';
import { hasMeasuredDuration } from '../lib/sessionStats';
import { sessionActivity } from '../lib/sessionActivity';
import { yearTotals } from '../lib/statsTotals';
import { revealClass, revealStyle } from '../lib/styles';
import { GameStats } from './GameStats';

// (yearTotals se mudó a lib/statsTotals.ts: es LA regla de las cifras y ahora
// la comparten esta pantalla y la del modo TV — dos sitios pintando el mismo
// número no pueden calcularlo cada uno por su cuenta.)

type HeadlineGame = {
  id: number;
  title: string;
  heroUrl: string | null;
  coverUrl: string | null;
  hours: number;
};

type StatsChapterId = 'pulse' | 'cast' | 'milestones' | 'pace' | 'backlog';

type StatsRecord = {
  key: string;
  Icon: typeof Clock;
  label: string;
  value: string;
  detail: string;
  accent: string;
};

const StatsRecordDeck = ({ records }: { records: StatsRecord[] }): React.JSX.Element => (
  <section
    className="afterplay-stats-record-deck grid grid-cols-4 gap-2.5 [@media(max-width:_1120px)]:grid-cols-2"
    aria-label="Archive records"
  >
    {records.map(({ key, Icon, label, value, detail, accent }, index) => (
      <div
        key={key}
        className={cn(
          'afterplay-stats-record-card relative isolate min-w-0 overflow-hidden pt-3.5 px-[15px] pb-[15px] rounded-[14px]',
          '[--record-accent:#2fdc7e] border border-white/[0.085]',
          '[background:linear-gradient(145deg,rgba(255,255,255,0.038),rgba(255,255,255,0.009)),#0e100f]',
          '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.025),0_12px_32px_rgba(0,0,0,0.16)]',
          '[transition:transform_260ms_cubic-bezier(0.22,1,0.36,1),border-color_220ms_ease,box-shadow_220ms_ease]',
          "before:content-[''] before:absolute before:-z-1 before:-top-15 before:-right-13.75 before:w-37.5 before:h-37.5",
          'before:rounded-full before:opacity-14 before:bg-[var(--record-accent)] before:[filter:blur(34px)]',
          'before:[transition:opacity_220ms_ease,transform_350ms_cubic-bezier(0.22,1,0.36,1)]',
          "after:content-[''] after:absolute after:-top-0.25 after:right-3.5 after:left-3.5 after:h-px after:opacity-35",
          'after:[background:linear-gradient(90deg,transparent,var(--record-accent),transparent)]',
          'hover:border-[color-mix(in_srgb,var(--record-accent)_34%,rgba(255,255,255,0.09))]',
          'hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.04),0_20px_42px_rgba(0,0,0,0.27)]',
          'hover:[transform:translateY(-4px)]',
          'hover:before:opacity-25 hover:before:[transform:scale(1.18)]',
          'motion-reduce:animate-none motion-reduce:transition-none motion-reduce:before:animate-none',
          'motion-reduce:before:transition-none',
        )}
        style={{ '--record-accent': accent } as React.CSSProperties}
      >
        <div className="afterplay-stats-record-index absolute top-[13px] right-[13px] text-[11px] font-black tracking-[0.13em] text-white/12">
          R{String(index + 1).padStart(2, '0')}
        </div>
        <div
          className={cn(
            'afterplay-stats-record-icon flex w-[31px] h-[31px] items-center justify-center rounded-[9px]',
            'text-[color:var(--record-accent)]',
            'bg-[color-mix(in_srgb,var(--record-accent)_11%,transparent)]',
            '[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--record-accent)_25%,transparent)]',
            '[transition:transform_260ms_cubic-bezier(0.22,1,0.36,1)]',
            '[.afterplay-stats-record-card:hover_&]:[transform:translateY(-2px)_rotate(-4deg)_scale(1.06)]',
            'motion-reduce:animate-none motion-reduce:transition-none',
          )}
        >
          <Icon size={15} />
        </div>
        <div className="mt-4 text-[11px] font-black tracking-[.18em] text-white/45 uppercase">
          {label}
        </div>
        <div className="mt-1 truncate text-[21px] font-black tracking-[-.035em] text-white tabular-nums">
          {value}
        </div>
        <div className="mt-1 truncate text-[11.5px] text-white/48">{detail}</div>
      </div>
    ))}
  </section>
);

const HeadlineMetric = ({
  Icon,
  label,
  value,
  accent,
  comparison,
}: {
  Icon: typeof Gamepad2;
  label: string;
  value: string;
  accent: string;
  comparison?: React.ReactNode;
}): React.JSX.Element => (
  <div
    className={cn(
      'afterplay-stats-metric min-w-0 px-4 py-3.5',
      'first:pl-0 last:pr-0',
      'relative [transition:background-color_190ms_ease,transform_220ms_cubic-bezier(0.22,1,0.36,1)]',
      "before:content-[''] before:absolute before:-top-0.25 before:right-[20%] before:left-[20%] before:h-px",
      'before:opacity-0 before:[background:linear-gradient(90deg,transparent,rgba(47,220,126,0.72),transparent)]',
      'before:[transition:opacity_180ms_ease]',
      'hover:bg-white/[0.025] hover:[transform:translateY(-2px)]',
      'hover:before:opacity-100',
      '[.afterplay-stats-metric_+_&]:border-l [.afterplay-stats-metric_+_&]:border-l-[rgba(255,255,255,0.075)]',
      'motion-reduce:animate-none motion-reduce:transition-none',
    )}
  >
    {/* La estructura label -> siguiente hermano value se mantiene también
        como contrato accesible para las pruebas de cifras derivadas. */}
    <div className="flex items-center gap-1.75">
      <Icon size={12} style={{ color: accent }} />
      <span className="truncate text-[11px] font-extrabold tracking-[.17em] text-white/48 uppercase">
        {label}
      </span>
    </div>
    <div className="mt-1.25 truncate text-[20px] font-black tracking-[-.025em] text-white tabular-nums">
      {value}
    </div>
    {comparison}
  </div>
);

// Las 4 cifras de cabecera con su contador animado. Componente aparte por
// RENDIMIENTO, no por orden — y el porqué es sutil, así que va escrito:
//
// useCountUp reprinta a 60 fps durante 700 ms, o sea unos 42 renders seguidos
// justo mientras entra la pantalla. El compilador de React memoiza POR
// EXPRESIÓN, y toda la rama de overview de abajo es UNA sola expresión (el
// `view === 'journey' ? … : <>…</>`), así que vive en una única entrada de
// caché. Con los cuatro valores animados leídos ahí dentro, esos 42 frames
// invalidaban esa entrada entera: se volvían a crear las 18 tarjetas de la
// pantalla (heatmap, las cuatro gráficas, galería, vitrina de logros, flujo
// de backlog…) y a reinvocar sus 18 componentes, 42 veces, para que subieran
// cuatro números. Construir ese árbol cuesta 35 ms en frío con la biblioteca
// real (333 juegos, 3.000 sesiones, medido con react-dom/server); caliente es
// bastante menos, pero se pagaba en la peor ventana posible — la de la
// animación de entrada, donde cualquier frame perdido se ve.
//
// Con los contadores encerrados aquí, el árbol de Stats se construye UNA vez
// y los 42 frames solo tocan estas cuatro tarjetas.
const HeaderMetrics = ({
  totalGames,
  totalHours,
  totalSpent,
  costPerHour,
  gamesLabel,
  spentLabel,
  comparison,
}: {
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
  gamesLabel: string;
  spentLabel: string;
  comparison?: YearComparisonBaseline;
}): React.JSX.Element => {
  // Contadores animados de las 4 métricas — mismo count-up que las stats de
  // un juego; al cambiar el filtro de año vuelven a subir hacia el valor
  // nuevo (el key por año de la pantalla remonta este componente).
  const animatedGames = useCountUp(totalGames);
  const animatedHours = useCountUp(totalHours);
  const animatedSpent = useCountUp(totalSpent);
  const animatedCost = useCountUp(costPerHour ?? 0);

  return (
    <div
      className={cn(
        'afterplay-stats-records -mx-6 grid grid-cols-2 px-6',
        'sm:grid-cols-4',
        'border-t border-t-[rgba(255,255,255,0.09)]',
        '[background:linear-gradient(90deg,rgba(0,0,0,0.3),rgba(255,255,255,0.025))] [backdrop-filter:blur(15px)]',
        revealClass,
      )}
      style={revealStyle(0)}
    >
      <HeadlineMetric
        Icon={Gamepad2}
        label={gamesLabel}
        value={String(Math.round(animatedGames))}
        accent={BLUE}
        comparison={
          comparison && (
            <YearMetricComparison
              metric="totalGames"
              current={totalGames}
              previous={comparison.metrics.totalGames}
              previousYear={comparison.year}
            />
          )
        }
      />
      <HeadlineMetric
        Icon={Clock}
        label="TOTAL PLAYTIME"
        value={formatHours(animatedHours)}
        accent={GREEN}
        comparison={
          comparison && (
            <YearMetricComparison
              metric="totalHours"
              current={totalHours}
              previous={comparison.metrics.totalHours}
              previousYear={comparison.year}
            />
          )
        }
      />
      <HeadlineMetric
        Icon={DollarSign}
        label={spentLabel}
        value={formatMoney(animatedSpent)}
        accent={AMBER}
        comparison={
          comparison && (
            <YearMetricComparison
              metric="totalSpent"
              current={totalSpent}
              previous={comparison.metrics.totalSpent}
              previousYear={comparison.year}
            />
          )
        }
      />
      <HeadlineMetric
        Icon={Gauge}
        label="AVG COST / HOUR"
        value={costPerHour !== null ? formatMoney(animatedCost) : '—'}
        accent={VIOLET}
        comparison={
          comparison && (
            <YearMetricComparison
              metric="costPerHour"
              current={costPerHour}
              previous={comparison.metrics.costPerHour}
              previousYear={comparison.year}
            />
          )
        }
      />
    </div>
  );
};

const StatsHero = ({
  year,
  totalGames,
  totalHours,
  totalSpent,
  costPerHour,
  gamesLabel,
  spentLabel,
  headlineGame,
  onOpenGame,
  comparison,
}: {
  year: Year;
  totalGames: number;
  totalHours: number;
  totalSpent: number;
  costPerHour: number | null;
  gamesLabel: string;
  spentLabel: string;
  headlineGame: HeadlineGame | null;
  onOpenGame: (gameId: number) => void;
  comparison?: YearComparisonBaseline;
}): React.JSX.Element => {
  const heroSrc = useImageSrc(headlineGame?.heroUrl ?? null, 'heroes');
  const coverSrc = useImageSrc(headlineGame?.coverUrl ?? null, 'covers');
  const art = heroSrc ?? coverSrc;
  const share = totalHours > 0 && headlineGame ? headlineGame.hours / totalHours : 0;
  const sharePercent = Math.round(share * 100);
  const currentYear = new Date().getFullYear();
  const periodLabel =
    year === 'all'
      ? 'ALL TIME // ARCHIVE'
      : year === currentYear
        ? `${year} // LIVE`
        : `${year} // COMPLETE`;
  const headline = headlineGame
    ? year === 'all'
      ? `${headlineGame.title} leads your archive.`
      : share >= 0.45
        ? `A deep dive into ${headlineGame.title}.`
        : `${headlineGame.title} set the pace.`
    : 'Your next chapter starts here.';
  const supporting =
    totalHours > 0
      ? `${formatHours(totalHours)} across ${totalGames} ${totalGames === 1 ? 'game' : 'games'}${
          headlineGame
            ? ` · ${headlineGame.title} accounts for ${Math.round(share * 100)}% of the time`
            : ''
        }.`
      : 'Playtime will shape this space as soon as Afterplay has something measured.';

  return (
    <section
      className={cn(
        'afterplay-stats-hero overflow-hidden rounded-[18px] border border-white/[0.1] relative isolate',
        '[background:radial-gradient(circle_at_78%_25%,rgba(47,220,126,0.12),transparent_30%),linear-gradient(135deg,#101511,#090b0a_72%)]',
        '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.055),0_26px_70px_rgba(0,0,0,0.28)]',
        '[transition:border-color_300ms_ease,box-shadow_300ms_ease]',
        "before:content-[''] before:absolute before:z-0 before:inset-0 before:pointer-events-none before:opacity-36",
        'before:[background:repeating-radial-gradient(circle_at_83%_39%,transparent_0_36px,rgba(47,220,126,0.075)_37px,transparent_38px_66px),linear-gradient(115deg,transparent_58%,rgba(255,255,255,0.025)_58.2%,transparent_58.5%)]',
        "after:content-[''] after:absolute after:z-2 after:top-[-35%] after:bottom-[-35%] after:left-[-36%] after:w-[22%]",
        'after:pointer-events-none after:opacity-0',
        'after:[background:linear-gradient(90deg,transparent,rgba(255,255,255,0.075),transparent)]',
        'after:[transform:skewX(-15deg)] after:[transition:left_900ms_cubic-bezier(0.2,0.8,0.2,1),opacity_250ms_ease]',
        'hover:border-[rgba(47,220,126,0.2)]',
        'hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.075),0_28px_80px_rgba(0,0,0,0.34),0_0_50px_rgba(47,220,126,0.04)]',
        'hover:after:left-[116%] hover:after:opacity-100',
        'motion-reduce:after:animate-none motion-reduce:after:transition-none',
      )}
    >
      {art && (
        <img
          src={art}
          alt=""
          className={cn(
            'afterplay-stats-hero-art absolute inset-0 h-full w-full object-cover',
            '[filter:saturate(1.18)_contrast(1.08)_brightness(0.68)] [transform:scale(1.025)]',
            'animate-[afterplay-desktop-art-drift_24s_ease-in-out_infinite_alternate]',
            'motion-reduce:animate-none motion-reduce:transition-none',
            heroSrc ? '' : 'scale-110 blur-xl',
          )}
        />
      )}
      <div
        className={cn(
          'afterplay-stats-hero-scrim absolute inset-0',
          '[background:linear-gradient(90deg,rgba(8,10,9,0.97),rgba(8,10,9,0.78)_45%,rgba(8,10,9,0.18)_82%),linear-gradient(0deg,rgba(8,10,9,0.93),transparent_62%)]',
        )}
      />
      <div
        className="afterplay-stats-hero-watermark absolute z-1 right-[19px] bottom-8 text-[154px] font-[950] leading-[0.75] tracking-[-0.12em] pointer-events-none select-none text-white/[0.025]"
        aria-hidden="true"
      >
        01
      </div>
      <div className="relative z-1 flex min-h-[330px] flex-col justify-end px-6 pt-6 pb-0">
        <div
          className={cn(
            'afterplay-stats-hero-body grid flex-1 grid-cols-[minmax(0,1fr)_190px] items-center gap-7 pb-5',
            '[@media(max-width:_1120px)]:grid-cols-[minmax(0,1fr)_165px] [@media(max-width:_1120px)]:gap-4',
          )}
        >
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-3 py-1.5 text-[11px] font-black tracking-[.2em] text-primary uppercase backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_9px_var(--primary)]" />
              {periodLabel}
            </div>
            <h2 className="mt-3 max-w-[760px] text-[clamp(30px,3.3vw,48px)] leading-[1.01] font-black tracking-[-.055em] text-white">
              {headline}
            </h2>
            <p className="mt-3 max-w-[650px] text-[12.5px] leading-relaxed text-white/62">
              {supporting}
            </p>
          </div>

          {headlineGame ? (
            <button
              type="button"
              onClick={() => onOpenGame(headlineGame.id)}
              className={cn(
                'afterplay-stats-leader group/leader relative overflow-hidden rounded-[15px] border border-white/[0.11]',
                'bg-black/30 p-3 text-left backdrop-blur-md',
                '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.035),0_18px_35px_rgba(0,0,0,0.22)]',
                '[transition:transform_280ms_cubic-bezier(0.22,1,0.36,1),border-color_220ms_ease,background-color_220ms_ease,box-shadow_220ms_ease]',
                '[&:is(button):hover]:border-[rgba(47,220,126,0.32)] [&:is(button):hover]:bg-[rgba(10,18,13,0.58)]',
                '[&:is(button):hover]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.055),0_20px_44px_rgba(0,0,0,0.34),0_0_28px_rgba(47,220,126,0.07)]',
                '[&:is(button):hover]:[transform:translateY(-4px)_rotate(0.35deg)]',
                'motion-reduce:animate-none motion-reduce:transition-none',
              )}
              aria-label={`Open ${headlineGame.title}`}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] font-black tracking-[.17em] text-white/45 uppercase">
                <span>#01 · Most played</span>
                <ArrowUpRight
                  size={13}
                  className="transition-[transform,color] group-hover/leader:-translate-y-0.5 group-hover/leader:translate-x-0.5 group-hover/leader:text-primary"
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <GameCover
                  url={headlineGame.coverUrl}
                  className={cn(
                    'afterplay-stats-leader-cover h-24 w-18 flex-none overflow-hidden rounded-[9px] border border-white/12',
                    'shadow-[0_12px_28px_rgba(0,0,0,.5)] [transition:transform_360ms_cubic-bezier(0.22,1,0.36,1)]',
                    '[button.afterplay-stats-leader:hover_&]:[transform:scale(1.045)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                  iconSize={22}
                />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[12px] leading-tight font-extrabold text-white">
                    {headlineGame.title}
                  </div>
                  <div className="mt-1.5 text-[11.5px] font-bold text-white/48 tabular-nums">
                    {formatHours(headlineGame.hours)}
                  </div>
                  <div
                    className={cn(
                      'afterplay-stats-share-ring mt-3 relative flex w-10.5 h-10.5 items-center justify-center rounded-[50%]',
                      '[box-shadow:0_0_20px_rgba(47,220,126,0.08)]',
                      "before:content-[''] before:absolute before:w-8.5 before:h-8.5 before:rounded-full before:bg-[#111512]",
                    )}
                    style={{
                      background: `conic-gradient(${GREEN} ${sharePercent * 3.6}deg, rgba(255,255,255,.075) 0deg)`,
                    }}
                  >
                    <span className="relative z-1 text-white/78 text-[11px] font-black tracking-[-0.02em]">
                      {sharePercent}%
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ) : (
            <div
              className={cn(
                'afterplay-stats-leader flex min-h-35 items-center justify-center rounded-[15px] border border-dashed',
                'border-white/[0.1] bg-black/20 p-5 text-center',
                '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.035),0_18px_35px_rgba(0,0,0,0.22)]',
                '[transition:transform_280ms_cubic-bezier(0.22,1,0.36,1),border-color_220ms_ease,background-color_220ms_ease,box-shadow_220ms_ease]',
                '[&:is(button):hover]:border-[rgba(47,220,126,0.32)] [&:is(button):hover]:bg-[rgba(10,18,13,0.58)]',
                '[&:is(button):hover]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.055),0_20px_44px_rgba(0,0,0,0.34),0_0_28px_rgba(47,220,126,0.07)]',
                '[&:is(button):hover]:[transform:translateY(-4px)_rotate(0.35deg)]',
                'motion-reduce:animate-none motion-reduce:transition-none',
              )}
            >
              <div>
                <Gamepad2 size={22} className="mx-auto text-white/20" />
                <div className="mt-2 text-[11px] font-black tracking-[.15em] text-white/45 uppercase">
                  No leader yet
                </div>
              </div>
            </div>
          )}
        </div>

        <HeaderMetrics
          totalGames={totalGames}
          totalHours={totalHours}
          totalSpent={totalSpent}
          costPerHour={costPerHour}
          gamesLabel={gamesLabel}
          spentLabel={spentLabel}
          comparison={comparison}
        />
      </div>
    </section>
  );
};

const StatsChapterHeading = ({
  id,
  number,
  kicker,
  title,
  description,
}: {
  id: StatsChapterId;
  number: string;
  kicker: string;
  title: string;
  description: string;
}): React.JSX.Element => (
  <div
    id={`stats-${id}`}
    data-stats-chapter={id}
    className="afterplay-stats-chapter-heading mt-10 mb-4 gap-4 px-0.5 grid grid-cols-[54px_minmax(0,_auto)_minmax(48px,_1fr)] items-center gap-x-4 scroll-mt-4.5"
  >
    <div
      className={cn(
        'afterplay-stats-chapter-number w-13.5 min-w-13.5 text-[43px] font-[950] leading-none tracking-[-0.045em]',
        'text-left',
        'text-[color:rgba(47,220,126,0.12)]',
        '[text-shadow:0_0_24px_rgba(47,220,126,0.05)]',
        '[transition:color_220ms_ease,transform_280ms_cubic-bezier(0.22,1,0.36,1)]',
        '[.afterplay-stats-chapter-heading:hover_&]:text-[color:rgba(47,220,126,0.24)]',
        '[.afterplay-stats-chapter-heading:hover_&]:[transform:translateX(3px)]',
        'motion-reduce:animate-none motion-reduce:transition-none',
      )}
      aria-hidden="true"
    >
      {number}
    </div>
    <div className="min-w-0">
      <div className="text-[11px] font-black tracking-[.22em] text-primary/72 uppercase">
        {kicker}
      </div>
      <h2 className="mt-1 text-[20px] font-extrabold tracking-[-.025em] text-foreground">
        {title}
      </h2>
      <p className="mt-0.75 text-[12px] text-muted-foreground">{description}</p>
    </div>
    <span className="mb-1 hidden h-px min-w-12 flex-1 bg-gradient-to-r from-primary/25 via-white/8 to-transparent sm:block" />
  </div>
);

// Bloque 5B/5C/5D/5E — panel global de Stats: 4 métricas + año activo,
// heatmap de actividad, Most/Top Played, Status Breakdown y Genre Radar.
// Filtrar a un juego concreto (columna de nav) lleva a GameStats.tsx, un
// panel bastante distinto — este archivo solo decide cuál de los dos tocan.
export const Stats = (): React.JSX.Element => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gameParam = searchParams.get('game');
  const selectedGameId = gameParam ? Number(gameParam) : null;

  const [selectedYear, setSelectedYear] = useState<Year>('all');
  const [view, setView] = useState<'overview' | 'journey'>('overview');
  // El toast de "Your June story is ready" llega con /stats?view=journey (y
  // un ?month= que consume el propio Journey). El parámetro solo EMPUJA a la
  // pestaña al aparecer — mismo patrón de "ajustar estado durante el render"
  // que el reset de página de Sessions: el Journey lo borra de la URL después
  // y la pestaña se queda donde estaba, como si la hubieras pulsado tú.
  const viewParam = searchParams.get('view');
  const [seenViewParam, setSeenViewParam] = useState<string | null>(null);
  if (viewParam !== seenViewParam) {
    setSeenViewParam(viewParam);
    if (viewParam === 'journey') setView('journey');
  }

  const { data: games = [] } = useGames();
  // Solo para la línea "Plan to play" del Backlog flow — el resto de Stats
  // sigue siendo territorio exclusivo de la biblioteca real.
  const { data: plannedGames = [] } = usePlannedGames();
  const { data: sessions = [] } = useSessions();
  const { data: spendEvents = [] } = useSpendEvents();
  const { data: stateEvents = [] } = useStateEvents();

  // El selector de año ofrece cualquier año con ACTIVIDAD de cualquier tipo:
  // sesiones, gastos, cambios de estado (un Beaten de 2019 registrado a mano
  // debe hacer aparecer 2019 aunque no haya sesiones trackeadas), y los años
  // de atribución de horas manuales (ver manualIterations en getGames.ts).
  const years = useMemo(
    () =>
      yearsDesc([
        ...sessions.map((session) => session.startedAt),
        ...spendEvents.map((event) => event.occurredAt),
        ...stateEvents.map((event) => event.occurredAt),
        ...games.flatMap((game) =>
          game.manualIterations.flatMap((manual) =>
            manual.year !== null ? [new Date(manual.year, 6, 1)] : [],
          ),
        ),
      ]),
    [sessions, spendEvents, stateEvents, games],
  );
  // Las 4 métricas de cabecera + su base de horas por juego, para el año
  // elegido. Las mismas cifras se calculan otra vez para el año ANTERIOR
  // (la comparativa de abajo), y tenerlo en una función en vez de dos bloques
  // gemelos evita lo de siempre: arreglar la regla de horas en uno y dejar el
  // otro con la vieja.
  const stats = useMemo(
    () => yearTotals(games, sessions, spendEvents, selectedYear),
    [games, sessions, spendEvents, selectedYear],
  );
  const { hoursByGame, totalGames, totalHours, totalSpent, costPerHour } = stats;

  const gamesLabel = selectedYear === 'all' ? 'GAMES TRACKED' : 'GAMES PLAYED';
  const spentLabel = selectedYear === 'all' ? 'TOTAL SPENT' : `SPENT IN ${selectedYear}`;

  // Comparación con el año anterior — solo tiene sentido con un año concreto
  // filtrado: "All Time" no tiene un "año pasado" contra el que compararse.
  const previousYear = selectedYear === 'all' ? null : selectedYear - 1;
  const previousYearStats = useMemo(
    () => (previousYear === null ? null : yearTotals(games, sessions, spendEvents, previousYear)),
    [previousYear, games, sessions, spendEvents],
  );

  // Solo se enseña si ese año anterior tiene ALGUNA actividad registrada —
  // comparar contra un año vacío saldría siempre "todo menos", ruido sin
  // información real (ej. el primer año que usas la app).
  const showYearCompare =
    previousYear !== null && previousYearStats !== null && years.includes(previousYear);

  const playedEntries = useMemo(
    () =>
      games.map((game) => ({
        id: game.id,
        title: game.title,
        coverUrl: game.coverUrl,
        hours: hoursByGame.get(game.id) ?? 0,
      })),
    [games, hoursByGame],
  );

  // El arte y el titular salen del juego que de verdad lidera la ventana
  // elegida. Con año concreto usa hoursByGame; en All Time esa misma tabla ya
  // incluye el histórico completo. Cero slogans aleatorios: hasta el tono de
  // "deep dive" depende de cuánto del tiempo representa el primero.
  const headlineGame = useMemo<HeadlineGame | null>(() => {
    const leader = playedEntries
      .filter((entry) => entry.hours > 0)
      .sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title))[0];
    if (!leader) return null;
    const game = games.find((candidate) => candidate.id === leader.id);
    if (!game) return null;
    return {
      id: game.id,
      title: game.title,
      heroUrl: game.heroUrl,
      coverUrl: game.coverUrl,
      hours: leader.hours,
    };
  }, [games, playedEntries]);

  const archiveRecords = useMemo<StatsRecord[]>(() => {
    const measured = sessions.filter(
      (session) =>
        hasMeasuredDuration(session) &&
        (selectedYear === 'all' || session.startedAt.getFullYear() === selectedYear),
    );
    const { longest, biggestDay, busiestMonth } = sessionActivity(measured);
    const peakDay = biggestDay ? [biggestDay.dayMs, biggestDay.seconds] : null;
    const peakMonth = busiestMonth ? [busiestMonth.monthKey, busiestMonth.seconds] : null;
    const peakMonthDate = peakMonth
      ? new Date(Math.floor(peakMonth[0] / 12), peakMonth[0] % 12, 1)
      : null;
    const completions = stateEvents.filter(
      (event) =>
        event.type === 'completed' &&
        (selectedYear === 'all' || event.occurredAt.getFullYear() === selectedYear),
    );
    const completedGames = new Set(completions.map((event) => event.gameId));

    return [
      {
        key: 'longest-session',
        Icon: TimerReset,
        label: 'Longest session',
        value: longest ? formatHours((longest.durationSec ?? 0) / 3600) : '—',
        detail: longest?.gameTitle ?? 'No measured session yet',
        accent: GREEN,
      },
      {
        key: 'peak-day',
        Icon: Flame,
        label: 'Hottest day',
        value: peakDay ? formatHours(peakDay[1] / 3600) : '—',
        detail: peakDay
          ? new Date(peakDay[0]).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: selectedYear === 'all' ? 'numeric' : undefined,
            })
          : 'No active day yet',
        accent: AMBER,
      },
      {
        key: 'peak-month',
        Icon: CalendarDays,
        label: 'Peak month',
        value: peakMonthDate
          ? peakMonthDate.toLocaleDateString('en-US', {
              month: 'short',
              year: selectedYear === 'all' ? 'numeric' : undefined,
            })
          : '—',
        detail: peakMonth ? `${formatHours(peakMonth[1] / 3600)} played` : 'No active month yet',
        accent: BLUE,
      },
      {
        key: 'finishes',
        Icon: Trophy,
        label: 'Finish line',
        value: String(completions.length),
        detail:
          completions.length > 0
            ? `${completedGames.size} ${completedGames.size === 1 ? 'game' : 'games'} crossed it`
            : 'No finishes in this period',
        accent: VIOLET,
      },
    ];
  }, [selectedYear, sessions, stateEvents]);

  // Donut de edad de juegos — misma base year-aware (hoursByGame) que
  // Most/Top Played y Genre Radar.
  const ageEntries = useMemo(
    () =>
      games.map((game) => ({
        hours: hoursByGame.get(game.id) ?? 0,
        releaseYear: game.releaseYear,
      })),
    [games, hoursByGame],
  );

  // Genre Radar — cada juego cuenta para el eje de su género principal
  // (genres[0]), con las horas del año activo. Respeta el filtro de año
  // porque usa hoursByGame, que ya lo respeta. Juegos sin género reconocido
  // (mapGenreToAxis devuelve null) no cuentan para ningún eje.
  const minutesByAxis = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const game of games) {
      const axis = mapGenreToAxis(game.genres?.[0] ?? null);
      if (axis === null) continue;
      const hours = hoursByGame.get(game.id) ?? 0;
      totals[axis] = (totals[axis] ?? 0) + hours * 60;
    }
    return totals;
  }, [games, hoursByGame]);

  if (selectedGameId !== null) {
    return (
      <GameStats
        gameId={selectedGameId}
        onOpenGame={() => navigate(`/games/${selectedGameId}`)}
        onClearFilter={() => navigate('/stats')}
      />
    );
  }

  return (
    <div
      className={cn(
        'afterplay-stats-screen h-full overflow-y-auto px-7.5 pt-6.5 pb-16 relative isolate overflow-x-hidden',
        'scroll-smooth',
        '[background:radial-gradient(circle_at_76%_-8%,rgba(47,220,126,0.085),transparent_34%),radial-gradient(circle_at_8%_45%,rgba(124,134,200,0.05),transparent_28%),#090b0a]',
        "before:content-[''] before:absolute before:z-0 before:inset-0 before:pointer-events-none before:opacity-22",
        'before:[background-image:linear-gradient(rgba(255,255,255,0.017)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.017)_1px,transparent_1px)]',
        'before:[background-size:42px_42px] before:[mask-image:linear-gradient(to_bottom,black,transparent_52%)]',
        "after:content-[''] after:absolute after:z-0 after:top-107.5 after:-right-30 after:w-90 after:h-90",
        'after:rounded-full after:pointer-events-none after:opacity-22',
        'after:[background:radial-gradient(circle,rgba(47,220,126,0.18),transparent_67%)] after:[filter:blur(18px)]',
        'after:animate-[afterplay-stats-ambient_12s_ease-in-out_infinite_alternate]',
        'motion-reduce:after:animate-none motion-reduce:after:transition-none',
      )}
    >
      {/* key por año: cambiar el filtro remonta el árbol — la cascada de
          entrada y los contadores vuelven a animar con los datos nuevos. */}
      <div
        key={view === 'overview' ? `${view}-${String(selectedYear)}` : view}
        className="relative z-1 mx-auto max-w-[1180px]"
      >
        <header className="afterplay-stats-topbar mb-5 flex items-end justify-between gap-5">
          <div>
            <div className="text-[11px] font-black tracking-[.24em] text-primary/72 uppercase">
              The long game
            </div>
            <h1 className="mt-0.5 text-[28px] font-black tracking-[-.04em] text-foreground">
              {view === 'overview' ? 'Stats' : 'Your gaming journey'}
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {view === 'overview'
                ? 'The rhythm, records and shape of your play history'
                : 'The games you played, the paths you took, and the ones you returned to'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <div
              className={cn(
                'afterplay-stats-view-switch flex rounded-[10px] border border-input bg-black/15 p-1 backdrop-blur-md',
                '[transition:border-color_180ms_ease,background-color_180ms_ease,color_180ms_ease,box-shadow_180ms_ease,transform_180ms_cubic-bezier(0.22,1,0.36,1)]',
                'hover:border-white/14 hover:bg-white/[0.025]',
              )}
            >
              <button
                type="button"
                onClick={() => setView('overview')}
                className={cn(
                  'afterplay-stats-view-button flex items-center gap-1.75 rounded-[7px] px-3 py-1.75 text-[12px] font-bold',
                  '[transition:border-color_180ms_ease,background-color_180ms_ease,color_180ms_ease,box-shadow_180ms_ease,transform_180ms_cubic-bezier(0.22,1,0.36,1)]',
                  'hover:text-foreground! hover:[transform:translateY(-1px)]',
                  'motion-reduce:animate-none motion-reduce:transition-none',
                )}
                style={
                  view === 'overview'
                    ? {
                        background: 'rgba(47,220,126,.12)',
                        color: GREEN,
                        boxShadow: 'inset 0 0 0 1px rgba(47,220,126,.32)',
                      }
                    : { color: 'var(--muted-foreground)' }
                }
              >
                <BarChart3 size={13} />
                Overview
              </button>
              <button
                type="button"
                onClick={() => setView('journey')}
                className={cn(
                  'afterplay-stats-view-button flex items-center gap-1.75 rounded-[7px] px-3 py-1.75 text-[12px] font-bold',
                  '[transition:border-color_180ms_ease,background-color_180ms_ease,color_180ms_ease,box-shadow_180ms_ease,transform_180ms_cubic-bezier(0.22,1,0.36,1)]',
                  'hover:text-foreground! hover:[transform:translateY(-1px)]',
                  'motion-reduce:animate-none motion-reduce:transition-none',
                )}
                style={
                  view === 'journey'
                    ? {
                        background: 'rgba(133,163,214,.13)',
                        color: BLUE,
                        boxShadow: 'inset 0 0 0 1px rgba(133,163,214,.34)',
                      }
                    : { color: 'var(--muted-foreground)' }
                }
              >
                <Route size={13} />
                Journey
              </button>
            </div>

            {view === 'overview' && (
              <YearPicker years={years} value={selectedYear} onChange={setSelectedYear} />
            )}
          </div>
        </header>

        {view === 'journey' ? (
          <Journey
            games={games}
            sessions={sessions}
            stateEvents={stateEvents}
            onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
          />
        ) : (
          <>
            <div className={revealClass} style={revealStyle(0)}>
              <StatsHero
                year={selectedYear}
                totalGames={totalGames}
                totalHours={totalHours}
                totalSpent={totalSpent}
                costPerHour={costPerHour}
                gamesLabel={gamesLabel}
                spentLabel={spentLabel}
                headlineGame={headlineGame}
                onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
                comparison={
                  showYearCompare && previousYear !== null && previousYearStats !== null
                    ? { year: previousYear, metrics: previousYearStats }
                    : undefined
                }
              />
            </div>

            <div className={`mt-4 ${revealClass}`} style={revealStyle(1)}>
              <StatsRecordDeck records={archiveRecords} />
            </div>

            <StatsChapterHeading
              id="pulse"
              number="01"
              kicker="Your pulse"
              title="How the time moved"
              description="Days, months and habits — the rhythm underneath the totals."
            />
            <div className={revealClass} style={revealStyle(2)}>
              <ActivityHeatmap sessions={sessions} year={selectedYear} />
            </div>

            <div
              className={`afterplay-stats-split mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5 [@media(max-width:_1040px)]:grid-cols-1 ${revealClass}`}
              style={revealStyle(3)}
            >
              <HoursByMonthChart sessions={sessions} year={selectedYear} />
              <StreakCard sessions={sessions} year={selectedYear} />
            </div>

            <div
              className={`afterplay-stats-split mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5 [@media(max-width:_1040px)]:grid-cols-1 ${revealClass}`}
              style={revealStyle(4)}
            >
              <SpendByMonthChart spendEvents={spendEvents} year={selectedYear} />
              <WhenDoYouPlayChart sessions={sessions} year={selectedYear} />
            </div>

            <StatsChapterHeading
              id="cast"
              number="02"
              kicker="The cast"
              title="The games that defined it"
              description="Leaders, finishes and the shape of the library behind the hours."
            />
            <div className={revealClass} style={revealStyle(5)}>
              <MostPlayedList
                entries={playedEntries}
                onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
              />
            </div>

            <div
              className={`afterplay-stats-split mt-4.5 grid grid-cols-[1.3fr_1fr] gap-4.5 [@media(max-width:_1040px)]:grid-cols-1 ${revealClass}`}
              style={revealStyle(6)}
            >
              {selectedYear === 'all' ? (
                <StatusBreakdown mode="all-time" games={games} />
              ) : (
                <StatusBreakdown mode="year" stateEvents={stateEvents} year={selectedYear} />
              )}
              <GenreRadar minutesByAxis={minutesByAxis} />
            </div>

            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(7)}>
              <CompletedGallery
                stateEvents={stateEvents}
                games={games}
                year={selectedYear}
                onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
              />
            </div>

            <StatsChapterHeading
              id="milestones"
              number="03"
              kicker="Milestones"
              title="The cabinet"
              description="Rare unlocks, perfect games and the moments that stood out."
            />
            <div className={revealClass} style={revealStyle(8)}>
              <AchievementsShowcase
                year={selectedYear}
                onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
              />
            </div>

            <StatsChapterHeading
              id="pace"
              number="04"
              kicker="Pace"
              title="How you actually play"
              description="Your sessions against estimates, without turning either into a target."
            />
            <div
              className={`afterplay-stats-split grid grid-cols-[1.3fr_1fr] gap-4.5 [@media(max-width:_1040px)]:grid-cols-1 ${revealClass}`}
              style={revealStyle(9)}
            >
              <HltbCompareList
                games={games}
                stateEvents={stateEvents}
                sessions={sessions}
                year={selectedYear}
                onOpenGame={(gameId) => navigate(`/games/${gameId}`)}
              />
              <SessionLengthHistogram sessions={sessions} year={selectedYear} variant="overview" />
            </div>

            <StatsChapterHeading
              id="backlog"
              number="05"
              kicker="The long game"
              title="What entered, what left, what waits"
              description="Backlog as history and balance — information, never a guilt counter."
            />
            <div className={revealClass} style={revealStyle(10)}>
              <BacklogFlowChart
                games={games}
                plannedGames={plannedGames}
                stateEvents={stateEvents}
                year={selectedYear}
              />
            </div>

            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(11)}>
              {selectedYear === 'all' ? (
                <BacklogDebtCard
                  mode="all-time"
                  games={games}
                  plannedGames={plannedGames}
                  sessions={sessions}
                />
              ) : (
                <BacklogDebtCard
                  mode="year"
                  games={games}
                  plannedGames={plannedGames}
                  stateEvents={stateEvents}
                  year={selectedYear}
                />
              )}
            </div>

            <div className={`mt-4.5 ${revealClass}`} style={revealStyle(12)}>
              <GameAgeDonut entries={ageEntries} year={selectedYear} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
