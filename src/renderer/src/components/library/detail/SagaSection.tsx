import { ChevronLeft, ChevronRight, Gamepad2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CollectionGame, GameDetail, IgdbSearchResult } from '../../../../../shared/types';
import { useGames, usePlannedGames } from '../../../hooks/games';
import { useCollectionGames } from '../../../hooks/igdb';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { GREEN } from '../../../lib/colors';
import { getGameStatusMeta, STATUS_META } from '../../../lib/gameStatus';
import { accentGradientStyle } from '../../../lib/styles';
import { StatusIcon } from '../../StatusIcon';
import { AddGameModal } from '../AddGameModal';
import { WhereToAddDialog } from '../WhereToAddDialog';
import { SectionLabel } from './SectionLabel';

const PLAN_COLOR = STATUS_META.plan.color;

const SLIDE_WIDTH = 116;
const SLIDE_GAP = 12;
const SKELETON_COUNT = 6;
const slideShellClass = 'w-29 flex-none';

const pagerButtonClass =
  'flex h-7 w-7 items-center justify-center rounded-[7px] border border-input bg-white/[0.03] text-muted-foreground hover:text-foreground disabled:opacity-35 disabled:hover:text-muted-foreground';

// Dónde vive un juego de la saga en TU biblioteca. Es lo que decide el badge
// de la carátula y a dónde lleva el clic (§3.3-3.4).
type Owned =
  | { kind: 'library'; gameId: number; state: GameDetail['currentState'] }
  | { kind: 'plan'; gameId: number }
  | { kind: 'none' };

type SagaSlideProps = {
  game: CollectionGame;
  owned: Owned;
  // El juego cuya ficha estás mirando: se resalta en su sitio de la línea
  // temporal y NO es clicable — ya estás en él.
  isCurrent: boolean;
  onSelect: () => void;
};

const SagaSlide = ({ game, owned, isCurrent, onSelect }: SagaSlideProps): React.JSX.Element => {
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const status = owned.kind === 'library' ? getGameStatusMeta(owned.state) : null;

  return (
    <button
      type="button"
      onClick={isCurrent ? undefined : onSelect}
      disabled={isCurrent}
      title={isCurrent ? `${game.title} — you're here` : game.title}
      className={`group/saga ${slideShellClass} text-left ${isCurrent ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <div
        className={`relative aspect-3/4 overflow-hidden rounded-[10px] border transition-[transform,border-color,box-shadow] duration-200 ${
          isCurrent
            ? ''
            : 'border-border group-hover/saga:-translate-y-1 group-hover/saga:border-white/20 group-hover/saga:shadow-[0_10px_28px_rgba(0,0,0,.45)]'
        }`}
        style={
          isCurrent
            ? { borderColor: `${GREEN}8a`, boxShadow: `0 0 0 1px ${GREEN}59, 0 0 18px ${GREEN}2e` }
            : undefined
        }
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            loading="lazy"
            alt={game.title}
            // Los que NO tienes se atenúan y recuperan el color al pasar por
            // encima: de un vistazo, la saga cuenta tu historia con ella —
            // "el 1 y el 2 terminados, el 3 en el Plan, el 4 ni lo tengo".
            className={`block h-full w-full object-cover transition-[filter] duration-200 ${
              owned.kind === 'none' && !isCurrent
                ? 'brightness-50 grayscale-[.55] group-hover/saga:brightness-90 group-hover/saga:grayscale-0'
                : 'brightness-90'
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Gamepad2 size={20} strokeWidth={1.5} className="text-muted-foreground/40" />
          </div>
        )}

        {/* El badge de TU estado, arriba a la derecha. Sin badge = no lo
            tienes, y esa es la carátula limpia (§3.3). */}
        {status && (
          <span
            className="absolute top-1.5 right-1.5 flex h-5.5 w-5.5 items-center justify-center rounded-[7px] border"
            style={{
              background: 'rgba(8,10,9,.78)',
              borderColor: `${status.color}59`,
            }}
          >
            <StatusIcon meta={status} size={11} />
          </span>
        )}
        {owned.kind === 'plan' && (
          <span
            className="absolute top-1.5 right-1.5 flex h-5.5 w-5.5 items-center justify-center rounded-[7px] border"
            style={{ background: 'rgba(8,10,9,.78)', borderColor: `${PLAN_COLOR}59` }}
          >
            <StatusIcon meta={STATUS_META.plan} size={11} />
          </span>
        )}

        {isCurrent && (
          <span
            className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-[6px] px-1.75 py-0.5 text-[9px] font-extrabold tracking-[.08em] whitespace-nowrap"
            style={{ ...accentGradientStyle }}
          >
            YOU&apos;RE HERE
          </span>
        )}
      </div>

      <div
        className={`mt-1.5 line-clamp-2 text-[11.5px] leading-tight font-semibold ${
          isCurrent ? 'text-foreground' : 'text-muted-foreground group-hover/saga:text-foreground'
        }`}
      >
        {game.title}
      </div>
      {game.releaseYear !== null && (
        <div className="text-[10.5px] text-muted-foreground/60 tabular-nums">
          {game.releaseYear}
        </div>
      )}
    </button>
  );
};

type SagaSectionProps = {
  game: GameDetail;
};

// LA SAGA EN LA FICHA (PLAN-TO-PLAY.md §3) — los demás juegos de la serie de
// este, en orden cronológico de salida y navegables.
//
// Tres decisiones que explican por qué se ve así:
//
//  1. `collections` y no `franchise` (§3.1). La franquicia es el paraguas de
//     la mascota: pedirla en un Mario traería Kart, Party, Golf y Picross de
//     golpe. La colección es la LÍNEA DE SERIE — responde a "¿esta historia
//     continúa?" y no a "¿comparten mascota?" — y resuelve el grueso del
//     spin-off por construcción, porque los spin-offs viven en colecciones
//     propias.
//  2. Sin etiquetas de secuela/precuela (§3.2). IGDB no tiene ese enlace: hay
//     colección y fechas. Así que esto es "la saga en orden de salida" con el
//     juego actual resaltado en su sitio, y cada cual lee lo que hay antes y
//     después. No se inventa una relación que la fuente no da.
//  3. Dato DECORATIVO (§3.5). Las colecciones de IGDB son curación
//     comunitaria: se piden al abrir la ficha, con caché de cinco minutos y
//     sin tabla. Sin colección, sin datos o sin conexión, la sección no
//     aparece — nunca deja un hueco pidiendo perdón.
export const SagaSection = ({ game }: SagaSectionProps): React.JSX.Element | null => {
  const navigate = useNavigate();
  const collectionIds = game.igdbCollections?.map((collection) => collection.id) ?? [];
  const { data: members = [], isLoading } = useCollectionGames(collectionIds);
  const { data: libraryGames = [] } = useGames();
  const { data: plannedGames = [] } = usePlannedGames();

  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<CollectionGame | null>(null);
  const [addTo, setAddTo] = useState<{ where: 'plan' | 'library'; game: CollectionGame } | null>(
    null,
  );

  if (collectionIds.length === 0) return null;

  if (isLoading) {
    return (
      <div className="mt-7.5">
        <div className="mb-3.25 flex items-center justify-between">
          <SectionLabel>THE SAGA</SectionLabel>
          <div className="h-7" />
        </div>
        <div className="flex gap-3">
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <div key={i} className={slideShellClass}>
              <div className="aspect-3/4 animate-pulse rounded-[10px] bg-white/[0.06]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Un juego solo en su colección no es una saga: es este mismo juego. La
  // sección entera sobra.
  if (members.length < 2) return null;

  // El cruce con TU biblioteca es por igdbId exacto — el mismo emparejado que
  // ya hace el buscador de Add Game para reconocer lo que ya tienes.
  const ownedByIgdbId = new Map<number, Owned>();
  for (const owned of libraryGames) {
    ownedByIgdbId.set(owned.igdbId, {
      kind: 'library',
      gameId: owned.id,
      state: owned.currentState,
    });
  }
  for (const planned of plannedGames) {
    ownedByIgdbId.set(planned.igdbId, { kind: 'plan', gameId: planned.id });
  }

  const maxIndex = Math.max(0, members.length - 1);
  const trackX = -(Math.min(index, maxIndex) * (SLIDE_WIDTH + SLIDE_GAP));

  const openMember = (member: CollectionGame): void => {
    const owned = ownedByIgdbId.get(member.igdbId) ?? { kind: 'none' as const };
    // La navegación literal de §3.4: si lo tienes, a su ficha (la de
    // biblioteca o la del Plan, según dónde viva); si no, el intermedio.
    if (owned.kind === 'library') void navigate(`/games/${owned.gameId}`);
    else if (owned.kind === 'plan') void navigate(`/plan/${owned.gameId}`);
    else setPending(member);
  };

  return (
    <div className="mt-7.5">
      <div className="mb-3.25 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <SectionLabel>THE SAGA</SectionLabel>
          {/* El nombre de la colección de IGDB: es lo que da sentido a que
              estos juegos estén juntos, y en un Mario o un Pokémon distingue
              "Super Mario" de "Mario Kart" sin tener que deducirlo. */}
          <span className="truncate text-[11px] font-semibold text-muted-foreground/60">
            {game.igdbCollections?.map((collection) => collection.name).join(' · ')}
          </span>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <span className="text-[11px] text-muted-foreground tabular-nums">{members.length}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index <= 0}
              aria-label="Previous game"
              className={pagerButtonClass}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setIndex((current) => Math.min(maxIndex, current + 1))}
              disabled={index >= maxIndex}
              aria-label="Next game"
              className={pagerButtonClass}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* -my-2 py-2, mismo motivo exacto que en ScreenshotsCarousel: el
          overflow-hidden recorta a los lados, pero sin margen vertical se
          comía el borde superior de la carátula levantada por el hover. */}
      <div className="-my-2 overflow-hidden py-2">
        <div
          className="flex gap-3 transition-transform duration-320 ease-[cubic-bezier(.4,0,.2,1)]"
          style={{ transform: `translateX(${trackX}px)` }}
        >
          {members.map((member) => (
            <SagaSlide
              key={member.igdbId}
              game={member}
              owned={ownedByIgdbId.get(member.igdbId) ?? { kind: 'none' }}
              isCurrent={member.igdbId === game.igdbId}
              onSelect={() => openMember(member)}
            />
          ))}
        </div>
      </div>

      {pending && (
        <WhereToAddDialog
          title={pending.title}
          onCancel={() => setPending(null)}
          onPick={(where) => {
            setAddTo({ where, game: pending });
            setPending(null);
          }}
        />
      )}

      {/* Montado solo al abrirse: el juego preseleccionado vive en los
          inicializadores de estado del modal, así que necesita montarse de
          cero con el juego ya elegido (mismo motivo que el modo promote). */}
      {addTo && (
        <AddGameModal
          open
          onOpenChange={(next) => {
            if (!next) setAddTo(null);
          }}
          mode={addTo.where === 'plan' ? 'plan' : 'library'}
          preselected={toSearchResult(addTo.game)}
          onCreated={(gameId) => {
            setAddTo(null);
            void navigate(addTo.where === 'plan' ? `/plan/${gameId}` : `/games/${gameId}`);
          }}
        />
      )}
    </div>
  );
};

// El modal de alta habla en IgdbSearchResult (es lo que le da su buscador).
// Un miembro de la saga trae menos campos —no se piden plataformas ni géneros
// para pintar veinticinco carátulas— y eso está bien: el modal completa el
// resto con el detalle de IGDB en cuanto se abre, igual que haría con un
// resultado de búsqueda.
const toSearchResult = (game: CollectionGame): IgdbSearchResult => ({
  igdbId: game.igdbId,
  title: game.title,
  coverUrl: game.coverUrl,
  releaseYear: game.releaseYear,
  platforms: [],
  genres: [],
  summary: null,
});
