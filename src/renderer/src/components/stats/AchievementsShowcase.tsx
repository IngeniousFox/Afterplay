import { ChevronRight, Crown, Medal, Sparkles, Target, Trophy } from 'lucide-react';
import { useState } from 'react';
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
// Chart PROPIO y no el CategoryBarChart compartido, por dos motivos que se
// vieron en pantalla: aquel no sabe apilar (y aquí la barra ES el reparto
// común/raro/ultra del mes), y su geometría de card a altura completa
// (h-full + área de 150px) convertía las pistas vacías en lápidas y
// aplastaba a cero la tarjeta de debajo. La gramática interactiva sí es la
// suya: pista tenue, etiqueta en el pico y bajo el ratón, el resto
// desaturado, y el intercambio resumen⇄detalle en la cabecera.

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
    <div className={`${CARD_CLASS} flex-none`}>
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

      <div className="mt-3.5 flex items-end gap-1.5" style={{ height: MONTH_BAR_AREA }}>
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
                  className="absolute left-1/2 -translate-x-1/2 text-[10.5px] font-bold whitespace-nowrap tabular-nums"
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
                      hoveredMonth !== null && !isHovered ? 'saturate(.45) brightness(.7)' : 'none',
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

      <div className="mt-2 flex gap-1.5 border-t border-white/5 pt-1.75">
        {months.map((entry, index) => (
          <div
            key={entry.month}
            className="flex-1 text-center text-[10px]"
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
      className="group/fame relative flex flex-col items-center gap-2 rounded-[13px] border border-white/[0.07] px-2 pt-3.5 pb-3 text-center transition-[transform,border-color] duration-200 ease-[cubic-bezier(.2,.7,.3,1)] hover:-translate-y-1"
      style={{ background: `linear-gradient(180deg, ${accent}0d, rgba(255,255,255,.015))` }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = accent;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = 'rgba(255,255,255,.07)';
      }}
    >
      <span className="absolute top-1.75 left-2.25 text-[10px] font-extrabold text-muted-foreground/70 tabular-nums">
        #{rank}
      </span>
      {/* Chapa esmaltada, no rótulo: aro del acento + especular + sombra.
          Sin halo difuminado — el neón ya se purgó de esta casa. */}
      <div
        className="relative h-14 w-14 overflow-hidden rounded-full"
        style={{
          boxShadow: `inset 0 0 0 2px ${accent}85, inset 0 1px 0 rgba(255,255,255,.3), 0 6px 16px rgba(0,0,0,.5)`,
        }}
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={16} className="text-muted-foreground/40" />
          </div>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(120% 85% at 30% 12%, rgba(255,255,255,.24), transparent 45%)',
          }}
        />
      </div>
      <span className="text-[13px] font-extrabold tabular-nums" style={{ color: accent }}>
        {percentLabel(entry.globalPercent)}
      </span>
      <span className="line-clamp-2 h-7 w-full text-[10.5px] leading-[1.32] font-semibold text-[#c4cac6]">
        {entry.displayName}
      </span>
      <span className="w-full truncate text-[9.5px] text-muted-foreground/75">
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
          className="flex items-center gap-1.75 text-[10.5px] font-extrabold tracking-[.16em]"
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
          className="text-[10px] font-bold tracking-[.12em] uppercase transition-colors duration-200"
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
      className="h-7.5 w-7.5 flex-none overflow-hidden rounded-[7px] opacity-45 grayscale transition-opacity duration-150 hover:opacity-80"
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
  onOpenGame,
}: {
  game: AchievementsOverview['almostThere'][number];
  onOpenGame: (gameId: number) => void;
}): React.JSX.Element => {
  const src = useImageSrc(game.coverUrl, 'covers');
  const percent = Math.round((game.unlocked / game.total) * 100);
  return (
    <button
      type="button"
      onClick={() => onOpenGame(game.gameId)}
      className="group flex w-full items-center gap-3.5 rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left transition-colors duration-150 hover:bg-white/[0.045]"
    >
      <div className="h-13 w-9.5 flex-none overflow-hidden rounded-[6px]">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Trophy size={12} className="text-muted-foreground/40" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 truncate text-[13px] font-bold text-foreground">
            {game.title}
          </span>
          <span className="flex-none text-[11px] font-bold tabular-nums" style={{ color: GREEN }}>
            {game.unlocked}/{game.total} · {percent}%
          </span>
        </div>
        <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full"
            style={{ width: `${percent}%`, background: GREEN }}
          />
        </div>
        <div className="mt-1.75 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground/70">
            {game.total - game.unlocked} to go:
          </span>
          {game.missing.map((achievement) => (
            <span
              key={achievement.displayName}
              onClick={() => requestAchievementFlash(achievement.achievementId)}
            >
              <MissingIcon achievement={achievement} />
            </span>
          ))}
        </div>
      </div>
      <ChevronRight
        size={14}
        className="flex-none text-muted-foreground/30 transition-transform duration-150 group-hover:translate-x-0.5"
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
              <span className="text-[10.5px] text-muted-foreground/70">
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
                    <span className="text-[10px] text-muted-foreground/60">
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
                        className="w-6 text-right text-[10px] font-bold"
                        style={{ color: AMBER, opacity: entry.rare > 0 ? 1 : 0.22 }}
                      >
                        {entry.rare > 0 ? entry.rare : '—'}
                      </span>
                      <span
                        className="w-6 text-right text-[10px] font-bold"
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
        <div className="grid grid-cols-2 items-start gap-4.5">
          {data.unlockedByMonth !== null && (
            <RarityMonthChart
              months={data.unlockedByMonth}
              year={year}
              yearTotal={data.yearTotals?.total ?? 0}
            />
          )}
          {(data.topGames?.length ?? 0) > 0 && (
            <div className={`${CARD_CLASS} flex max-h-90 flex-col`}>
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
        <div className={CARD_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Target size={15} style={{ color: GREEN }} />
              <span className="text-[13.5px] font-bold text-foreground">Almost there</span>
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground">
              a push away from 100%
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {data.almostThere.map((game) => (
              <AlmostThereRow key={game.gameId} game={game} onOpenGame={onOpenGame} />
            ))}
          </div>
        </div>
      )}

      {/* El muro de los 100% — el tamaño y el funcionamiento del Completed:
          grid de 8, tooltip flotante con el detalle, y pager si no caben. */}
      {data.perfectGames.length > 0 && (
        <div className={CARD_CLASS}>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown size={15} style={{ color: AMBER }} />
              <span className="text-[13.5px] font-bold text-foreground">
                {year === 'all' ? 'Perfect games' : `Perfected in ${year}`}
              </span>
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
                  className="relative block w-full transition-transform group-hover/perfect:-translate-y-0.5"
                >
                  <GameCover
                    url={game.coverUrl}
                    className="aspect-[2/3] w-full overflow-hidden rounded-[8px] border border-border"
                    iconSize={20}
                  />
                  {/* El barniz y la corona: la firma dorada del 100%, sobre
                      la geometría exacta del Completed. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[8px] opacity-60 transition-opacity duration-200 group-hover/perfect:opacity-100"
                    style={{ background: `linear-gradient(180deg, transparent 60%, ${AMBER}38)` }}
                  />
                  <Crown
                    size={12}
                    className="absolute right-1.25 bottom-1.25 drop-shadow-[0_1px_3px_rgba(0,0,0,.8)]"
                    style={{ color: AMBER }}
                  />
                </button>
                <div
                  className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-48 -translate-x-1/2 flex-col gap-0.5 rounded-[10px] border ${floatingPanelClass} px-3.25 py-2.75 text-[11.5px] group-hover/perfect:flex`}
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
