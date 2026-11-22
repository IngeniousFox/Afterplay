import { Lock, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import type { AchievementEntry, TimeFormat } from '../../../../shared/types';
import { useGameAchievements } from '../../hooks/achievements';
import { useTimeFormat } from '../../hooks/settings';
import { useImageSrc } from '../../hooks/useImageSrc';
import { isRare, percentLabel, sortForDisplay, ULTRA_RARE } from '../../lib/achievements';
import { formatByPrecision } from '../../lib/format';
import { cn } from '@/lib/utils';
import { useTvFocusable } from '../focusContext';
import {
  tvFocusHalo,
  tvFocusMotion,
  tvLabelClass,
  tvPanelClass,
  tvRevealClass,
  tvRevealStyle,
} from '../styles';
import { TvFigure } from '../tvUi';
import type { GameId } from '../../../../shared/entityIds';

// La pestaña Achievements de la ficha del sofá — el gabinete de trofeos a
// escala de tele: anillo de progreso, contadores de rareza y la lista entera
// recorrible con el stick, en el MISMO orden canónico que el escritorio
// (lib/achievements.ts). Lectura casi absoluta, con una sola acción: pulsar A
// sobre un logro oculto pendiente revela su descripción — la decisión de
// hacerse spoiler es tuya también desde el sillón.

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
      className={cn(
        'flex items-start gap-[0.8em] rounded-md border border-line bg-panel p-[0.8em]',
        tvFocusMotion,
        focused && ['border-phosphor bg-raised', tvFocusHalo],
        reveal && tvRevealClass,
      )}
      style={reveal ? tvRevealStyle(index) : undefined}
    >
      <div
        className={cn(
          'flex size-[2.6em] flex-none items-center justify-center overflow-hidden rounded-sm',
          unlocked ? 'bg-phosphor-tint text-phosphor' : 'bg-raised text-dust',
        )}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className={cn('h-full w-full object-cover', !unlocked && 'opacity-60 grayscale')}
          />
        ) : (
          <Trophy className="size-[1.2em]" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-[0.5em]">
          <span
            className={cn('min-w-0 flex-1 font-semibold', unlocked ? 'text-bone' : 'text-dust')}
          >
            {entry.displayName}
          </span>
          {!unlocked && <Lock className="size-[0.9em] flex-none text-dust" />}
        </div>

        {description ? (
          <p className="mt-[0.1em] text-[0.92em] leading-snug text-dust">{description}</p>
        ) : hiddenLocked ? (
          <p className="mt-[0.1em] text-[0.92em] leading-snug text-dust italic">
            {canReveal
              ? focused
                ? 'Hidden: press A to reveal'
                : 'Hidden achievement'
              : 'Hidden achievement'}
          </p>
        ) : null}

        {entry.unlockedAt && (
          <div
            className={cn(
              'mt-[0.2em] flex items-center gap-[0.4em] text-[0.92em] font-semibold tabular-nums',
              entry.dateReliable ? 'text-success' : 'text-dust',
            )}
          >
            <Trophy className="size-[1em] flex-none" />
            {entry.dateReliable
              ? formatByPrecision(entry.unlockedAt, 'datetime', timeFormat)
              : 'Unlocked · date unknown'}
          </div>
        )}
      </div>

      {entry.globalPercent !== null && (
        <div className="flex flex-none items-center gap-[0.3em] text-right">
          {rare && <Sparkles className="size-[1em] text-phosphor" />}
          <TvFigure
            value={percentLabel(entry.globalPercent)}
            className={cn('text-[1.3em]', rare ? 'text-phosphor' : 'text-dust')}
          />
        </div>
      )}
    </div>
  );
};

export const TvDetailAchievements = ({ gameId }: { gameId: GameId }): React.JSX.Element => {
  const { data } = useGameAchievements(gameId);
  const { data: timeFormat = '24h' } = useTimeFormat();

  // La pestaña solo se monta si hay logros (TvGameDetail la filtra), pero
  // entre invalidaciones la query puede parpadear: mejor un hueco honesto.
  if (!data || data.entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[1em] text-dust">
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

  const completion = data.completion ?? [];
  const sourceLabel = (source: string): string => (source === 'ra' ? 'RetroAchievements' : 'Steam');

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* El marcador: cifra grande, barra segmentada (un tramo por logro) y
          las fuentes a la derecha. */}
      <div
        className={cn(
          'mx-[0.6em] mb-[0.6em] flex flex-none items-center gap-[1.6em] p-[1em]',
          tvPanelClass,
          tvRevealClass,
        )}
        style={tvRevealStyle(0)}
      >
        <div className="flex-none">
          <div className="flex items-baseline gap-[0.15em]">
            <span className="font-display text-[2.4em] leading-none font-bold text-phosphor tabular-nums">
              {unlockedCount}
            </span>
            <span className="font-display text-[1.2em] leading-none font-semibold text-dust tabular-nums">
              /{sorted.length}
            </span>
          </div>
          <div className={cn('mt-[0.3em]', tvLabelClass)}>{percent}% unlocked</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex h-[0.6em] gap-px" aria-hidden>
            {sorted.map((entry) => (
              <span
                key={entry.id}
                className={cn(
                  'min-w-px flex-1 rounded-[2px]',
                  entry.unlockedAt !== null ? 'bg-phosphor' : 'bg-raised',
                )}
              />
            ))}
          </div>
          <div className="mt-[0.5em] flex flex-wrap items-center gap-x-[1em] gap-y-[0.2em] text-[0.92em] font-semibold">
            {complete && <span className="text-phosphor">Completed</span>}
            {rareCount > 0 && (
              <span className="flex items-center gap-[0.3em] text-phosphor tabular-nums">
                <Sparkles className="size-[1em]" />
                {rareCount} rare
              </span>
            )}
            {ultraCount > 0 && (
              <span className="flex items-center gap-[0.3em] tabular-nums text-st-resting">
                <Sparkles className="size-[1em]" />
                {ultraCount} ultra
              </span>
            )}
          </div>
        </div>
        {completion.length > 0 && (
          <div className="flex flex-none flex-col gap-[0.2em] border-l border-line pl-[1.4em] text-[0.92em]">
            {completion.map((item) => (
              <div key={item.source} className="text-dust tabular-nums">
                <span className="font-semibold text-bone">{sourceLabel(item.source)}</span>{' '}
                {item.unlocked} of {item.total}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* El padding inferior da paso a la última fila y el scroll-padding
          evita que el conductor de scroll del foco la deje a ras del borde. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto px-[0.6em] pt-[0.6em] pb-[1.8em]"
        style={{
          scrollbarWidth: 'none',
          scrollPaddingTop: '0.6em',
          scrollPaddingBottom: '1.6em',
        }}
      >
        <div className="grid grid-cols-2 gap-[0.7em]">
          {sorted.map((entry, index) => (
            <TvAchievementRow key={entry.id} entry={entry} index={index} timeFormat={timeFormat} />
          ))}
        </div>
      </div>
    </div>
  );
};
