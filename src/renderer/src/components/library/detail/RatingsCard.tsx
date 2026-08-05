import type { LucideIcon } from 'lucide-react';
import { Newspaper, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { GameDetail } from '../../../../../shared/types';
import { useRefreshGameRatings } from '../../../hooks/igdb';
import { BLUE, TEAL } from '../../../lib/colors';

// Umbral mínimo de votos para enseñar cada nota — por debajo, un promedio de
// dos o tres votos miente más de lo que informa: mejor un hueco honesto que
// un número que parece fiable y no lo es. Los dos umbrales son distintos
// porque las dos muestras pesan distinto: una reseña de crítica vale por
// varios votos sueltos de comunidad.
const MIN_CRITIC_COUNT = 3;
const MIN_USER_COUNT = 10;

type RatingsCardProps = {
  game: GameDetail;
};

// Tile de nota — el mismo lenguaje que los TierTile de HowLongToBeatCard
// (borde y fondo teñidos, etiqueta diminuta, número gordo), que es la otra
// card de "números de referencia del mundo" del sidebar.
const ScoreTile = ({
  icon: Icon,
  label,
  color,
  score,
  countLabel,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  // null = sin nota con muestra suficiente — el tile se queda apagado con el
  // motivo debajo, en vez de desaparecer (que era justo lo que hacía que las
  // notas pasaran desapercibidas cuando vivían en Details).
  score: number | null;
  countLabel: string;
}): React.JSX.Element => {
  const active = score !== null;
  return (
    <div
      className="flex-1 rounded-[10px] border px-2 py-2.75 text-center"
      style={
        active
          ? { borderColor: `${color}5c`, background: `${color}17` }
          : { borderColor: 'var(--border)', background: 'rgba(255,255,255,.02)' }
      }
    >
      <div className="mb-1.25 flex items-center justify-center gap-1.25">
        <Icon size={11} style={{ color: active ? color : 'var(--muted-foreground)' }} />
        <span
          className="text-[9.5px] font-bold tracking-[.06em]"
          style={{ color: active ? color : 'var(--muted-foreground)' }}
        >
          {label}
        </span>
      </div>
      <div
        className="text-[24px] leading-none font-extrabold tabular-nums"
        style={{ color: active ? color : 'var(--muted-foreground)' }}
      >
        {active ? score : '—'}
      </div>
      <div className="mt-1.25 text-[10px] text-muted-foreground">{countLabel}</div>
    </div>
  );
};

// Card "Ratings" del sidebar — qué opina el mundo de este juego, en dos
// números que a propósito NUNCA se funden en uno (se investigó a fondo
// Metacritic/RAWG/OpenCritic/MobyGames/Giant Bomb como alternativas y todas
// quedaron descartadas: sin API pública, sin cobertura retro real, o de
// pago). La CRÍTICA que agrega IGDB solo existe de forma fiable desde que
// existen agregadores (~2000) — un juego de SNES no la tiene; la nota de
// JUGADORES de su comunidad es al revés: los clásicos llevan dos décadas
// acumulando votos y un lanzamiento reciente aún tiene pocos. Dos tiles
// etiquetados enseñan lo que cada juego de verdad tiene.
//
// Card propia y no un rincón de Details (donde nació y nadie la veía): es
// EL dato de referencia junto a How long to beat — cuánto dura, y si vale
// la pena. En la ficha del Plan es directamente material de decisión.
export const RatingsCard = ({ game }: RatingsCardProps): React.JSX.Element => {
  const refresh = useRefreshGameRatings();

  const criticsScore =
    game.ratingCritics !== null && (game.ratingCriticsCount ?? 0) >= MIN_CRITIC_COUNT
      ? Math.round(game.ratingCritics)
      : null;
  const usersScore =
    game.ratingUsers !== null && (game.ratingUsersCount ?? 0) >= MIN_USER_COUNT
      ? Math.round(game.ratingUsers)
      : null;

  const criticCount = game.ratingCriticsCount ?? 0;
  const userCount = game.ratingUsersCount ?? 0;
  const hasAny = criticsScore !== null || usersScore !== null;

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-bold text-foreground">Ratings</span>
          {/* Volver a preguntarle a IGDB — mismo gesto discreto que el
              refresco de How long to beat, y por el mismo motivo: estas
              cifras se piden en el alta y se mueven por debajo (un
              lanzamiento reciente gana crítica y votos cada semana). */}
          <button
            type="button"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate(game.id, {
                onSuccess: (ratings) => {
                  if (!ratings) {
                    toast.info(
                      "This game isn't in IGDB's catalog anymore — ratings kept as they were.",
                    );
                  } else if (ratings.ratingCritics === null && ratings.ratingUsers === null) {
                    toast.info('IGDB has no ratings for this game yet.');
                  } else {
                    toast.success('Ratings updated from IGDB.');
                  }
                },
                onError: () => toast.error('Could not reach IGDB.'),
              });
            }}
            title="Re-fetch ratings from IGDB"
            aria-label="Refresh ratings"
            className="flex h-5.5 w-5.5 items-center justify-center rounded-full text-muted-foreground/60 transition-colors duration-150 hover:bg-white/[0.07] hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent"
          >
            <RefreshCw size={11} className={refresh.isPending ? 'animate-spin' : undefined} />
          </button>
        </div>
        <span className="flex-none text-[10.5px] font-semibold text-muted-foreground/70">
          via IGDB · out of 100
        </span>
      </div>

      <div className="mt-0.5 mb-3.5 text-xs text-muted-foreground">
        Critics cover modern releases; players cover the classics.
      </div>

      {hasAny ? (
        <div className="flex gap-2">
          <ScoreTile
            icon={Newspaper}
            label="CRITICS"
            color={TEAL}
            score={criticsScore}
            countLabel={
              criticsScore !== null
                ? `${criticCount.toLocaleString()} ${criticCount === 1 ? 'review' : 'reviews'}`
                : 'No critic reviews'
            }
          />
          <ScoreTile
            icon={Users}
            label="PLAYERS"
            color={BLUE}
            score={usersScore}
            countLabel={
              usersScore !== null
                ? `${userCount.toLocaleString()} ${userCount === 1 ? 'rating' : 'ratings'}`
                : userCount > 0
                  ? `Only ${userCount.toLocaleString()} so far`
                  : 'No player ratings'
            }
          />
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          No ratings on IGDB yet — try the refresh, or check back once more people have played it.
        </p>
      )}
    </div>
  );
};
