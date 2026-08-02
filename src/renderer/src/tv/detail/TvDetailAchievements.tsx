import { Lock, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { AchievementEntry, TimeFormat } from '../../../../shared/types';
import { useGameAchievements } from '../../hooks/achievements';
import { useTimeFormat } from '../../hooks/settings';
import { useImageSrc } from '../../hooks/useImageSrc';
import {
  isRare,
  percentLabel,
  rarityAccent,
  sortForDisplay,
  ULTRA_RARE,
  ULTRA_VIOLET,
} from '../../lib/achievements';
import { AMBER, GREEN } from '../../lib/colors';
import { formatByPrecision } from '../../lib/format';
import { useTvFocusable } from '../focusContext';
import { tvRevealClass, tvRevealStyle } from '../styles';

// La pestaña Achievements de la ficha del sofá — el gabinete de trofeos a
// escala de tele: anillo de progreso, contadores de rareza y la lista entera
// recorrible con el stick, en el MISMO orden canónico que el escritorio
// (lib/achievements.ts). Lectura casi absoluta, con una sola acción: pulsar A
// sobre un logro oculto pendiente revela su descripción — la decisión de
// hacerse spoiler es tuya también desde el sillón.

// El anillo, gemelo del de escritorio pero en viewBox: el tamaño real lo pone
// el em del contenedor y así escala con la tipografía de la tele.
const RING_VIEW = 64;
const RING_STROKE = 6;
const RING_RADIUS = (RING_VIEW - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_RADIUS;

const TvProgressRing = ({ percent }: { percent: number }): React.JSX.Element => {
  const color = percent === 100 ? AMBER : GREEN;
  return (
    <div className="relative h-[3.6em] w-[3.6em] flex-none">
      <svg viewBox={`0 0 ${RING_VIEW} ${RING_VIEW}`} className="h-full w-full -rotate-90">
        <circle
          cx={RING_VIEW / 2}
          cy={RING_VIEW / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(255,255,255,.08)"
          strokeWidth={RING_STROKE}
        />
        {percent > 0 && (
          <circle
            cx={RING_VIEW / 2}
            cy={RING_VIEW / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            style={{
              strokeDasharray: RING_C,
              strokeDashoffset: RING_C * (1 - percent / 100),
              ['--afterplay-ring-c' as string]: `${RING_C}`,
              animation: 'afterplay-ring-in 1s cubic-bezier(.22,1,.36,1) 200ms backwards',
              filter: `drop-shadow(0 0 4px ${color}66)`,
            }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[0.85em] font-extrabold tabular-nums" style={{ color }}>
          {percent}%
        </span>
      </div>
    </div>
  );
};

// Fila de logro: enfocable para que el stick recorra y la lista haga scroll
// (como las de Sessions), y con la luz del foco SIEMPRE dentro de la fila —
// teñida del color de rareza en los conseguidos. El icono pasa por la misma
// caché de imágenes que las carátulas (CSP: afterplay-image:), y solo se
// resuelven los que llegas a mirar.
const TvAchievementRow = ({
  entry,
  index,
  timeFormat,
}: {
  entry: AchievementEntry;
  index: number;
  timeFormat: TimeFormat;
}): React.JSX.Element => {
  const unlocked = entry.unlockedAt !== null;
  const rare = unlocked && isRare(entry.globalPercent);
  const accent = rarityAccent(entry.globalPercent);
  const remoteUrl = (unlocked ? entry.iconUrl : (entry.iconGrayUrl ?? entry.iconUrl)) ?? null;
  const src = useImageSrc(remoteUrl, 'achievements');

  // El spoiler de los ocultos pendientes, con A. Toggle y no solo-revelar:
  // así el registro del focusable no cambia de forma a mitad de vida y el
  // segundo A vuelve a tapar lo que abriste sin querer.
  const [revealed, setRevealed] = useState(false);
  const hiddenLocked = entry.hidden && !unlocked;
  const canReveal = hiddenLocked && entry.description !== null;
  const { ref, focused } = useTvFocusable(
    canReveal ? { onSelect: () => setRevealed((current) => !current) } : {},
  );

  const description = hiddenLocked && !revealed ? null : (entry.description ?? null);

  // La cascada de entrada solo para las primeras filas, como en Sessions.
  const reveal = index < 8;

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden rounded-[0.5em] px-[0.65em] py-[0.5em] transition-[background-color,box-shadow] duration-150 ${
        reveal ? tvRevealClass : ''
      }`}
      style={{
        ...(reveal ? tvRevealStyle(index) : undefined),
        ...(focused
          ? unlocked
            ? { background: `${accent}14`, boxShadow: `inset 0 0 0 1px ${accent}66` }
            : {
                background: 'rgba(255,255,255,.05)',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.28)',
              }
          : unlocked
            ? { background: 'rgba(255,255,255,.028)' }
            : undefined),
      }}
    >
      {/* Filo de color en los conseguidos — la gramática de la casa. */}
      {unlocked && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[0.14em]"
          style={{ background: accent, opacity: 0.8, boxShadow: `0 0 0.5em ${accent}80` }}
        />
      )}

      <div className="relative flex items-center gap-[0.65em]">
        <div className="relative flex-none">
          {rare && (
            <span
              aria-hidden
              className="absolute -inset-[0.1em] rounded-[0.45em] opacity-50 blur-[0.2em]"
              style={{ background: accent }}
            />
          )}
          <div
            className={`relative h-[2.3em] w-[2.3em] overflow-hidden rounded-[0.4em] ${
              unlocked ? '' : 'opacity-35 grayscale'
            }`}
            style={{
              boxShadow: `inset 0 0 0 1px ${
                rare ? `${accent}80` : unlocked ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.08)'
              }`,
            }}
          >
            {src ? (
              <img src={src} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/[0.04]">
                <Trophy className="h-[0.9em] w-[0.9em] text-white/25" />
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-[0.5em]">
            <span
              className={`min-w-0 flex-1 truncate text-[0.68em] font-bold ${
                unlocked ? 'text-foreground' : 'text-white/55'
              }`}
            >
              {entry.displayName}
            </span>
            {entry.globalPercent !== null && (
              <span
                className="flex flex-none items-center gap-[0.3em] text-[0.58em] font-bold tabular-nums"
                style={rare ? { color: accent } : { color: 'rgba(255,255,255,.35)' }}
              >
                {rare && <Sparkles className="h-[1em] w-[1em]" />}
                {percentLabel(entry.globalPercent)}
              </span>
            )}
            {!unlocked && <Lock className="h-[0.6em] w-[0.6em] flex-none text-white/25" />}
          </div>

          {description ? (
            <p className="mt-[0.1em] line-clamp-1 text-[0.56em] leading-snug text-white/50">
              {description}
            </p>
          ) : hiddenLocked ? (
            <p className="mt-[0.1em] text-[0.56em] leading-snug text-white/30 italic">
              {canReveal
                ? focused
                  ? 'Hidden — press A to reveal'
                  : 'Hidden achievement'
                : 'Hidden achievement'}
            </p>
          ) : null}

          {entry.unlockedAt && (
            <div
              className="mt-[0.12em] flex items-center gap-[0.4em] text-[0.52em] font-semibold"
              style={{ color: entry.dateReliable ? GREEN : 'rgba(255,255,255,.35)' }}
            >
              <Trophy className="h-[1em] w-[1em] flex-none" />
              {entry.dateReliable
                ? formatByPrecision(entry.unlockedAt, 'datetime', timeFormat)
                : 'Unlocked · date unknown'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const TvDetailAchievements = ({ gameId }: { gameId: number }): React.JSX.Element => {
  const { data } = useGameAchievements(gameId);
  const { data: timeFormat = '24h' } = useTimeFormat();

  // La pestaña solo se monta si hay logros (TvGameDetail la filtra), pero
  // entre invalidaciones la query puede parpadear: mejor un hueco honesto.
  if (!data || data.entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[0.75em] text-muted-foreground">
        No achievements here.
      </div>
    );
  }

  const sorted = sortForDisplay(data.entries);
  const unlockedCount = sorted.filter((entry) => entry.unlockedAt !== null).length;
  const percent = Math.round((unlockedCount / sorted.length) * 100);
  const rareUnlocked = sorted.filter(
    (entry) => entry.unlockedAt !== null && isRare(entry.globalPercent),
  );
  const ultraCount = rareUnlocked.filter(
    (entry) => (entry.globalPercent as number) < ULTRA_RARE,
  ).length;
  const rareCount = rareUnlocked.length - ultraCount;
  const complete = percent === 100;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* La cabecera-vitrina: anillo, marcador grande y los contadores de
          rareza — el resumen antes del detalle, como en Sessions. */}
      <div
        className={`flex flex-none items-center gap-[0.9em] pb-[0.65em] ${tvRevealClass}`}
        style={tvRevealStyle(0)}
      >
        <TvProgressRing percent={percent} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-[0.5em] gap-y-[0.2em]">
            <span className="text-[1.15em] leading-none font-extrabold tabular-nums">
              {unlockedCount}
            </span>
            <span className="text-[0.68em] font-bold text-white/45 tabular-nums">
              / {sorted.length} unlocked
            </span>
            {complete && (
              <span
                className="flex items-center gap-[0.3em] rounded-full px-[0.6em] py-[0.15em] text-[0.5em] font-extrabold tracking-[.1em]"
                style={{
                  color: AMBER,
                  background: `${AMBER}1a`,
                  boxShadow: `inset 0 0 0 1px ${AMBER}59`,
                }}
              >
                <Sparkles className="h-[1.1em] w-[1.1em]" />
                COMPLETED
              </span>
            )}
            {rareCount > 0 && (
              <span className="flex items-center gap-[0.3em] text-[0.58em] font-bold">
                <Sparkles className="h-[1em] w-[1em]" style={{ color: AMBER }} />
                <span style={{ color: AMBER }} className="tabular-nums">
                  {rareCount} rare
                </span>
              </span>
            )}
            {ultraCount > 0 && (
              <span className="flex items-center gap-[0.3em] text-[0.58em] font-bold">
                <Sparkles className="h-[1em] w-[1em]" style={{ color: ULTRA_VIOLET }} />
                <span style={{ color: ULTRA_VIOLET }} className="tabular-nums">
                  {ultraCount} ultra
                </span>
              </span>
            )}
          </div>
          {/* La barra con marcas de cuarto, gemela de la de escritorio. */}
          <div className="relative mt-[0.45em] h-[0.28em] overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${percent}%`,
                background: complete
                  ? `linear-gradient(90deg, ${GREEN}, ${AMBER})`
                  : `linear-gradient(90deg, ${GREEN}99, ${GREEN})`,
                boxShadow: percent > 0 ? `0 0 0.4em ${GREEN}66` : undefined,
              }}
            />
            {[25, 50, 75].map((tick) => (
              <span
                key={tick}
                aria-hidden
                className="absolute inset-y-0 w-px bg-black/40"
                style={{ left: `${tick}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Dos colchones distintos y los dos necesarios: el padding inferior
          SOBRA respecto al alto del fundido (1.4em) para que al llegar al
          tope del scroll la última fila quede por encima del degradado; y el
          scroll-padding le dice al conductor de scroll del foco (focus.tsx
          lo lee) que al enfocarla NO la deje a ras del borde — sin él, el
          glide la alineaba justo debajo del fundido y el hover se veía
          cortado por mucho padding que hubiera. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto pb-[1.8em]"
        style={{
          scrollbarWidth: 'none',
          scrollPaddingTop: '0.35em',
          scrollPaddingBottom: '1.6em',
        }}
      >
        <div className="flex flex-col gap-[0.18em]">
          {sorted.map((entry, index) => (
            <TvAchievementRow key={entry.id} entry={entry} index={index} timeFormat={timeFormat} />
          ))}
        </div>
      </div>
      {/* El fundido inferior: la lista muere a transparente como pista de
          que hay más gabinete debajo del pliegue. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[1.4em] bg-gradient-to-t from-black/60 to-transparent"
      />
    </div>
  );
};
