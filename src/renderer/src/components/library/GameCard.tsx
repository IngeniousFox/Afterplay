import { Gamepad2, Play } from 'lucide-react';
import type { GameListItem } from '../../../../shared/types';
import { useImageSrc } from '../../hooks/useImageSrc';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { formatElapsed } from '../../lib/format';
import { getGameStatusMeta } from '../../lib/gameStatus';

type GameCardProps = {
  game: GameListItem;
  onSelect: () => void;
};

// SPEC 10.6/10.7 — carátula 3/4, borde 13px, oscurecida un punto de forma
// permanente (no solo al hover). El zoom de hover va SOLO en la <img>, no en
// la card entera — escalar cualquier contenido de trazo fino con CSS
// transform (texto, iconos) lo desenfoca mientras el navegador rasteriza la
// capa durante la transición; escalando solo la imagen dentro de un
// contenedor con overflow-hidden se consigue el mismo "zoom" visual sin
// tocar nada que se pueda desenfocar. De paso la card ya no crece por fuera
// de su celda del grid (que era lo que hacía falta el z-index y lo que
// pisaba la fila de abajo con la sombra del prototipo — sombra ya quitada
// por eso mismo). Para el hueco sin carátula (ver más abajo) el mismo
// motivo aplica al icono de repuesto: ahí el feedback de hover es de
// color/opacidad, no de escala.
// Si el juego está en marcha: glow del borde, badge PLAYING pulsante,
// círculo de play centrado y contador en vivo — el mismo repertorio que el
// prototipo, campo a campo.
export const GameCard = ({ game, onSelect }: GameCardProps): React.JSX.Element => {
  const status = getGameStatusMeta(game.currentState);
  const coverSrc = useImageSrc(game.coverUrl, 'covers');
  const elapsedSeconds = useLiveTimer(game.isLive ? game.liveSince : null);

  return (
    <div
      onClick={onSelect}
      className="group relative cursor-pointer overflow-hidden rounded-[13px] border border-border bg-card"
    >
      <div className="relative aspect-3/4 overflow-hidden">
        {coverSrc ? (
          <img
            src={coverSrc}
            loading="lazy"
            alt={game.title}
            className="block h-full w-full scale-100 object-cover brightness-80 transition-[scale] duration-250 ease-[cubic-bezier(.2,.7,.3,1)] will-change-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted">
            <Gamepad2
              size={48}
              strokeWidth={1.5}
              className="text-muted-foreground/40 transition-colors duration-250 ease-[cubic-bezier(.2,.7,.3,1)] group-hover:text-muted-foreground/70"
            />
          </div>
        )}

        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, transparent 55%, rgba(8,9,8,.86) 100%)' }}
        />

        {game.isLive && (
          <>
            <div
              className="absolute inset-0 rounded-[13px]"
              style={{ animation: 'afterplay-glow-card 2.6s ease-in-out infinite' }}
            />
            <div
              className="absolute top-2.75 right-2.75 flex items-center gap-1.25 rounded-[7px] border px-2 py-0.75"
              style={{
                background: 'rgba(8,20,13,.78)',
                borderColor: 'rgba(47,220,126,.55)',
                animation: 'afterplay-pulse-badge 2.4s infinite',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary"
                style={{ animation: 'afterplay-pulse-dot 1.4s infinite' }}
              />
              <span className="text-[9.5px] font-extrabold tracking-widest text-primary">LIVE</span>
            </div>
            <div
              className="absolute top-1/2 left-1/2 flex h-13.5 w-13.5 items-center justify-center rounded-full border-[1.5px] shadow-[0_6px_22px_rgba(0,0,0,0.4)]"
              style={{
                transform: 'translate(-50%, -58%)',
                background: 'rgba(8,12,10,.68)',
                borderColor: 'rgba(47,220,126,.7)',
              }}
            >
              <Play size={20} color="#2fdc7e" fill="#2fdc7e" />
            </div>
            <div
              className="absolute bottom-17.5 left-1/2 -translate-x-1/2 rounded-lg border border-border px-2.5 py-0.75 text-[12.5px] font-bold tracking-[.02em] text-primary tabular-nums"
              style={{ background: 'rgba(8,12,10,.66)' }}
            >
              {formatElapsed(elapsedSeconds)}
            </div>
          </>
        )}

        <div className="absolute inset-x-0 bottom-0 px-3.5 py-3">
          <div
            className="text-[14.5px] font-bold text-white"
            style={{ textShadow: '0 1px 4px rgba(0,0,0,.6)' }}
          >
            {game.title}
          </div>
          <div className="mt-1.25 flex items-center gap-1.5">
            <status.Icon
              size={15}
              color={status.color}
              fill={status.filled ? status.color : 'none'}
              strokeWidth={2}
            />
            <span className="text-xs font-semibold" style={{ color: status.color }}>
              {status.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
