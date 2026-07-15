import { ArrowLeft, Gamepad2 } from 'lucide-react';
import type { GameDetail } from '../../../../../shared/types';
import { useImageSrc } from '../../../hooks/useImageSrc';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { formatElapsed } from '../../../lib/format';
import { getGameStatusMeta, STATUS_META } from '../../../lib/gameStatus';
import { CoverThumb } from '../add-game/CoverThumb';

type HeroBannerProps = {
  game: GameDetail;
  liveSince: Date | null;
  onBack: () => void;
  // La ficha de Plan to Play vuelve a /plan, no a la biblioteca.
  backLabel?: string;
};

// SPEC 10.6/10.7 + prototipo Backlog.html — hero 316px, degradado vertical
// (transparente arriba -> --bg abajo) + degradado horizontal (oscuro
// izquierda -> transparente 45%), botón glass de vuelta, badge PLAYING con
// pulso si hay sesión en marcha, carátula 118×158 + título 38px/800 +
// badge de estado + metadatos superpuestos abajo-izquierda.
export const HeroBanner = ({
  game,
  liveSince,
  onBack,
  backLabel = 'Back to library',
}: HeroBannerProps): React.JSX.Element => {
  const heroSrc = useImageSrc(game.heroUrl, 'heroes');
  // Un juego planeado no tiene estado real (currentState deriva ignorando
  // el evento de plan — ver getGameById) — su badge es el del Plan.
  const status = game.planned ? STATUS_META.plan : getGameStatusMeta(game.currentState);
  const elapsedSeconds = useLiveTimer(liveSince);

  const meta = [
    game.genres?.join(', '),
    game.officialPlatforms?.join(', '),
    game.releaseYear ? `Released ${game.releaseYear}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="relative h-79 overflow-hidden">
      {heroSrc ? (
        <img src={heroSrc} alt="" className="block h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Gamepad2 size={64} strokeWidth={1.5} className="text-muted-foreground/30" />
        </div>
      )}

      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg,rgba(10,11,10,.15) 0%,rgba(10,11,10,.55) 55%,#0a0b0a 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg,rgba(10,11,10,.7),transparent 45%)' }}
      />

      <button
        type="button"
        onClick={onBack}
        className="absolute top-5 left-6 flex items-center gap-1.75 rounded-[9px] border border-white/8 px-3 py-1.75 text-[13px] text-foreground"
        style={{ background: 'rgba(8,12,10,.66)' }}
      >
        <ArrowLeft size={16} />
        <span>{backLabel}</span>
      </button>

      {liveSince && (
        <div className="absolute top-5 right-6 flex items-center gap-2.5">
          <div
            className="flex items-center gap-1.75 rounded-[9px] border px-2.75 py-1.5"
            style={{
              background: 'rgba(8,20,13,.7)',
              borderColor: 'rgba(47,220,126,.55)',
              animation: 'afterplay-pulse-badge 2.4s infinite',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary"
              style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
            />
            <span className="text-[10px] font-extrabold tracking-[.1em] text-primary">PLAYING</span>
            <span className="border-l border-primary/30 pl-2.25 text-[12.5px] font-bold text-primary tabular-nums">
              {formatElapsed(elapsedSeconds)}
            </span>
          </div>
        </div>
      )}

      <div className="absolute inset-x-6 bottom-6 left-8.5 flex items-end gap-5">
        <div className="h-39.5 w-29.5 flex-none overflow-hidden rounded-xl border border-white/16 shadow-[0_12px_34px_rgba(0,0,0,.55)]">
          <CoverThumb url={game.coverUrl} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 pb-1">
          <h1
            className="m-0 truncate text-[38px] font-extrabold tracking-[-.02em] text-white"
            style={{ textShadow: '0 2px 14px rgba(0,0,0,.6)' }}
          >
            {game.title}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-3.5">
            <div
              className="flex items-center gap-1.75 rounded-lg border border-white/8 px-2.75 py-1.25"
              style={{ background: 'rgba(8,12,10,.66)' }}
            >
              <status.Icon
                size={14}
                color={status.color}
                fill={status.filled ? status.color : 'none'}
              />
              <span className="text-[13px] font-semibold" style={{ color: status.color }}>
                {status.label}
              </span>
            </div>
            {meta && <span className="text-[13px] text-muted-foreground">{meta}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
