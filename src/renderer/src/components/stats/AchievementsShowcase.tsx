import { cn } from '../../lib/utils';
import { ChevronRight, Crown, Medal, Sparkles, Target, Trophy } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import type { AchievementsOverview, TimeFormat } from '../../../../shared/types';
import { useAchievementsOverview } from '../../hooks/achievements';
import { useTimeFormat } from '../../hooks/settings';
import { useImageSrc } from '../../hooks/useImageSrc';
import { requestAchievementFlash } from '../../lib/achievementFlash';
import { percentLabel, rarityAccent, ULTRA_VIOLET } from '../../lib/achievements';
import { AMBER, GREEN } from '../../lib/colors';
import { formatByPrecision } from '../../lib/format';
import { floatingPanelClass } from '../../lib/styles';
import { GameCover } from '../GameCover';
import { StatsPager } from './StatsPager';
import { usePagedYear } from './usePagedYear';

// El bloque de trofeos de Stats (LOGROS-IDEAS.md §3-4): la vitrina de la
// CASA entera — salón de la fama, perfil de rareza, muro de 100% y "almost
// there". Respeta el filtro de año de la pantalla: con un año elegido, la
// fama y la rareza hablan solo de ese año (fechas fiables), el muro pasa a
// "perfeccionados ese año" (por la fecha del último logro), y la columna
// derecha cambia de gráfica de años a mes-a-mes + los juegos del año. Todo
// con el lenguaje interactivo del resto de Stats: el hover del Status
// Breakdown en el perfil de rareza, el CategoryBarChart de Hours per month
// para los meses, y la galería del Completed para los 100%.

const CARD_CLASS = 'rounded-[14px] border border-border bg-card px-5 py-4.5';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Carátulas por página del muro de 100% — el mismo grid-cols-8 del Completed.
const PERFECT_PER_PAGE = 8;

// ── Meses apilados por rareza ───────────────────────────────────────────────
// Rarity needs stacked bars. Keep the plot compact while its panel stretches
// to match the adjacent games list; center the plot instead of stretching empty tracks.

const MONTH_BAR_AREA = 104;
const MONTH_LABEL_SPACE = 18;

const RarityMonthChart = ({
  months,
  year,
  yearTotal,
}: {
  months: NonNullable<AchievementsOverview['unlockedByMonth']>;
  year: number;
  yearTotal: number;
}): React.JSX.Element => {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null);
  const maxTotal = Math.max(0, ...months.map((month) => month.total));
  const peakMonth = maxTotal > 0 ? months.findIndex((month) => month.total === maxTotal) : -1;
  const hovered = hoveredMonth !== null ? months[hoveredMonth] : null;

  return (
    <div className={`${CARD_CLASS} flex h-full flex-col`} data-testid="achievement-month-card">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13.5px] font-bold text-foreground">Unlocks by month</div>
        {/* Con un mes bajo el ratón, la cabecera es SU detalle con los
            colores de cada cubo; si no, el total del año. */}
        {hovered && hovered.total > 0 ? (
          <div className="text-[11px] font-semibold tabular-nums">
            <span className="text-foreground">
              {MONTH_LABELS[hovered.month]} · {hovered.total}
            </span>
            {hovered.rare > 0 && <span style={{ color: AMBER }}> · {hovered.rare} rare</span>}
            {hovered.ultra > 0 && (
              <span style={{ color: ULTRA_VIOLET }}> · {hovered.ultra} ultra</span>
            )}
          </div>
        ) : (
          <div className="text-[11px] font-semibold text-muted-foreground tabular-nums">
            {yearTotal} in {year}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-center">
        <div className="mt-3.5 flex flex-none items-end gap-1.5" style={{ height: MONTH_BAR_AREA }}>
          {months.map((entry, index) => {
            const isHovered = hoveredMonth === index;
            const barPx =
              maxTotal > 0 && entry.total > 0
                ? Math.max(5, (entry.total / maxTotal) * (MONTH_BAR_AREA - MONTH_LABEL_SPACE))
                : 0;
            const showLabel = entry.total > 0 && (isHovered || index === peakMonth);
            const segmentPx = (count: number): number =>
              entry.total > 0 ? (count / entry.total) * barPx : 0;

            return (
              <div
                key={entry.month}
                onMouseEnter={() => setHoveredMonth(index)}
                onMouseLeave={() => setHoveredMonth(null)}
                className="relative flex h-full flex-1 items-end justify-center"
              >
                {/* La pista de fondo, tenue — presencia del mes vacío sin
                  hacer de lápida. */}
                <div
                  className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-7 rounded-[6px] transition-colors duration-150"
                  style={{
                    height: MONTH_BAR_AREA - MONTH_LABEL_SPACE,
                    background: isHovered ? 'rgba(255,255,255,.055)' : 'rgba(255,255,255,.025)',
                  }}
                />
                {showLabel && (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 text-[11.5px] font-bold whitespace-nowrap tabular-nums"
                    style={{
                      bottom: barPx + 4,
                      color: isHovered ? 'var(--foreground)' : GREEN,
                    }}
                  >
                    {entry.total}
                  </span>
                )}
                {/* La columna apilada: común de base, raro encima, ultra
                  coronando — el mismo orden y los mismos colores que el
                  perfil de rareza de la vitrina. */}
                {barPx > 0 && (
                  <div
                    className="relative flex w-full max-w-7 flex-col justify-end overflow-hidden rounded-[6px] transition-[filter] duration-150"
                    style={{
                      height: barPx,
                      filter:
                        hoveredMonth !== null && !isHovered
                          ? 'saturate(.45) brightness(.7)'
                          : 'none',
                      boxShadow: isHovered ? '0 0 18px rgba(47,220,126,.28)' : 'none',
                    }}
                  >
                    <div style={{ height: segmentPx(entry.ultra), background: ULTRA_VIOLET }} />
                    <div style={{ height: segmentPx(entry.rare), background: AMBER }} />
                    <div
                      style={{
                        height: segmentPx(entry.common),
                        background: `linear-gradient(180deg, ${GREEN}, #1f9e5c)`,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex flex-none gap-1.5 border-t border-white/5 pt-1.75">
          {months.map((entry, index) => (
            <div
              key={entry.month}
              className="flex-1 text-center text-[11.5px]"
              style={{
                color: hoveredMonth === index ? 'var(--foreground)' : 'var(--muted-foreground)',
                fontWeight: hoveredMonth === index ? 700 : 400,
              }}
            >
              {MONTH_LABELS[entry.month]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Salón de la fama: el medallero ──────────────────────────────────────────
// Antes era una lista de filas de texto con iconos de 22px; ahora es un
// medallero donde el arte se ve (LOGROS-REDISENO §3). Mismos datos, tamaño
// legible: medallón de 56px, rango, porcentaje, nombre y juego. Solo cuenta
// lo CONSEGUIDO — un salón de la fama con un logro que no tienes sería una
// vitrina enseñando la pieza que falta (el propio query ya filtra así).

const FameMedallion = ({
  entry,
  rank,
  onOpenGame,
}: {
  entry: AchievementsOverview['hallOfFame'][number];
  rank: number;
  onOpenGame: (gameId: number) => void;
}): React.JSX.Element => {
  const src = useImageSrc(entry.iconUrl, 'achievements');
  const accent = rarityAccent(entry.globalPercent);
  return (
    <button
      type="button"
      onClick={() => {
        requestAchievementFlash(entry.achievementId);
        onOpenGame(entry.gameId);
      }}
      title={`${entry.displayName} — ${entry.gameTitle}`}
      className={cn(
        'afterplay-fame-medallion group/fame relative flex flex-col items-center gap-2 overflow-hidden rounded-[13px]',
        'border border-white/[0.07] px-2 pt-3.5 pb-3 text-center isolate outline-none',
        '[transition:transform_320ms_cubic-bezier(0.22,1,0.36,1),border-color_240ms_ease,box-shadow_280ms_ease,background-color_240ms_ease]',
        "before:content-[''] before:absolute before:-z-1 before:inset-0 before:pointer-events-none before:opacity-0",
        'before:[background:radial-gradient(circle_at_50%_34%,color-mix(in_srgb,var(--fame-accent)_18%,transparent),transparent_58%)]',
        'before:[transition:opacity_260ms_ease]',
        '[&:is(:hover,:focus-visible)]:border-[color-mix(in_srgb,var(--fame-accent)_62%,rgba(255,255,255,0.08))]',
        '[&:is(:hover,:focus-visible)]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.05),0_12px_26px_rgba(0,0,0,0.3),0_0_22px_color-mix(in_srgb,var(--fame-accent)_8%,transparent)]',
        '[&:is(:hover,:focus-visible)]:[transform:translateY(-3px)] [&:is(:hover,:focus-visible)::before]:opacity-100',
        'motion-reduce:animate-none motion-reduce:transition-none motion-reduce:before:animate-none',
        'motion-reduce:before:transition-none',
      )}
      style={
        {
          '--fame-accent': accent,
          background: `linear-gradient(180deg, ${accent}0d, rgba(255,255,255,.015))`,
        } as CSSProperties
      }
    >
      <span
        className={cn(
          'afterplay-fame-rank absolute top-1.75 left-2.25 text-[11.5px] font-extrabold text-muted-foreground/70 tabular-nums',
          '[transition:color_220ms_ease,transform_280ms_cubic-bezier(0.22,1,0.36,1)]',
          '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:text-[color:var(--fame-accent)]',
          '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:[transform:translateX(1px)]',
          'motion-reduce:animate-none motion-reduce:transition-none',
        )}
      >
        #{rank}
      </span>
      {/* Chapa esmaltada, no rótulo: aro del acento + especular + sombra.
          Sin halo difuminado — el neón ya se purgó de esta casa. */}
      <div
        className={cn(
          'afterplay-fame-icon relative h-14 w-14 overflow-hidden rounded-full',
          '[transition:transform_340ms_cubic-bezier(0.22,1,0.36,1),filter_240ms_ease]',
          '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:[filter:drop-shadow(0_7px_11px_rgba(0,0,0,0.34))]',
          '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:[transform:translateY(-2px)_scale(1.045)]',
          'motion-reduce:animate-none motion-reduce:transition-none',
        )}
        style={{
          boxShadow: `inset 0 0 0 2px ${accent}85, inset 0 1px 0 rgba(255,255,255,.3), 0 6px 16px rgba(0,0,0,.5)`,
        }}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className={cn(
              'afterplay-fame-image h-full w-full object-cover',
              '[transition:filter_260ms_ease,transform_420ms_cubic-bezier(0.22,1,0.36,1)]',
              '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:[filter:saturate(1.13)_brightness(1.05)]',
              '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:[transform:scale(1.035)]',
              'motion-reduce:animate-none motion-reduce:transition-none',
            )}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={16} className="text-muted-foreground/40" />
          </div>
        )}
        <span
          aria-hidden
          className={cn(
            'afterplay-fame-glint pointer-events-none absolute inset-0 rounded-full',
            '[transition:opacity_240ms_ease,transform_420ms_cubic-bezier(0.22,1,0.36,1)]',
            '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:opacity-82',
            '[.afterplay-fame-medallion:is(:hover,:focus-visible)_&]:[transform:translate3d(3px,-2px,0)]',
            'motion-reduce:animate-none motion-reduce:transition-none',
          )}
          style={{
            background:
              'radial-gradient(120% 85% at 30% 12%, rgba(255,255,255,.24), transparent 45%)',
          }}
        />
      </div>
      <span className="text-[13px] font-extrabold tabular-nums" style={{ color: accent }}>
        {percentLabel(entry.globalPercent)}
      </span>
      <span className="line-clamp-2 h-8 w-full text-[11.5px] leading-[1.32] font-semibold text-[#c4cac6]">
        {entry.displayName}
      </span>
      <span className="w-full truncate text-[11px] text-muted-foreground/75">
        {entry.gameTitle}
      </span>
    </button>
  );
};

// ── El hero: tu logro más raro ──────────────────────────────────────────────
// La pieza que preside Stats, con el mismo lenguaje que la vitrina de la
// ficha: medalla grande, lavado del acento, píldora del porcentaje. El tinte
// sale de SU rareza — casi siempre violeta, que para eso es la más rara.

const RarestHero = ({
  entry,
  totalUnlocked,
  year,
  timeFormat,
  onOpenGame,
}: {
  entry: AchievementsOverview['hallOfFame'][number];
  totalUnlocked: number;
  year: number | 'all';
  timeFormat: TimeFormat;
  onOpenGame: (gameId: number) => void;
}): React.JSX.Element => {
  const src = useImageSrc(entry.iconUrl, 'achievements');
  const accent = rarityAccent(entry.globalPercent);
  return (
    <button
      type="button"
      onClick={() => {
        // Se pide el logro ANTES de navegar: el mensajero guarda la peticion y
        // la seccion de logros la recoge al montar (lib/achievementFlash).
        requestAchievementFlash(entry.achievementId);
        onOpenGame(entry.gameId);
      }}
      className="relative flex h-full flex-col justify-center overflow-hidden rounded-[14px] border px-6 py-5.5 text-left transition-transform duration-200 hover:-translate-y-0.5"
      style={{
        borderColor: `${accent}47`,
        background: `linear-gradient(135deg, ${accent}21, rgba(255,255,255,.02) 55%)`,
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 h-57.5 w-57.5 rounded-full"
        style={{ background: `radial-gradient(circle, ${accent}38, transparent 68%)` }}
      />
      <div className="relative flex items-center justify-between gap-2.5">
        <span
          className="flex items-center gap-1.75 text-[11.5px] font-extrabold tracking-[.16em]"
          style={{ color: accent }}
        >
          <Crown size={13} />
          {year === 'all' ? 'YOUR RAREST TROPHY' : `RAREST OF ${year}`}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          of {totalUnlocked.toLocaleString('en-US')} unlocked
        </span>
      </div>
      <div className="relative mt-4.25 flex items-center gap-5">
        <div
          className="relative h-23 w-23 flex-none overflow-hidden rounded-full"
          style={{
            boxShadow: `inset 0 0 0 2px ${accent}b3, inset 0 2px 0 rgba(255,255,255,.3), 0 10px 26px rgba(0,0,0,.55)`,
          }}
        >
          {src ? (
            <img src={src} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <Trophy size={24} className="text-muted-foreground/40" />
            </div>
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(120% 85% at 30% 12%, rgba(255,255,255,.26), transparent 45%)',
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[20px] leading-[1.2] font-extrabold tracking-[-.01em] text-foreground">
            {entry.displayName}
          </div>
          <div className="mt-2 truncate text-[13px] font-semibold text-[#c4cac6]">
            {entry.gameTitle}
          </div>
          <div className="mt-3.25 flex flex-wrap items-center gap-2">
            <span
              className="flex items-center gap-1.25 rounded-full px-3 py-1.25 text-[13px] font-extrabold tabular-nums"
              style={{
                background: `${accent}29`,
                color: accent,
                boxShadow: `inset 0 0 0 1px ${accent}59`,
              }}
            >
              <Sparkles size={10} />
              {percentLabel(entry.globalPercent)} of players
            </span>
            {entry.unlockedAt && (
              <span className="text-[12px] text-muted-foreground">
                {formatByPrecision(entry.unlockedAt, 'day', timeFormat)}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

// ── El anillo de rareza ─────────────────────────────────────────────────────
// De barra apilada de 1.5px a ANILLO, que es el vocabulario que la casa ya
// entiende (la vitrina de la ficha usa uno). Señalar un tramo lo engorda, le
// da una sombra de su color, apaga los otros y cambia el centro por SU cifra
// — el mismo intercambio resumen⇄detalle del Status Breakdown.

const DONUT_SIZE = 168;
const DONUT_BASE = 17;
const DONUT_HOVER = 25;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_HOVER - 6) / 2;
const DONUT_C = 2 * Math.PI * DONUT_RADIUS;

const RarityDonut = ({
  segments,
  hovered,
  onHover,
}: {
  segments: { key: RarityKey; label: string; count: number; color: string }[];
  hovered: RarityKey | null;
  onHover: (key: RarityKey | null) => void;
}): React.JSX.Element => {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0) || 1;
  // El hueco entre arcos solo existe con más de un tramo: un anillo de un
  // solo color con muesca parecería un dato que falta.
  const gap = segments.filter((segment) => segment.count > 0).length > 1 ? 3.5 : 0;
  const hoveredSegment = segments.find((segment) => segment.key === hovered) ?? null;
  // Los arcos se PREcalculan (cada uno arranca donde acabó el anterior): el
  // acumulador no puede vivir dentro del map del JSX — mutar una variable en
  // pleno render es justo lo que el compilador de React prohíbe.
  const arcs: { segment: (typeof segments)[number]; length: number; offset: number }[] = [];
  let accumulated = 0;
  for (const segment of segments) {
    if (segment.count === 0) continue;
    const fraction = segment.count / total;
    arcs.push({
      segment,
      length: Math.max(0, DONUT_C * fraction - gap),
      offset: -accumulated * DONUT_C,
    });
    accumulated += fraction;
  }

  return (
    <div className="relative flex-none" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
      <svg width={DONUT_SIZE} height={DONUT_SIZE} className="-rotate-90 overflow-visible">
        <circle
          cx={DONUT_SIZE / 2}
          cy={DONUT_SIZE / 2}
          r={DONUT_RADIUS}
          fill="none"
          stroke="rgba(255,255,255,.05)"
          strokeWidth={DONUT_BASE}
        />
        {arcs.map(({ segment, length, offset }) => {
          const isHovered = hovered === segment.key;
          const dimmed = hovered !== null && !isHovered;
          return (
            <circle
              key={segment.key}
              cx={DONUT_SIZE / 2}
              cy={DONUT_SIZE / 2}
              r={DONUT_RADIUS}
              fill="none"
              stroke={segment.color}
              strokeWidth={isHovered ? DONUT_HOVER : DONUT_BASE}
              strokeLinecap="butt"
              onMouseEnter={() => onHover(segment.key)}
              onMouseLeave={() => onHover(null)}
              style={{
                strokeDasharray: `${length} ${DONUT_C - length}`,
                strokeDashoffset: offset,
                cursor: 'default',
                opacity: dimmed ? 0.28 : 1,
                filter: isHovered ? `drop-shadow(0 0 9px ${segment.color}aa)` : 'none',
                transition:
                  'stroke-width .22s cubic-bezier(.2,.7,.3,1), opacity .22s ease, filter .22s ease',
                ['--afterplay-ring-c' as string]: `${DONUT_C}`,
                animation: 'afterplay-ring-in .95s cubic-bezier(.22,1,.36,1) 120ms backwards',
              }}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span
          className="text-[32px] leading-none font-extrabold tabular-nums transition-colors duration-200"
          style={{ color: hoveredSegment ? hoveredSegment.color : 'var(--foreground)' }}
        >
          {(hoveredSegment ? hoveredSegment.count : total).toLocaleString('en-US')}
        </span>
        <span
          className="text-[11.5px] font-bold tracking-[.12em] uppercase transition-colors duration-200"
          style={{
            color: hoveredSegment ? hoveredSegment.color : 'var(--muted-foreground)',
            opacity: hoveredSegment ? 0.9 : 0.75,
          }}
        >
          {hoveredSegment ? hoveredSegment.label : 'unlocked'}
        </span>
      </div>
    </div>
  );
};

// ── Almost there ────────────────────────────────────────────────────────────

const MissingIcon = ({
  achievement,
}: {
  achievement: AchievementsOverview['almostThere'][number]['missing'][number];
}): React.JSX.Element => {
  const src = useImageSrc(achievement.iconUrl, 'achievements');
  return (
    <div
      title={`${achievement.displayName}${
        achievement.globalPercent !== null
          ? ` · ${percentLabel(achievement.globalPercent)} of players`
          : ''
      } — click to open it`}
      className={cn(
        'afterplay-almost-missing h-7.5 w-7.5 flex-none overflow-hidden rounded-[7px] opacity-45 grayscale',
        '[box-shadow:inset_0_0_0_1px_rgba(255,255,255,0.1)]',
        '[transition:opacity_200ms_ease,filter_220ms_ease,transform_260ms_cubic-bezier(0.22,1,0.36,1)]',
        '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:opacity-68',
        '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:[filter:grayscale(0.72)] hover:opacity-95!',
        'hover:[filter:grayscale(0.25)]! hover:[transform:translateY(-1px)]',
        'motion-reduce:animate-none motion-reduce:transition-none',
      )}
      style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1)' }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Trophy size={10} className="text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};

const AlmostThereRow = ({
  game,
  index,
  onOpenGame,
}: {
  game: AchievementsOverview['almostThere'][number];
  index: number;
  onOpenGame: (gameId: number) => void;
}): React.JSX.Element => {
  const src = useImageSrc(game.coverUrl, 'covers');
  const percent = Math.round((game.unlocked / game.total) * 100);
  const remaining = game.total - game.unlocked;
  const hiddenMissing = Math.max(0, remaining - game.missing.length);
  return (
    <button
      type="button"
      onClick={() => onOpenGame(game.gameId)}
      className={cn(
        'afterplay-almost-card group relative flex min-w-0 items-center gap-3.5 overflow-hidden rounded-[13px] border',
        'border-white/[0.07] px-3.5 py-3 text-left min-h-27.5 outline-none',
        '[background:linear-gradient(120deg,rgba(47,220,126,0.045),rgba(255,255,255,0.018))]',
        '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.02)]',
        '[transition:transform_300ms_cubic-bezier(0.22,1,0.36,1),border-color_220ms_ease,box-shadow_260ms_ease,background-color_220ms_ease]',
        '[&:is(:hover,:focus-visible)]:border-[rgba(47,220,126,0.25)]',
        '[&:is(:hover,:focus-visible)]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.035),0_13px_30px_rgba(0,0,0,0.24)]',
        '[&:is(:hover,:focus-visible)]:[transform:translateY(-2px)]',
        'motion-reduce:animate-none motion-reduce:transition-none',
      )}
      style={{ '--almost-progress': `${percent}%` } as CSSProperties}
      aria-label={`Open ${game.title}, ${percent}% complete`}
    >
      {src && (
        <img
          src={src}
          alt=""
          aria-hidden
          className={cn(
            'afterplay-almost-art absolute top-[-34%] right-[-7%] w-[54%] h-[170%] object-cover opacity-8',
            '[filter:blur(8px)_saturate(1.2)] [transform:scale(1.08)]',
            '[transition:opacity_300ms_ease,transform_700ms_cubic-bezier(0.22,1,0.36,1)]',
            '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:opacity-14',
            '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:[transform:scale(1.13)_translateX(-3px)]',
            'motion-reduce:animate-none motion-reduce:transition-none',
          )}
        />
      )}
      <span
        className={cn(
          'afterplay-almost-glow absolute inset-0 pointer-events-none opacity-0',
          '[background:radial-gradient(circle_at_78%_20%,rgba(47,220,126,0.1),transparent_42%)]',
          '[transition:opacity_260ms_ease]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:opacity-100',
          'motion-reduce:animate-none motion-reduce:transition-none',
        )}
        aria-hidden="true"
      />

      <div
        className={cn(
          'afterplay-almost-cover relative z-1 h-20 w-14 flex-none overflow-hidden rounded-[7px] border border-white/10',
          '[box-shadow:0_9px_22px_rgba(0,0,0,0.32)]',
          '[transition:transform_300ms_cubic-bezier(0.22,1,0.36,1),border-color_220ms_ease,box-shadow_260ms_ease]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:border-[rgba(47,220,126,0.32)]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:[box-shadow:0_11px_25px_rgba(0,0,0,0.4)]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:[transform:translateY(-1px)]',
          'motion-reduce:animate-none motion-reduce:transition-none',
        )}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={12} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="relative z-1 min-w-0 flex-1 self-stretch py-0.5">
        <div className="text-[11px] font-black tracking-[.16em] text-primary/60 uppercase">
          Final stretch · #{String(index + 1).padStart(2, '0')}
        </div>
        <div className="mt-1 truncate text-[13.5px] font-extrabold tracking-[-.01em] text-foreground">
          {game.title}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] tabular-nums">
          <span className="font-semibold text-muted-foreground">
            {game.unlocked} of {game.total} unlocked
          </span>
          <span className="font-bold text-primary">{remaining} left</span>
        </div>
        <div className="afterplay-almost-track mt-1.75 h-1 overflow-hidden rounded-[99px] bg-white/[0.065]">
          <span
            className={cn(
              'block w-[var(--almost-progress)] h-full rounded-[inherit]',
              '[background:linear-gradient(90deg,rgba(47,220,126,0.5),#2fdc7e)] [box-shadow:0_0_12px_rgba(47,220,126,0.22)]',
              'origin-left animate-[afterplay-grow-x_750ms_cubic-bezier(0.22,1,0.36,1)_backwards]',
              'motion-reduce:animate-none motion-reduce:transition-none',
            )}
          />
        </div>
        <div className="mt-2 flex items-center gap-1.25">
          {game.missing.map((achievement) => (
            <span
              key={achievement.displayName}
              onClick={() => requestAchievementFlash(achievement.achievementId)}
            >
              <MissingIcon achievement={achievement} />
            </span>
          ))}
          {hiddenMissing > 0 && (
            <span className="flex h-7.5 min-w-7.5 items-center justify-center rounded-[7px] border border-white/8 bg-black/20 px-1 text-[11px] font-bold text-muted-foreground tabular-nums">
              +{hiddenMissing}
            </span>
          )}
        </div>
      </div>

      <div
        className={cn(
          'afterplay-almost-gauge relative z-1 flex size-15 flex-none items-center justify-center rounded-full',
          '[box-shadow:0_0_18px_rgba(47,220,126,0.08)] [transition:filter_240ms_ease,box-shadow_260ms_ease]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:[filter:brightness(1.08)]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:[box-shadow:0_0_22px_rgba(47,220,126,0.14)]',
          'motion-reduce:animate-none motion-reduce:transition-none',
        )}
        style={{ background: `conic-gradient(${GREEN} ${percent}%, rgba(255,255,255,.07) 0)` }}
      >
        <div className="flex size-12 flex-col items-center justify-center rounded-full bg-[#101311]">
          <strong className="text-[13px] leading-none font-black text-foreground tabular-nums">
            {percent}
          </strong>
          <span className="mt-0.5 text-[11px] leading-none font-bold tracking-[.04em] text-primary/85 uppercase">
            done
          </span>
        </div>
      </div>
      <ChevronRight
        size={13}
        className={cn(
          'afterplay-almost-arrow absolute right-2 bottom-1.75 z-1 text-muted-foreground/25',
          '[transition:color_180ms_ease,transform_260ms_cubic-bezier(0.22,1,0.36,1)]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:text-[color:#2fdc7e]',
          '[.afterplay-almost-card:is(:hover,:focus-visible)_&]:[transform:translateX(2px)]',
          'motion-reduce:animate-none motion-reduce:transition-none',
        )}
      />
    </button>
  );
};

// ── Juegos del año ──────────────────────────────────────────────────────────
// El relleno con sustancia de la columna derecha en modo año: dónde cazaste.

const TopGameRow = ({
  game,
  maxTotal,
  onOpenGame,
}: {
  game: NonNullable<AchievementsOverview['topGames']>[number];
  maxTotal: number;
  onOpenGame: (gameId: number) => void;
}): React.JSX.Element => {
  const src = useImageSrc(game.coverUrl, 'covers');
  return (
    <button
      type="button"
      onClick={() => onOpenGame(game.gameId)}
      className="flex w-full flex-none items-center gap-2.5 rounded-[9px] px-1.5 py-1.25 text-left transition-colors duration-150 hover:bg-white/[0.04]"
    >
      <div className="h-9 w-6.5 flex-none overflow-hidden rounded-[5px]">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={10} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-bold text-foreground">{game.title}</div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${(game.total / maxTotal) * 100}%`,
              background: `linear-gradient(90deg, ${GREEN}99, ${GREEN})`,
            }}
          />
        </div>
      </div>
      <span className="flex-none text-right text-[11px] font-bold text-foreground tabular-nums">
        {game.total}
        {game.rare > 0 && <span style={{ color: AMBER }}> ·{game.rare}</span>}
      </span>
    </button>
  );
};

// ── El bloque entero ────────────────────────────────────────────────────────

type RarityKey = 'common' | 'rare' | 'ultra';

export const AchievementsShowcase = ({
  year,
  onOpenGame,
}: {
  year: number | 'all';
  onOpenGame: (gameId: number) => void;
}): React.JSX.Element | null => {
  const { data } = useAchievementsOverview(year);
  const { data: timeFormat = '24h' } = useTimeFormat();
  // El hover sincronizado del perfil de rareza — el MISMO lenguaje que el
  // Status Breakdown: tramo y leyenda se señalan mutuamente, el resto se
  // atenúa y la cabecera enseña el detalle del señalado.
  const [hoveredRarity, setHoveredRarity] = useState<RarityKey | null>(null);
  // El hover de la cosecha por año — mismo lenguaje: señalar apaga el resto
  // y la cabecera cambia al desglose del año señalado.
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  // Página del muro de 100% (el mismo pager del Completed) — el hook vive
  // aquí y no tras el early-return: las reglas de hooks mandan.
  const { page, direction, goToPage } = usePagedYear(year);

  // Sin logros no hay vitrina — ni una sección vacía que explique por qué.
  // Con año: si ese año no cayó ninguno (ni se perfeccionó nada), silencio.
  if (!data || data.totalUnlocked === 0) return null;
  if (year !== 'all' && (data.yearTotals?.total ?? 0) === 0 && data.perfectGames.length === 0) {
    return null;
  }

  const { rarityProfile } = data;
  const rarityTotal = rarityProfile.common + rarityProfile.rare + rarityProfile.ultra;
  const raritySegments: { key: RarityKey; label: string; count: number; color: string }[] = [
    { key: 'common', label: 'Common', count: rarityProfile.common, color: GREEN },
    { key: 'rare', label: 'Rare', count: rarityProfile.rare, color: AMBER },
    { key: 'ultra', label: 'Ultra rare', count: rarityProfile.ultra, color: ULTRA_VIOLET },
  ];

  // La escala de las barras de año, sobre TODOS (todos se pintan — la lista
  // se desplaza, no se recorta).
  const maxYear = Math.max(1, ...data.unlockedByYear.map((entry) => entry.total));
  // El año coronado de la cosecha: el de más caza. reduce y no sort: solo
  // hace falta el máximo, no reordenar la lista entera.
  const bestYear = data.unlockedByYear.reduce(
    (best, entry) => (entry.total > best.total ? entry : best),
    data.unlockedByYear[0] ?? { year: 0, total: 0 },
  ).year;
  const maxTopGame = Math.max(1, ...(data.topGames ?? []).map((game) => game.total));

  // El muro de 100%, paginado como el Completed.
  const perfectPages = Math.max(1, Math.ceil(data.perfectGames.length / PERFECT_PER_PAGE));
  const perfectPage = Math.min(page, perfectPages - 1);
  const perfectShown = data.perfectGames.slice(
    perfectPage * PERFECT_PER_PAGE,
    (perfectPage + 1) * PERFECT_PER_PAGE,
  );

  return (
    <div className="flex flex-col gap-4.5">
      {(data.hallOfFame.length > 0 || rarityTotal > 0) && (
        <div className="grid grid-cols-[1.35fr_1fr] items-stretch gap-4.5">
          {/* El hero: tu pieza más rara preside la vitrina de la casa. */}
          {data.hallOfFame[0] ? (
            <RarestHero
              entry={data.hallOfFame[0]}
              totalUnlocked={year === 'all' ? data.totalUnlocked : (data.yearTotals?.total ?? 0)}
              year={year}
              timeFormat={timeFormat}
              onOpenGame={onOpenGame}
            />
          ) : (
            <div />
          )}

          {/* El reparto de rareza, como anillo (ver RarityDonut). */}
          <div className={`${CARD_CLASS} flex flex-col`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Trophy size={15} style={{ color: GREEN }} />
                <span className="text-[13.5px] font-bold text-foreground">Rarity split</span>
              </div>
              <span className="text-[11.5px] text-muted-foreground/70">
                {year === 'all' ? 'all time' : String(year)}
              </span>
            </div>
            <div className="mt-3 flex min-h-42 flex-1 items-center justify-center">
              <RarityDonut
                segments={raritySegments}
                hovered={hoveredRarity}
                onHover={setHoveredRarity}
              />
            </div>
            <div className="mt-3 flex flex-col gap-0.5">
              {raritySegments.map((segment) => {
                const isHovered = hoveredRarity === segment.key;
                const dimmed = hoveredRarity !== null && !isHovered;
                return (
                  <div
                    key={segment.key}
                    onMouseEnter={() => setHoveredRarity(segment.key)}
                    onMouseLeave={() => setHoveredRarity(null)}
                    className="flex cursor-default items-center gap-2.5 rounded-[9px] px-2.5 py-1.75 transition-[background,opacity,box-shadow] duration-200"
                    style={{
                      background: isHovered ? `${segment.color}12` : 'transparent',
                      boxShadow: isHovered ? `inset 0 0 0 1px ${segment.color}40` : 'none',
                      opacity: dimmed ? 0.35 : 1,
                    }}
                  >
                    <span
                      aria-hidden
                      className="h-2.25 w-2.25 flex-none rounded-[3px]"
                      style={{ background: segment.color }}
                    />
                    <span
                      className="min-w-0 flex-1 text-[12.5px] font-bold"
                      style={{ color: segment.color }}
                    >
                      {segment.label}
                    </span>
                    <span className="text-[11.5px] text-muted-foreground/80">
                      {segment.key === 'common'
                        ? '10%+ of players'
                        : segment.key === 'rare'
                          ? 'under 10%'
                          : 'under 5%'}
                    </span>
                    <span className="w-8 text-right text-[13px] font-extrabold text-foreground tabular-nums">
                      {segment.count}
                    </span>
                    <span className="w-8.5 text-right text-[11px] font-semibold text-muted-foreground/75 tabular-nums">
                      {rarityTotal > 0 ? Math.round((segment.count / rarityTotal) * 100) : 0}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* El medallero (ver FameMedallion). Con menos de dos no hay rejilla
          que montar: el hero ya enseña la única pieza. */}
      {data.hallOfFame.length > 1 && (
        <div className={CARD_CLASS}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Medal size={15} style={{ color: AMBER }} />
              <span className="text-[13.5px] font-bold text-foreground">Hall of fame</span>
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {year === 'all' ? 'your rarest unlocks' : `your rarest unlocks of ${year}`}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3.5 min-[860px]:grid-cols-6">
            {data.hallOfFame.slice(0, 6).map((entry, index) => (
              <FameMedallion
                key={`${entry.gameId}-${entry.displayName}`}
                entry={entry}
                rank={index + 1}
                onOpenGame={onOpenGame}
              />
            ))}
          </div>
        </div>
      )}

      {/* La cosecha por año: cada año es una barra gruesa PARTIDA por rareza
          — no solo cuántos cazaste, sino de qué calidad. El mejor año lleva
          corona; señalar uno apaga los demás y la cabecera cambia a su
          desglose. Solo fechas fiables, y solo en All Time. */}
      {year === 'all' && data.unlockedByYear.length > 0 && (
        <div className={CARD_CLASS}>
          <div className="mb-3.5 flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2">
              <Trophy size={15} style={{ color: GREEN }} />
              <span className="text-[13.5px] font-bold text-foreground">Harvest by year</span>
            </div>
            {(() => {
              const hovered = data.unlockedByYear.find((entry) => entry.year === hoveredYear);
              if (hovered) {
                const common = hovered.total - hovered.rare - hovered.ultra;
                return (
                  <span className="text-[11px] font-semibold text-foreground tabular-nums">
                    {common} common
                    {hovered.rare > 0 && (
                      <span style={{ color: AMBER }}> · {hovered.rare} rare</span>
                    )}
                    {hovered.ultra > 0 && (
                      <span style={{ color: ULTRA_VIOLET }}> · {hovered.ultra} ultra</span>
                    )}
                  </span>
                );
              }
              const total = data.unlockedByYear.reduce((sum, entry) => sum + entry.total, 0);
              return (
                <span className="text-[11.5px] font-semibold text-muted-foreground/85 tabular-nums">
                  {total.toLocaleString('en-US')} dated in total
                </span>
              );
            })()}
          </div>
          <div className="flex flex-col gap-0.5">
            {[...data.unlockedByYear]
              .sort((a, b) => b.year - a.year)
              .map((entry) => {
                const isHovered = hoveredYear === entry.year;
                const dimmed = hoveredYear !== null && !isHovered;
                const common = entry.total - entry.rare - entry.ultra;
                const widthPct = (entry.total / maxYear) * 100;
                const best = entry.year === bestYear;
                const segment = (count: number): string =>
                  entry.total > 0 ? `${(count / entry.total) * 100}%` : '0%';
                return (
                  <div
                    key={entry.year}
                    onMouseEnter={() => setHoveredYear(entry.year)}
                    onMouseLeave={() => setHoveredYear(null)}
                    className="flex cursor-default items-center gap-3.25 rounded-[9px] px-2.25 py-1.5 transition-[background,opacity] duration-200"
                    style={{
                      background: isHovered ? 'rgba(255,255,255,.045)' : 'transparent',
                      opacity: dimmed ? 0.32 : 1,
                    }}
                  >
                    <div className="flex w-13 flex-none items-center gap-1.25">
                      <span
                        className="text-[12px] font-extrabold tabular-nums"
                        style={{
                          color: isHovered || best ? 'var(--foreground)' : 'rgba(139,145,140,.9)',
                        }}
                      >
                        {entry.year}
                      </span>
                      {best && <Crown size={10} className="flex-none" style={{ color: AMBER }} />}
                    </div>
                    <div className="flex h-3.5 min-w-0 flex-1 items-center">
                      <div
                        className="flex h-full gap-[1.5px] overflow-hidden rounded-[5px] transition-shadow duration-200"
                        style={{
                          width: `${widthPct}%`,
                          boxShadow: isHovered ? '0 3px 14px rgba(0,0,0,.5)' : 'none',
                        }}
                      >
                        <div
                          style={{
                            width: segment(common),
                            background: `linear-gradient(180deg, #48e895, ${GREEN})`,
                          }}
                        />
                        {entry.rare > 0 && (
                          <div
                            style={{
                              width: segment(entry.rare),
                              background: `linear-gradient(180deg, #f0c469, ${AMBER})`,
                            }}
                          />
                        )}
                        {entry.ultra > 0 && (
                          <div
                            style={{
                              width: segment(entry.ultra),
                              background: `linear-gradient(180deg, #eec0ff, ${ULTRA_VIOLET})`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                    {/* Huecos de ancho FIJO con guion en el cero: un año sin
                        ultra no puede desplazar la columna de totales. */}
                    <div className="flex w-29.5 flex-none items-center justify-end gap-2.25 tabular-nums">
                      <span
                        className="w-6 text-right text-[11.5px] font-bold"
                        style={{ color: AMBER, opacity: entry.rare > 0 ? 1 : 0.22 }}
                      >
                        {entry.rare > 0 ? entry.rare : '—'}
                      </span>
                      <span
                        className="w-6 text-right text-[11.5px] font-bold"
                        style={{ color: ULTRA_VIOLET, opacity: entry.ultra > 0 ? 1 : 0.22 }}
                      >
                        {entry.ultra > 0 ? entry.ultra : '—'}
                      </span>
                      <span className="w-9 text-right text-[13px] font-extrabold text-foreground">
                        {entry.total}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Con año elegido: el mes a mes y dónde cazaste, lado a lado. */}
      {year !== 'all' && (data.unlockedByMonth !== null || (data.topGames?.length ?? 0) > 0) && (
        <div
          className="grid grid-cols-2 items-stretch gap-4.5"
          data-testid="achievement-year-panels"
        >
          {data.unlockedByMonth !== null && (
            <RarityMonthChart
              months={data.unlockedByMonth}
              year={year}
              yearTotal={data.yearTotals?.total ?? 0}
            />
          )}
          {(data.topGames?.length ?? 0) > 0 && (
            <div
              className={`${CARD_CLASS} flex max-h-90 flex-col`}
              data-testid="achievement-games-card"
            >
              <div className="flex flex-none items-center justify-between gap-3">
                <span className="text-[13.5px] font-bold text-foreground">Where you hunted</span>
                <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {data.topGames?.length} {data.topGames?.length === 1 ? 'game' : 'games'}
                </span>
              </div>
              <div
                className="mt-2.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1"
                style={{ scrollbarWidth: 'none' }}
              >
                {(data.topGames ?? []).map((game) => (
                  <TopGameRow
                    key={game.gameId}
                    game={game}
                    maxTotal={maxTopGame}
                    onOpenGame={onOpenGame}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Almost there: de estadística a plan para esta noche. */}
      {data.almostThere.length > 0 && (
        <div
          className={cn(
            CARD_CLASS,
            'afterplay-almost-section overflow-hidden relative',
            "before:content-[''] before:absolute before:-top-17.5 before:-right-22.5 before:w-62.5 before:h-45",
            'before:rounded-full before:pointer-events-none',
            'before:[background:radial-gradient(circle,rgba(47,220,126,0.08),transparent_68%)]',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Target size={15} style={{ color: GREEN }} />
              <span className="text-[13.5px] font-bold text-foreground">Almost there</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-semibold text-muted-foreground">
                choose tonight&apos;s final push
              </span>
              <span className="rounded-full border border-primary/20 bg-primary/8 px-2 py-0.75 text-[11px] font-black tracking-[.08em] text-primary uppercase tabular-nums">
                {data.almostThere.length} in reach
              </span>
            </div>
          </div>
          <div className="afterplay-almost-grid mt-4 grid grid-cols-2 gap-3 [@media(max-width:_1040px)]:grid-cols-1">
            {data.almostThere.map((game, index) => (
              <AlmostThereRow key={game.gameId} game={game} index={index} onOpenGame={onOpenGame} />
            ))}
          </div>
        </div>
      )}

      {/* El muro de los 100% — el tamaño y el funcionamiento del Completed:
          grid de 8, tooltip flotante con el detalle, y pager si no caben. */}
      {data.perfectGames.length > 0 && (
        <div
          className={cn(
            'afterplay-stat-card rounded-[14px] border border-border bg-card px-5.5 py-5',
            '[.afterplay-stats-screen_&]:relative [.afterplay-stats-screen_&]:isolate',
            '[.afterplay-stats-screen_&]:[background:linear-gradient(145deg,rgba(255,255,255,0.038),rgba(255,255,255,0.012)),rgba(12,14,13,0.76)]',
            '[.afterplay-stats-screen_&]:border-white/[0.085]',
            '[.afterplay-stats-screen_&]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.025),0_15px_42px_rgba(0,0,0,0.13)]',
            '[.afterplay-stats-screen_&]:[transition:border-color_240ms_ease,background-color_240ms_ease,box-shadow_260ms_ease]',
            "[.afterplay-stats-screen_&::before]:content-[''] [.afterplay-stats-screen_&::before]:absolute",
            '[.afterplay-stats-screen_&::before]:-z-1 [.afterplay-stats-screen_&::before]:inset-0',
            '[.afterplay-stats-screen_&::before]:rounded-[inherit] [.afterplay-stats-screen_&::before]:pointer-events-none',
            '[.afterplay-stats-screen_&::before]:opacity-0',
            '[.afterplay-stats-screen_&::before]:[background:radial-gradient(circle_at_88%_0%,rgba(47,220,126,0.075),transparent_34%)]',
            '[.afterplay-stats-screen_&::before]:[transition:opacity_240ms_ease]',
            '[.afterplay-stats-screen_&:hover]:border-white/[0.135]',
            '[.afterplay-stats-screen_&:hover]:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.035),0_22px_52px_rgba(0,0,0,0.2)]',
            '[.afterplay-stats-screen_&:hover::before]:opacity-100',
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[14px] font-bold text-foreground">
              {year === 'all' ? 'Perfect games' : `Perfected in ${year}`}
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: AMBER }}>
                {data.perfectGames.length} at 100%
              </span>
              <StatsPager
                currentPage={perfectPage}
                totalPages={perfectPages}
                onPageChange={goToPage}
                prevLabel="Previous perfect games"
                nextLabel="More perfect games"
              />
            </div>
          </div>

          {/* key por página: remontar el grid relanza la entrada, con el
              sentido del deslizamiento según la dirección — el mismo gesto
              que el Completed. */}
          <div
            key={perfectPage}
            className={`grid grid-cols-8 gap-3 duration-300 animate-in fade-in-0 ${
              direction > 0 ? 'slide-in-from-right-3' : 'slide-in-from-left-3'
            }`}
          >
            {perfectShown.map((game) => (
              <div key={game.gameId} className="group/perfect relative">
                <button
                  type="button"
                  onClick={() => onOpenGame(game.gameId)}
                  className={cn(
                    'afterplay-completed-button block w-full relative overflow-hidden rounded-[8px] outline-none',
                    '[transition:transform_260ms_cubic-bezier(0.22,1,0.36,1),box-shadow_220ms_ease]',
                    '[&:is(:hover,:focus-visible)]:[box-shadow:0_10px_22px_rgba(0,0,0,0.34)]',
                    '[&:is(:hover,:focus-visible)]:[transform:translateY(-2px)]',
                    'motion-reduce:animate-none motion-reduce:transition-none',
                  )}
                  aria-label={`Open ${game.title}`}
                >
                  <GameCover
                    url={game.coverUrl}
                    className={cn(
                      'afterplay-completed-cover aspect-[2/3] w-full overflow-hidden rounded-[8px] border border-border',
                      '[transition:border-color_180ms_ease,filter_220ms_ease]',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:border-[rgba(216,180,91,0.45)]',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:[filter:saturate(1.12)_brightness(1.05)]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    iconSize={20}
                  />
                  {/* El barniz y la corona: la firma dorada del 100%, sobre
                      la geometría exacta del Completed. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'afterplay-completed-wash absolute inset-0 rounded-[8px] pointer-events-none opacity-58',
                      '[background:linear-gradient(180deg,transparent_58%,rgba(216,180,91,0.2))] [transition:opacity_220ms_ease]',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:opacity-100',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                  />
                  <Crown
                    size={12}
                    aria-hidden="true"
                    className={cn(
                      'afterplay-completed-mark absolute right-1.25 bottom-1.25 drop-shadow-[0_1px_3px_rgba(0,0,0,.8)] opacity-78',
                      '[transform:translateY(1px)] [transition:opacity_200ms_ease,transform_240ms_cubic-bezier(0.22,1,0.36,1)]',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:opacity-100',
                      '[.afterplay-completed-button:is(:hover,:focus-visible)_&]:[transform:translateY(0)]',
                      'motion-reduce:animate-none motion-reduce:transition-none',
                    )}
                    style={{ color: AMBER }}
                  />
                </button>
                <div
                  className={cn(
                    'pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-48 -translate-x-1/2 flex-col gap-0.5',
                    'rounded-[10px] border',
                    floatingPanelClass,
                    'px-3.25 py-2.75 text-[11.5px]',
                    'group-hover/perfect:flex',
                  )}
                >
                  <span className="truncate text-[12px] font-bold text-foreground">
                    {game.title}
                  </span>
                  <span style={{ color: AMBER }}>
                    All {game.total} achievements
                    {game.completedAt &&
                      ` — ${formatByPrecision(game.completedAt, 'day', timeFormat)}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
