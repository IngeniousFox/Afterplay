import { ChevronDown, Lock, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { AchievementEntry, GameAchievements } from '../../api';
import type { SourceCompletion } from '../../../../src/shared/api/v2';
import { isRare, percentLabel, rarityAccent, sortAchievements } from '../../lib/achievements';
import { formatDate } from '../../lib/format';
import { SectionLabel } from './primitives';

const RING_SIZE = 68;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_RADIUS;

// SVG y no conic-gradient porque el trazo redondeado y la animación de
// dibujado solo salen bien con stroke-dashoffset.
const ProgressRing = ({
  percent,
  complete,
}: {
  percent: number;
  complete: boolean;
}): React.JSX.Element => {
  const color = complete ? '#ffb347' : '#ffb347';
  return (
    <div className="relative flex-none" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="rgba(233,228,216,.08)"
          strokeWidth={RING_STROKE}
        />
        {percent > 0 && (
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            style={{
              strokeDasharray: RING_C,
              strokeDashoffset: RING_C * (1 - percent / 100),
            }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[15px] font-extrabold tabular-nums" style={{ color }}>
          {percent}%
        </span>
      </div>
    </div>
  );
};

const AchievementRow = ({ entry }: { entry: AchievementEntry }): React.JSX.Element => {
  const unlocked = entry.unlockedAt !== null;
  const accent = rarityAccent(entry.globalPercent);
  const rare = unlocked && isRare(entry.globalPercent);

  return (
    <div
      className="flex items-center gap-2.5 rounded-[11px] border px-2.5 py-2"
      style={
        rare
          ? { borderColor: `${accent}3d`, background: `${accent}0f` }
          : { borderColor: 'var(--border)', background: 'rgba(233,228,216,.024)' }
      }
    >
      <div className="relative h-9 w-9 flex-none overflow-hidden rounded-[8px] bg-bone/5">
        {/* El icono GRIS para los pendientes: es el propio Steam quien
            distingue las dos versiones del arte, y usar el de color apagado
            con CSS no es lo mismo — muchos logros tienen un gris dibujado
            aparte que además esconde el dibujo real. */}
        {unlocked && entry.iconUrl ? (
          <img src={entry.iconUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : entry.iconGrayUrl ? (
          <img
            src={entry.iconGrayUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-60"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Trophy size={14} className="text-muted-foreground/40" />
          </div>
        )}
        {!unlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-inset/45">
            <Lock size={11} className="text-dust" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[12px] font-bold ${unlocked ? '' : 'text-muted-foreground'}`}
          style={rare ? { color: accent } : undefined}
        >
          {entry.displayName}
        </div>
        {entry.description ? (
          <div className="truncate text-micro text-muted-foreground">{entry.description}</div>
        ) : (
          entry.hidden && (
            <div className="text-micro text-muted-foreground/60 italic">Hidden achievement</div>
          )
        )}
        {unlocked && entry.unlockedAt !== null && (
          <div className="mt-0.5 text-micro font-semibold text-muted-foreground/80 tabular-nums">
            {/* Una fecha no fiable se dice, no se esconde: es la del rescate
                (el emulador que selló de golpe logros viejos), no la de la
                hazaña. Sigue siendo cierto que lo tienes. */}
            {entry.dateReliable ? formatDate(entry.unlockedAt) : 'Date unknown'}
          </div>
        )}
      </div>

      {entry.globalPercent !== null && (
        <span
          className="flex flex-none items-center gap-1 text-micro font-bold tabular-nums"
          style={{ color: rare ? accent : 'var(--muted-foreground)' }}
          title={`${entry.globalPercent.toFixed(1)}% of players have this`}
        >
          {rare && <Sparkles size={10} />}
          {percentLabel(entry.globalPercent)}
        </span>
      )}
    </div>
  );
};

// El completado de cada catálogo por su cuenta (R-11): un 100 % de Steam y uno
// de RetroAchievements no se suman. El anillo de arriba cuenta todos los logros
// juntos; con una sola fuente no se pinta esta línea, repetiría el anillo.
const SOURCE_LABEL: Record<SourceCompletion['source'], string> = {
  steam: 'Steam',
  ra: 'RetroAchievements',
};

const SourceCompletionRow = ({
  completion,
}: {
  completion: SourceCompletion[];
}): React.JSX.Element => (
  <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[11px] border border-border bg-card px-4 py-2.5">
    {completion.map((source) => (
      <span
        key={source.source}
        className="flex items-baseline gap-1.5 text-[11.5px] tabular-nums"
        title={
          source.complete && source.completedAt !== null
            ? `100% since ${formatDate(source.completedAt)}`
            : undefined
        }
      >
        <span className="text-micro font-bold tracking-[.12em] text-muted-foreground uppercase">
          {SOURCE_LABEL[source.source]}
        </span>
        {/* Sin progreso conocido no es un 0 %: nunca se preguntó por tus
            desbloqueos de esta fuente. */}
        {!source.known ? (
          <span className="text-muted-foreground/60">not synced yet</span>
        ) : (
          <span
            className={source.complete ? 'font-extrabold' : 'font-extrabold text-foreground'}
            style={source.complete ? { color: '#ffb347' } : undefined}
          >
            {source.complete ? '100%' : `${source.unlocked} of ${source.total}`}
          </span>
        )}
      </span>
    ))}
  </div>
);

// Cuántos se pintan antes de pedir "ver todos". Un juego puede tener 200
// logros y montarlos todos de golpe en un móvil es medio segundo de scroll
// trabado por una lista que casi nadie recorre entera.
const PREVIEW_COUNT = 8;

export const AchievementsSection = ({
  data,
}: {
  data: GameAchievements;
}): React.JSX.Element | null => {
  const [expanded, setExpanded] = useState(false);

  // Sin catálogo traído no hay sección: en un emulado de consola esto es lo
  // normal, no un hueco que explicar.
  if (data.entries.length === 0) return null;

  const sorted = sortAchievements(data.entries);
  const unlockedCount = sorted.filter((entry) => entry.unlockedAt !== null).length;
  const percent = Math.round((unlockedCount / sorted.length) * 100);
  const shown = expanded ? sorted : sorted.slice(0, PREVIEW_COUNT);
  const rareCount = sorted.filter(
    (entry) => entry.unlockedAt !== null && isRare(entry.globalPercent),
  ).length;

  return (
    <section>
      <SectionLabel className="mb-2.5">Achievements</SectionLabel>

      <div className="mb-2.5 flex items-center gap-4 rounded-[14px] border border-border bg-card px-4 py-3.5">
        <ProgressRing percent={percent} complete={percent === 100} />
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-extrabold tabular-nums">
            {unlockedCount}
            <span className="text-muted-foreground"> / {sorted.length}</span>
          </div>
          <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
            {percent === 100 ? 'Every single one.' : 'unlocked'}
          </div>
          {rareCount > 0 && (
            <div
              className="mt-1.5 flex items-center gap-1 text-micro font-bold"
              style={{ color: '#e0a3ff' }}
            >
              <Sparkles size={10} />
              {rareCount} rare {rareCount === 1 ? 'unlock' : 'unlocks'}
            </div>
          )}
        </div>
      </div>

      {data.completion.length > 1 && <SourceCompletionRow completion={data.completion} />}

      <div className="flex flex-col gap-1.5">
        {shown.map((entry) => (
          <AchievementRow key={entry.id} entry={entry} />
        ))}
      </div>

      {sorted.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-[11px] border border-border bg-card py-2 text-[11.5px] font-bold text-muted-foreground"
        >
          {expanded ? 'Show less' : `Show all ${sorted.length}`}
          <ChevronDown
            size={12}
            className="transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>
      )}
    </section>
  );
};
