import type { LucideIcon } from 'lucide-react';
import { Newspaper, RefreshCw, ThumbsUp, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { GameDetail } from '../../../../../shared/types';
import { useRefreshGameRatings } from '../../../hooks/igdb';
import { formatCount } from '../../../lib/format';
import { CRITICS_COLOR, PLAYERS_COLOR, resolveRatings, STEAM_BLUE } from '../../../lib/ratings';

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
  suffix,
  countLabel,
  countTitle,
}: {
  icon: LucideIcon;
  label: string;
  color: string;
  // null = sin nota con muestra suficiente — el tile se queda apagado con el
  // motivo debajo, en vez de desaparecer (que era justo lo que hacía que las
  // notas pasaran desapercibidas cuando vivían en Details).
  score: number | null;
  suffix?: string;
  countLabel: string;
  // El conteo EXACTO, para el hover: la etiqueta va redondeada ("416K") para
  // que quepa en 81px, pero el numero de verdad no se pierde.
  countTitle?: string;
}): React.JSX.Element => {
  const active = score !== null;
  return (
    <div
      className="min-w-0 flex-1 rounded-[10px] border px-2 py-2.75 text-center"
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
        {active ? `${score}${suffix ?? ''}` : '—'}
      </div>
      <div className="mt-1.25 truncate text-[10px] text-muted-foreground" title={countTitle}>
        {countLabel}
      </div>
    </div>
  );
};

// Card "Ratings" del sidebar — qué opina el mundo de este juego, en notas que
// a propósito NUNCA se funden en una (se investigó a fondo Metacritic/RAWG/
// OpenCritic/MobyGames/Giant Bomb como alternativas y todas quedaron
// descartadas: sin API pública, sin cobertura retro real, o de pago).
//
// Tres fuentes, tres poblaciones distintas, y cada juego tiene las que tiene:
//  · CRITICS — la crítica que agrega IGDB. Solo existe de forma fiable desde
//    que existen agregadores (~2000): un juego de SNES no la tiene.
//  · PLAYERS — la comunidad de IGDB. Al revés: los clásicos llevan dos
//    décadas acumulando votos y un lanzamiento reciente aún tiene pocos.
//  · STEAM — el % de reseñas positivas (PLAN-TO-PLAY.md §9), con la muestra
//    más grande que existe: Hollow Knight ronda las 415.000 reseñas frente a
//    los ~1.400 votos que tiene en IGDB.
//
// El de Steam solo aparece CUANDO HAY DATO, y su ausencia no se enseña — a
// diferencia de los otros dos, que sí dejan su hueco apagado con el motivo.
// La diferencia no es capricho: un juego moderno sin crítica dice algo, pero
// un retro emulado sin Steam es lo NORMAL, no algo que haya que explicar.
//
// Card propia y no un rincón de Details (donde nació y nadie la veía): es EL
// dato de referencia junto a How long to beat — cuánto dura, y si vale la
// pena. En la ficha del Plan es directamente material de decisión.
export const RatingsCard = ({ game }: RatingsCardProps): React.JSX.Element => {
  const refresh = useRefreshGameRatings();
  const ratings = resolveRatings(game);

  const hasAny = ratings.critics !== null || ratings.players !== null || ratings.steam !== null;

  return (
    <div className="rounded-[14px] border border-border bg-card px-5 py-4.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[13.5px] font-bold text-foreground">Ratings</span>
          {/* Volver a preguntarle a IGDB — mismo gesto discreto que el
              refresco de How long to beat, y por el mismo motivo: estas
              cifras se piden en el alta y se mueven por debajo (un
              lanzamiento reciente gana crítica y votos cada semana). El de
              Steam no entra aquí: viene de SteamSpy y se refresca con el
              botón de lotes (el del Plan o el de Ajustes). */}
          <button
            type="button"
            disabled={refresh.isPending}
            onClick={() => {
              refresh.mutate(game.id, {
                onSuccess: (refreshed) => {
                  if (!refreshed) {
                    toast.info(
                      "This game isn't in IGDB's catalog anymore — ratings kept as they were.",
                    );
                  } else if (refreshed.ratingCritics === null && refreshed.ratingUsers === null) {
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
          out of 100
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
            color={CRITICS_COLOR}
            score={ratings.critics}
            countLabel={
              ratings.critics !== null
                ? `${formatCount(ratings.criticsCount)} ${ratings.criticsCount === 1 ? 'review' : 'reviews'}`
                : 'No critic reviews'
            }
            countTitle={`${ratings.criticsCount.toLocaleString('en-US')} critic reviews aggregated by IGDB`}
          />
          <ScoreTile
            icon={Users}
            label="PLAYERS"
            color={PLAYERS_COLOR}
            score={ratings.players}
            countLabel={
              ratings.players !== null
                ? `${formatCount(ratings.playersCount)} ${ratings.playersCount === 1 ? 'rating' : 'ratings'}`
                : ratings.playersCount > 0
                  ? `Only ${ratings.playersCount.toLocaleString('en-US')} so far`
                  : 'No player ratings'
            }
            countTitle={`${ratings.playersCount.toLocaleString('en-US')} ratings from the IGDB community`}
          />
          {ratings.steam !== null && (
            <ScoreTile
              icon={ThumbsUp}
              label="STEAM"
              color={STEAM_BLUE}
              score={ratings.steam}
              suffix="%"
              countLabel={`${formatCount(ratings.steamCount)} reviews`}
              countTitle={`${ratings.steamCount.toLocaleString('en-US')} Steam reviews`}
            />
          )}
        </div>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          No ratings on IGDB yet — try the refresh, or check back once more people have played it.
        </p>
      )}
    </div>
  );
};
