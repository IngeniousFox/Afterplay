import {
  ChevronDown,
  ChevronUp,
  Gamepad2,
  GripVertical,
  Hourglass,
  Newspaper,
  Pin,
  PinOff,
  Quote,
  ThumbsUp,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlannedGameItem } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useNearViewport } from '../../hooks/useNearViewport';
import { daysBetween, humanizeSpan } from '../../lib/dateMath';
import { formatHours } from '../../lib/format';
import { CRITICS_COLOR, PLAYERS_COLOR, resolveRatings, STEAM_BLUE } from '../../lib/ratings';
import { isUnreleased, releaseCountdown } from '../../lib/releaseDate';
import { RefreshGameButton } from '../RefreshGameButton';
import { Figure } from '../sessions/Figure';
import { focusRing, focusRingInset, iconButtonClass } from '../shell/controls';
import { RatingChip } from './RatingChip';
import { ReleaseBadge } from './ReleaseBadge';

// Los manejadores del arrastre viven en UpNextList (que es quien ve la lista
// entera y puede mover a los vecinos); la fila solo pinta el asa y les pasa
// los eventos. `dragging` enciende el asa mientras dura el gesto. `onMove`
// es el reordenado con teclado y con los botones de subir/bajar: la misma
// mutation que el arrastre, un puesto cada vez.
export type RowReorderHandle = {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  dragging: boolean;
  onMove: (delta: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

type PlanRowProps = {
  game: PlannedGameItem;
  pinned: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  // El puesto en Up next (1, 2, 3…), en numerales grandes como una lista de
  // reproducción. La cola no lo lleva: ahí ordenan las lentes.
  rank?: number;
  // Solo en Up next, y solo con más de una fila: la cola se ordena con las
  // lentes, no a mano — el asa ahí sería una promesa falsa.
  reorder?: RowReorderHandle;
  // El asa recibe el foco tras mover con teclado (la fila cambia de sitio y
  // el foco tiene que seguirla). Aparte de `reorder` a propósito: pasarlo
  // dentro del objeto a ref= hace que el compilador de React tome el objeto
  // entero por una ref.
  gripRef?: (element: HTMLElement | null) => void;
  // La fila ACABA de cambiar de estantería por un pin/unpin: entra con la
  // animación de llegada (halo que se apaga). Señala A DÓNDE fue el juego sin
  // que haya que buscarlo.
  landing?: boolean;
};

// La FILA DE DECISIÓN (PLAN-TO-PLAY.md §2.3) en Fósforo: una fila de lista de
// reproducción, no una tarjeta. Lo que decide va ALINEADO en columnas —HLTB
// Main en cifra grande a la derecha, la espera y las notas en chips— para que
// cada fila se compare con la de arriba y la de abajo sin abrir nada.
//
// La clase `group` de la raíz es además el gancho de los e2e (plan-ajustes):
// acota los botones de pin a SU fila. No anidar otra `.group` dentro.
export const PlanRow = ({
  game,
  pinned,
  onSelect,
  onTogglePin,
  rank,
  reorder,
  gripRef,
  landing = false,
}: PlanRowProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  // Desestructurado y no `const cover = …`: pasar `cover.observe` a un ref=
  // hace que el compilador de React tome el objeto entero por una ref.
  const { observe: observeCover, near: coverNear } = useNearViewport();
  const ratings = resolveRatings(game);

  // Lo que se pinta lo dice el JUEGO, no la sección: un planeado sin salir que
  // has fijado sigue necesitando su cuenta atrás, y uno que ACABA de salir
  // lleva su "Out now" unas semanas.
  const unreleased = isUnreleased(game);
  const justOut = !unreleased && releaseCountdown(game)?.kind === 'out-now';
  const waiting = humanizeSpan(daysBetween(game.addedAt, new Date()));
  const hasRatings = ratings.critics !== null || ratings.players !== null || ratings.steam !== null;

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group relative flex cursor-pointer items-stretch gap-3.5 rounded-md border bg-panel py-3 pr-3 pl-3.5',
        'transition-[border-color,background-color] duration-150 ease-out hover:bg-raised',
        pinned
          ? 'border-line-strong hover:border-line-hover'
          : 'border-line hover:border-line-strong',
        // La animación corre al MONTAR: la fila que cambia de estantería se
        // desmonta de una sección y se monta en la otra.
        landing &&
          'animate-[afterplay-pin-land_750ms_cubic-bezier(.22,1,.36,1)_both] motion-reduce:animate-none',
      )}
    >
      {/* Up next lleva su filo Phosphor siempre encendido: es la estantería
          del compromiso y tiene que verse distinta sin tocar nada. */}
      {pinned && (
        <span aria-hidden className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-phosphor" />
      )}

      {/* El asa de arrastre — separada del clic de la fila (que navega) y del
          pin. Es también el control de teclado: con el foco en ella, las
          flechas suben y bajan el juego un puesto. touch-none deja arrastrar
          con el dedo sin que la lista haga scroll debajo. */}
      {reorder && (
        <div
          ref={gripRef}
          role="button"
          tabIndex={0}
          aria-label={`Reorder ${game.title}. Use the arrow keys to move it.`}
          title="Drag to reorder (or focus and use ↑ ↓)"
          onPointerDown={reorder.onPointerDown}
          onPointerMove={reorder.onPointerMove}
          onPointerUp={reorder.onPointerUp}
          onPointerCancel={reorder.onPointerUp}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && reorder.canMoveUp) {
              event.preventDefault();
              reorder.onMove(-1);
            } else if (event.key === 'ArrowDown' && reorder.canMoveDown) {
              event.preventDefault();
              reorder.onMove(1);
            }
          }}
          className={cn(
            '-my-3 -ml-2 flex w-6 flex-none touch-none items-center justify-center self-stretch rounded-sm text-dust/60',
            'transition-[opacity,color] duration-150 hover:text-bone focus-visible:opacity-100',
            focusRingInset,
            reorder.dragging
              ? 'cursor-grabbing text-bone opacity-100'
              : 'cursor-grab opacity-0 group-hover:opacity-100',
          )}
        >
          <GripVertical aria-hidden size={16} />
        </div>
      )}

      {rank !== undefined && (
        <span
          aria-hidden
          className={cn(
            'w-8 flex-none self-center text-center font-display text-[30px] leading-none font-bold tabular-nums',
            rank === 1 ? 'text-phosphor' : 'text-dust',
          )}
        >
          {rank}
        </span>
      )}

      {/* La caja mide lo mismo con carátula y sin ella, que es lo que permite
          soltar la imagen de las filas lejanas sin mover el layout ni un
          píxel (ver useNearViewport). */}
      <div
        ref={observeCover}
        className="relative h-24 w-18 flex-none overflow-hidden rounded-sm border border-line bg-raised"
      >
        {!coverNear ? null : coverSrc ? (
          <img
            src={coverSrc}
            loading="lazy"
            alt={game.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Gamepad2 aria-hidden size={22} strokeWidth={1.5} className="text-dust/50" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* El título es el botón de verdad (teclado y lector): la fila entera
              también abre la ficha con el ratón. */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className={cn(
              'min-w-0 rounded-xs text-left text-lead font-semibold text-bone hover:underline underline-offset-2',
              focusRing,
            )}
          >
            {game.title}
          </button>
          {game.releaseYear !== null && (
            <span className="flex-none text-small text-dust tabular-nums">{game.releaseYear}</span>
          )}
          {(unreleased || justOut) && <ReleaseBadge game={game} />}
        </div>

        {/* Los datos que deciden, en una sola línea comparable entre filas.
            HLTB va en su columna grande a la derecha; en ventanas estrechas,
            donde la columna se esconde, baja aquí como chip. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {game.hltbMain !== null && (
            <span
              className="inline-flex flex-none items-center rounded-sm border border-tube/25 bg-tube/8 px-1.5 py-0.5 text-micro font-semibold text-tube tabular-nums lg:hidden"
              title="Main Story, from HowLongToBeat"
            >
              HLTB {formatHours(game.hltbMain)}
            </span>
          )}

          {/* De un juego sin salir no se dice cuánto lleva esperando: lo que
              importa es cuánto QUEDA, y eso ya lo dice su badge. */}
          {!unreleased && (
            <span
              className="inline-flex flex-none items-center gap-1 rounded-sm border border-line bg-bone/3 px-1.5 py-0.5 text-micro font-medium text-dust"
              title={`On your plan since ${game.addedAt.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`}
            >
              <Hourglass aria-hidden size={11} className="flex-none" />
              waiting {waiting}
            </span>
          )}

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
          {!hasRatings && game.hltbMain === null && !unreleased && (
            <span className="text-micro text-dust">No times or ratings yet — try Refresh data</span>
          )}
        </div>

        {/* Las etiquetas de Steam (§8): contexto, no datos de decisión — más
            apagadas que los chips de arriba. Todas las guardadas, envolviendo
            lo que haga falta. */}
        {game.steamTags && game.steamTags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {game.steamTags.map((tag) => (
              <span
                key={tag.name}
                title="Player tag on Steam"
                className="flex-none rounded-sm bg-bone/5 px-1.5 py-px text-micro text-dust"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {/* EL PORQUÉ: "Me lo recomendó Dani" no es un dato de catálogo, es la
            razón por la que ese juego está aquí. */}
        {game.planNote && (
          <div className="mt-2 flex items-start gap-1.5">
            <Quote aria-hidden size={11} className="mt-1 flex-none text-phosphor" />
            <span className="text-small font-medium text-bone italic">{game.planNote}</span>
          </div>
        )}

        {/* La sinopsis, SIEMPRE a dos líneas: la fila es para comparar, y para
            leerla entera está la ficha — el clic de la propia fila. El clamp
            fijo mantiene además la altura estable desde el primer render, que
            es lo que necesita el FLIP. */}
        {game.summary && <p className="mt-1 line-clamp-2 text-small text-dust">{game.summary}</p>}
      </div>

      {/* HLTB Main en cifra grande: la columna que se compara de un vistazo. */}
      <div
        className="hidden w-22 flex-none flex-col items-end justify-center lg:flex"
        title="Main Story, from HowLongToBeat"
      >
        {game.hltbMain !== null ? (
          <Figure value={formatHours(game.hltbMain)} className="text-[30px] text-bone" />
        ) : (
          <span className="font-display text-[30px] leading-none font-bold text-dust/40">—</span>
        )}
        <span className="mt-1 text-micro text-dust">HLTB Main</span>
      </div>

      <div className="flex flex-none items-start gap-0.5 self-start">
        {/* El "actualízalo todo" de ESTE juego, sin salir de la lista. */}
        <RefreshGameButton gameId={game.id} title={game.title} />
        {reorder && (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                reorder.onMove(-1);
              }}
              disabled={!reorder.canMoveUp}
              aria-label={`Move ${game.title} up`}
              title="Move up"
              className={cn(
                iconButtonClass,
                'size-7.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:invisible',
              )}
            >
              <ChevronUp aria-hidden size={15} />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                reorder.onMove(1);
              }}
              disabled={!reorder.canMoveDown}
              aria-label={`Move ${game.title} down`}
              title="Move down"
              className={cn(
                iconButtonClass,
                'size-7.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:invisible',
              )}
            >
              <ChevronDown aria-hidden size={15} />
            </button>
          </>
        )}
        <PinButton pinned={pinned} onToggle={onTogglePin} />
      </div>
    </div>
  );
};

// Fijar/soltar en Up next. Fantasma hasta que pasas el ratón por la fila (o
// hasta que el juego está fijado, que entonces se queda encendido en
// Phosphor): es EL gesto de esta pantalla, pero no compite con los datos.
const PinButton = ({
  pinned,
  onToggle,
}: {
  pinned: boolean;
  onToggle: () => void;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onToggle();
    }}
    title={pinned ? 'Remove from Up next' : 'Pin to Up next'}
    aria-label={pinned ? 'Remove from Up next' : 'Pin to Up next'}
    className={cn(
      iconButtonClass,
      'size-7.5',
      pinned
        ? 'text-phosphor hover:text-phosphor-hi'
        : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
    )}
  >
    {pinned ? <PinOff aria-hidden size={14} /> : <Pin aria-hidden size={14} />}
  </button>
);
