import { Lock, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { AchievementEntry, GameAchievements } from '../../api';
import type { SourceCompletion } from '../../../../src/shared/api/v2';
import { isRare, percentLabel, sortAchievements } from '../../lib/achievements';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { chartGroup, growX, growY } from '../fx/chart';
import { Ticker } from '../fx/Ticker';
import { useInView } from '../fx/viewport';
import { SectionLabel, ShowMoreButton } from './primitives';

// El medidor de logros: una barrita por logro (hasta 60), encendidas las
// desbloqueadas. Con más de 60 no se distinguirían, y pasa a ser una barra
// continua.
const SEGMENT_LIMIT = 60;

// Se rellena la primera vez que entra en la vista: las barritas encendidas
// suben una detrás de otra; la barra continua crece de izquierda a derecha.
const Meter = ({ unlocked, total }: { unlocked: number; total: number }): React.JSX.Element => {
  const { observe, inView } = useInView();
  if (total > SEGMENT_LIMIT) {
    return (
      <div
        ref={observe}
        data-inview={inView || undefined}
        className={cn(chartGroup, 'h-3 overflow-hidden rounded-xs bg-bone/10')}
        aria-hidden="true"
      >
        <div
          className={cn('h-full bg-phosphor shadow-glow-bar', growX)}
          style={{ width: `${(unlocked / total) * 100}%` }}
        />
      </div>
    );
  }
  return (
    <div
      ref={observe}
      data-inview={inView || undefined}
      className={cn(chartGroup, 'flex h-3 gap-[2px]')}
      aria-hidden="true"
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn(
            'flex-1 rounded-xs',
            index < unlocked ? cn('bg-phosphor shadow-glow-bar', growY) : 'bg-bone/10',
          )}
          style={index < unlocked ? { animationDelay: `${index * 18}ms` } : undefined}
        />
      ))}
    </div>
  );
};

const AchievementRow = ({ entry }: { entry: AchievementEntry }): React.JSX.Element => {
  const unlocked = entry.unlockedAt !== null;
  const rare = unlocked && isRare(entry.globalPercent);

  return (
    <li className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
      <div
        className={cn(
          'relative size-10 shrink-0 overflow-hidden rounded-sm border bg-raised',
          rare ? 'border-phosphor/60' : 'border-line',
        )}
      >
        {/* El icono GRIS para los pendientes: es el propio Steam quien
            distingue las dos versiones del arte, y apagar el de color con CSS
            no es lo mismo — muchos logros tienen un gris dibujado aparte que
            además esconde el dibujo real. */}
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
          <div className="flex h-full w-full items-center justify-center text-dust">
            <Trophy size={16} aria-hidden="true" />
          </div>
        )}
        {!unlocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-inset/50 text-dust">
            <Lock size={14} aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className={cn('text-body font-semibold', unlocked ? 'text-bone' : 'text-dust')}>
          {entry.displayName}
        </div>
        {entry.description ? (
          <div className="text-small text-dust">{entry.description}</div>
        ) : (
          entry.hidden && <div className="text-small text-dust italic">Hidden achievement</div>
        )}
      </div>

      <div className="shrink-0 text-right">
        {entry.globalPercent !== null && (
          <div
            className={cn(
              'flex items-center justify-end gap-1 font-display text-figure font-bold',
              rare ? 'text-phosphor' : 'text-bone',
            )}
            title={`${entry.globalPercent.toFixed(1)}% of players have this`}
          >
            {rare && <Sparkles size={12} aria-hidden="true" />}
            {percentLabel(entry.globalPercent)}
          </div>
        )}
        {unlocked && entry.unlockedAt !== null && (
          <div className="text-micro text-dust tabular-nums">
            {/* Una fecha no fiable se dice, no se esconde: es la del rescate
                (el emulador que selló de golpe logros viejos), no la de la
                hazaña. Sigue siendo cierto que lo tienes. */}
            {entry.dateReliable ? formatDate(entry.unlockedAt) : 'Date unknown'}
          </div>
        )}
      </div>
    </li>
  );
};

// El completado de cada catálogo por su cuenta (R-11): un 100 % de Steam y uno
// de RetroAchievements no se suman. La cifra grande cuenta todos los logros
// juntos; con una sola fuente no se pinta esta caja, la repetiría.
const SOURCE_LABEL: Record<SourceCompletion['source'], string> = {
  steam: 'Steam',
  ra: 'RetroAchievements',
};

const SourceCompletionBox = ({
  completion,
}: {
  completion: SourceCompletion[];
}): React.JSX.Element => (
  <ul className="mt-3 flex flex-col gap-1 rounded-sm border border-line bg-panel px-3 py-2.5">
    {completion.map((source) => (
      <li
        key={source.source}
        className="text-small text-dust tabular-nums"
        title={
          source.complete && source.completedAt !== null
            ? `100% since ${formatDate(source.completedAt)}`
            : undefined
        }
      >
        {SOURCE_LABEL[source.source]}{' '}
        {/* Sin progreso conocido no es un 0 %: nunca se preguntó por tus
            desbloqueos de esta fuente. */}
        {!source.known ? (
          'not synced yet'
        ) : (
          <span className={cn('font-semibold', source.complete ? 'text-phosphor' : 'text-bone')}>
            {source.complete ? '100%' : `${source.unlocked} of ${source.total}`}
          </span>
        )}
      </li>
    ))}
  </ul>
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
      <SectionLabel>Achievements</SectionLabel>

      <div className="mt-1 flex items-end justify-between gap-3">
        <span className="font-display font-bold tabular-nums">
          <Ticker
            value={unlockedCount}
            className="text-[56px] leading-[52px] text-phosphor [text-shadow:0_0_1px_rgb(255_179_71/0.45),0_0_18px_rgb(255_179_71/0.32)]"
          />
          <span className="ml-1 text-[26px] text-dust">/{sorted.length}</span>
        </span>
        <div className="pb-1 text-right text-small">
          <div className="font-semibold text-bone">
            {percent === 100 ? 'Every single one' : `${percent}% unlocked`}
          </div>
          {rareCount > 0 && (
            <div className="flex items-center justify-end gap-1 text-phosphor">
              <Sparkles size={12} aria-hidden="true" />
              {rareCount} rare {rareCount === 1 ? 'unlock' : 'unlocks'}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2">
        <Meter unlocked={unlockedCount} total={sorted.length} />
      </div>

      {data.completion.length > 1 && <SourceCompletionBox completion={data.completion} />}

      <ul className="mt-2">
        {shown.map((entry) => (
          <AchievementRow key={entry.id} entry={entry} />
        ))}
      </ul>

      {sorted.length > PREVIEW_COUNT && (
        <ShowMoreButton
          expanded={expanded}
          total={sorted.length}
          onToggle={() => setExpanded((previous) => !previous)}
        />
      )}
    </section>
  );
};
