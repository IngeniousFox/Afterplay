import { ChevronRight, Crown, Medal, Sparkles, Target, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { AchievementsOverview, TimeFormat } from '../../../../shared/types';
import { useAchievementsOverview } from '../../hooks/achievements';
import { useTimeFormat } from '../../hooks/settings';
import { useImageSrc } from '../../hooks/useImageSrc';
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

// ── Salón de la fama ────────────────────────────────────────────────────────

const FameRow = ({
  entry,
  rank,
  timeFormat,
  onOpenGame,
}: {
  entry: AchievementsOverview['hallOfFame'][number];
  rank: number;
  timeFormat: TimeFormat;
  onOpenGame: (gameId: number) => void;
}): React.JSX.Element => {
  const src = useImageSrc(entry.iconUrl, 'achievements');
  const accent = rarityAccent(entry.globalPercent);
  return (
    <button
      type="button"
      onClick={() => onOpenGame(entry.gameId)}
      className="group flex w-full items-center gap-3 rounded-[10px] px-2 py-1.75 text-left transition-colors duration-150 hover:bg-white/[0.04]"
    >
      <span className="w-4 flex-none text-center text-[11px] font-extrabold text-muted-foreground/50 tabular-nums">
        {rank}
      </span>
      {/* Sin halo difuminado detrás: en una lista de diez, casi todos ultra
          raros, era una mancha morada por fila — el mismo neón que ya se
          purgó de la vitrina. El aro fino y el chip ya dicen la rareza. */}
      <div className="relative flex-none">
        <div
          className="relative h-9 w-9 overflow-hidden rounded-full"
          style={{ boxShadow: `inset 0 0 0 1.5px ${accent}99` }}
        >
          {src ? (
            <img src={src} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <Trophy size={12} className="text-muted-foreground/40" />
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-bold text-foreground">{entry.displayName}</div>
        <div className="truncate text-[10.5px] font-semibold text-muted-foreground/75">
          {entry.gameTitle}
          {entry.unlockedAt && (
            <span className="text-muted-foreground/45">
              {' · '}
              {formatByPrecision(entry.unlockedAt, 'day', timeFormat)}
            </span>
          )}
        </div>
      </div>
      <span
        className="flex-none rounded-full px-1.75 py-0.5 text-[10px] font-bold tabular-nums"
        style={{ background: `${accent}1f`, color: accent }}
      >
        {percentLabel(entry.globalPercent)}
      </span>
    </button>
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
      }`}
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
            <MissingIcon key={achievement.displayName} achievement={achievement} />
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
  const hoveredSegment = raritySegments.find((segment) => segment.key === hoveredRarity) ?? null;

  // La escala de las barras de año, sobre TODOS (todos se pintan — la lista
  // se desplaza, no se recorta).
  const maxYear = Math.max(1, ...data.unlockedByYear.map((entry) => entry.total));
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
      <div className="grid grid-cols-[1.3fr_1fr] gap-4.5">
        {/* Salón de la fama: tus conseguidos más raros — la versión global
            de las medallas de la ficha. */}
        <div className={CARD_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Medal size={15} style={{ color: AMBER }} />
              <span className="text-[13.5px] font-bold text-foreground">Hall of fame</span>
            </div>
            <span className="text-[11px] font-semibold text-muted-foreground">
              {year === 'all' ? 'your rarest unlocks' : `your rarest unlocks of ${year}`}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-0.5">
            {data.hallOfFame.map((entry, index) => (
              <FameRow
                key={`${entry.gameId}-${entry.displayName}`}
                entry={entry}
                rank={index + 1}
                timeFormat={timeFormat}
                onOpenGame={onOpenGame}
              />
            ))}
          </div>
        </div>

        {/* min-h-0 + el alto de la fila lo marca el salón de la fama: sin
            esto, las listas de la derecha estirarían la fila del grid en vez
            de desplazarse dentro de su tarjeta. */}
        <div className="flex min-h-0 flex-col gap-4.5">
          {/* Totales + perfil de rareza, con el hover del Status Breakdown. */}
          <div className={`${CARD_CLASS} flex-none`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Trophy size={15} style={{ color: GREEN }} />
                <span className="text-[13.5px] font-bold text-foreground">Trophy case</span>
              </div>
              {/* Con un tramo bajo el ratón, la cabecera se convierte en SU
                  detalle (nombre · nº · %) — el intercambio resumen⇄detalle
                  del Status Breakdown. */}
              {hoveredSegment && hoveredSegment.count > 0 && rarityTotal > 0 && (
                <span
                  className="text-[11px] font-semibold tabular-nums"
                  style={{ color: hoveredSegment.color }}
                >
                  {hoveredSegment.label} · {hoveredSegment.count} ·{' '}
                  {Math.round((hoveredSegment.count / rarityTotal) * 100)}%
                </span>
              )}
            </div>
            <div className="mt-2.5 flex items-baseline gap-1.5">
              <span className="text-[27px] leading-none font-extrabold tabular-nums text-foreground">
                {year === 'all' ? data.totalUnlocked : (data.yearTotals?.total ?? 0)}
              </span>
              <span className="text-[12.5px] font-semibold text-muted-foreground tabular-nums">
                {year === 'all' ? `/ ${data.totalCatalog} unlocked` : `unlocked in ${year}`}
              </span>
            </div>
            {rarityTotal > 0 && (
              <>
                <div className="mt-3 flex h-1.5 gap-[2px] overflow-hidden rounded-full">
                  {raritySegments
                    .filter((segment) => segment.count > 0)
                    .map((segment) => (
                      <div
                        key={segment.key}
                        onMouseEnter={() => setHoveredRarity(segment.key)}
                        onMouseLeave={() => setHoveredRarity(null)}
                        className="transition-[width,opacity] duration-300"
                        style={{
                          width: `${(segment.count / rarityTotal) * 100}%`,
                          background: segment.color,
                          opacity:
                            hoveredRarity !== null && hoveredRarity !== segment.key ? 0.35 : 1,
                        }}
                      />
                    ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-semibold">
                  {raritySegments
                    .filter((segment) => segment.count > 0)
                    .map((segment) => (
                      <span
                        key={segment.key}
                        onMouseEnter={() => setHoveredRarity(segment.key)}
                        onMouseLeave={() => setHoveredRarity(null)}
                        className="flex cursor-default items-center gap-1 transition-opacity duration-200"
                        style={{
                          color: segment.color,
                          opacity:
                            hoveredRarity !== null && hoveredRarity !== segment.key ? 0.45 : 1,
                        }}
                      >
                        {segment.key !== 'common' && <Sparkles size={9} />}
                        {segment.count} {segment.label.toLowerCase()}
                      </span>
                    ))}
                </div>
              </>
            )}
          </div>

          {/* El año mes a mes, apilado por rareza (ver RarityMonthChart). */}
          {year !== 'all' && data.unlockedByMonth !== null && (
            <RarityMonthChart
              months={data.unlockedByMonth}
              year={year}
              yearTotal={data.yearTotals?.total ?? 0}
            />
          )}

          {/* Los juegos del año: dónde cazaste. Rellena el resto de la
              columna y se desplaza si hay muchos — lista absoluta dentro del
              hueco flex-1, fuera del flujo para no estirar el grid. El
              min-h garantiza unas filas visibles aunque la columna venga
              justa: sin él, esta tarjeta podía aplastarse a cero. */}
          {year !== 'all' && (data.topGames?.length ?? 0) > 0 && (
            <div className={`${CARD_CLASS} flex min-h-44 flex-1 flex-col`}>
              <div className="flex flex-none items-center justify-between gap-3">
                <span className="text-[13.5px] font-bold text-foreground">Where you hunted</span>
                <span className="text-[11px] font-semibold text-muted-foreground tabular-nums">
                  {data.topGames?.length} {data.topGames?.length === 1 ? 'game' : 'games'}
                </span>
              </div>
              <div className="relative mt-2.5 min-h-0 flex-1">
                <div
                  className="absolute inset-0 flex flex-col gap-0.5 overflow-y-auto pb-1"
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
            </div>
          )}

          {/* Totales por año — solo fechas fiables, y solo en All Time. La
              tarjeta estira hasta donde deje la columna y por dentro se
              desplaza: todos los años están, los recientes a la vista. */}
          {year === 'all' && data.unlockedByYear.length > 0 && (
            <div className={`${CARD_CLASS} flex min-h-0 flex-1 flex-col`}>
              <div className="flex-none text-[13.5px] font-bold text-foreground">
                Unlocks by year
              </div>
              {/* La lista, ABSOLUTA dentro del hueco flex-1: fuera del flujo
                  no aporta alto al dimensionado del grid, así que la fila la
                  mide de verdad el salón de la fama y esta tarjeta rellena y
                  desplaza — en flujo, el grid la mediría por contenido y la
                  columna entera crecería con cada año. */}
              <div className="relative mt-3 min-h-0 flex-1">
                <div
                  className="absolute inset-0 flex flex-col gap-1.75 overflow-y-auto pb-1"
                  style={{ scrollbarWidth: 'none' }}
                >
                  {[...data.unlockedByYear]
                    .sort((a, b) => b.year - a.year)
                    .map((entry) => (
                      <div key={entry.year} className="flex flex-none items-center gap-2.5">
                        <span className="w-9 flex-none text-[11px] font-bold text-muted-foreground tabular-nums">
                          {entry.year}
                        </span>
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(entry.total / maxYear) * 100}%`,
                              background: `linear-gradient(90deg, ${GREEN}99, ${GREEN})`,
                            }}
                          />
                        </div>
                        <span className="w-13 flex-none text-right text-[11px] font-bold text-foreground tabular-nums">
                          {entry.total}
                          {entry.rare > 0 && <span style={{ color: AMBER }}> ·{entry.rare}</span>}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

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
