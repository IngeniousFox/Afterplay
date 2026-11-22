import {
  ArrowRight,
  ChevronDown,
  Gamepad2,
  Newspaper,
  PinOff,
  Quote,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlannedGameItem } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { daysBetween, humanizeSpan } from '../../lib/dateMath';
import { formatHours } from '../../lib/format';
import { CRITICS_COLOR, PLAYERS_COLOR, resolveRatings, STEAM_BLUE } from '../../lib/ratings';
import { isUnreleased } from '../../lib/releaseDate';
import { Figure } from '../sessions/Figure';
import { buttonSize, primaryButtonClass, secondaryButtonClass } from '../shell/controls';
import { RatingChip } from './RatingChip';
import { ReleaseBadge } from './ReleaseBadge';

type NextUpCardProps = {
  game: PlannedGameItem;
  // Cuántos hay en Up next: con uno solo no hay a quién ceder el puesto.
  upNextCount: number;
  onOpen: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
};

// EL PRIMERO DE UP NEXT, en grande (concepto Fósforo, plan.png): la respuesta
// a "¿qué juego a continuación?" antes de leer ninguna lista. Es zona héroe,
// así que aquí sí van el arte del juego, las líneas de escaneo y la cifra
// grande. La lista de Up next de debajo sigue empezando por él: es la que se
// reordena, y esta tarjeta solo enseña quién va primero.
export const NextUpCard = ({
  game,
  upNextCount,
  onOpen,
  onMoveDown,
  onRemove,
}: NextUpCardProps): React.JSX.Element => {
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const ratings = resolveRatings(game);
  const unreleased = isUnreleased(game);

  return (
    <article
      aria-label="Next up"
      className="relative isolate overflow-hidden rounded-md border border-line bg-panel"
    >
      {/* El arte a la derecha, fundido hacia el panel para que el texto se
          lea siempre sobre fondo liso. */}
      {(heroSrc ?? coverSrc) && (
        <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-[70%]">
          {heroSrc ? (
            <img src={heroSrc} alt="" className="h-full w-full object-cover opacity-70" />
          ) : (
            <img
              src={coverSrc ?? undefined}
              alt=""
              className="h-full w-full scale-110 object-cover opacity-50 blur-xl"
            />
          )}
          <div className="absolute inset-0 bg-linear-to-r from-panel via-panel/80 to-panel/10" />
        </div>
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-(image:--scan)" />

      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${game.title}`}
          className="group/cover h-56 w-42 flex-none self-start overflow-hidden rounded-sm border border-line-strong bg-raised shadow-lift outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phosphor"
        >
          {coverSrc ? (
            <img
              src={coverSrc}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover/cover:scale-[1.03] motion-reduce:transition-none"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <Gamepad2 aria-hidden size={32} strokeWidth={1.5} className="text-dust/50" />
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-small">
            <span className="font-semibold text-phosphor">Next up</span>
            <span className="text-dust">first in your queue</span>
          </p>
          <h2 className="mt-1.5 font-display text-[clamp(40px,4.4vw,64px)] leading-[0.95] font-bold text-bone">
            {game.title}
          </h2>

          <dl className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div className="flex flex-col-reverse">
              <dt className="mt-1 text-small text-dust">HLTB Main</dt>
              <dd>
                {game.hltbMain !== null ? (
                  <Figure value={formatHours(game.hltbMain)} className="text-[30px] text-bone" />
                ) : (
                  <span className="font-display text-[30px] leading-none font-bold text-dust/50">
                    —
                  </span>
                )}
              </dd>
            </div>
            {!unreleased && (
              <div className="flex flex-col-reverse">
                <dt className="mt-1 text-small text-dust">waiting</dt>
                <dd className="font-display text-[30px] leading-none font-bold text-bone">
                  {humanizeSpan(daysBetween(game.addedAt, new Date()))}
                </dd>
              </div>
            )}
            {game.releaseYear !== null && (
              <div className="flex flex-col-reverse">
                <dt className="mt-1 text-small text-dust">released</dt>
                <dd className="font-display text-[30px] leading-none font-bold text-bone tabular-nums">
                  {game.releaseYear}
                </dd>
              </div>
            )}
          </dl>

          {(unreleased ||
            ratings.critics !== null ||
            ratings.players !== null ||
            ratings.steam !== null) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {unreleased && <ReleaseBadge game={game} />}
              {ratings.critics !== null && (
                <RatingChip
                  Icon={Newspaper}
                  color={CRITICS_COLOR}
                  value={ratings.critics}
                  title={`Critics: ${ratings.critics}/100 from ${ratings.criticsCount.toLocaleString()} reviews (IGDB)`}
                />
              )}
              {ratings.players !== null && (
                <RatingChip
                  Icon={Users}
                  color={PLAYERS_COLOR}
                  value={ratings.players}
                  title={`Players: ${ratings.players}/100 from ${ratings.playersCount.toLocaleString()} ratings (IGDB)`}
                />
              )}
              {ratings.steam !== null && (
                <RatingChip
                  Icon={ThumbsUp}
                  color={STEAM_BLUE}
                  value={ratings.steam}
                  suffix="%"
                  title={`Steam: ${ratings.steam}% positive out of ${ratings.steamCount.toLocaleString()} reviews`}
                />
              )}
            </div>
          )}

          {game.planNote && (
            <p className="mt-3 flex max-w-[70ch] items-start gap-1.5 text-body font-medium text-bone italic">
              <Quote aria-hidden size={12} className="mt-1 flex-none text-phosphor" />
              {game.planNote}
            </p>
          )}
          {game.summary && (
            <p className="mt-2 line-clamp-3 max-w-[70ch] text-small text-dust">{game.summary}</p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onOpen}
              className={cn(primaryButtonClass, buttonSize.md)}
            >
              Open game
              <ArrowRight aria-hidden size={15} />
            </button>
            {upNextCount > 1 && (
              <button
                type="button"
                onClick={onMoveDown}
                className={cn(secondaryButtonClass, buttonSize.md)}
              >
                <ChevronDown aria-hidden size={15} />
                Move down
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              title="Remove from Up next"
              className={cn(secondaryButtonClass, buttonSize.md)}
            >
              <PinOff aria-hidden size={14} />
              Remove from Up next
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};
