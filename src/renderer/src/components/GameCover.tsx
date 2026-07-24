import { Gamepad2 } from 'lucide-react';
import type { ImageCacheType } from '../../../shared/types';
import { useImageSrc } from '../hooks/useImageSrc';

type GameCoverProps = {
  url: string | null;
  // Clases del contenedor (tamaño, borde, radio, overflow…) — cada sitio
  // conserva las suyas exactas, esto solo saca el bloque useImageSrc +
  // <img>/fallback que estaba copiado en 6 sitios distintos.
  className: string;
  iconSize: number;
  type?: ImageCacheType;
  // Clases extra para el <img> — por defecto solo cubre el contenedor.
  // Assign Session lo usa para el zoom-en-hover (group-hover/...:scale-...)
  // al estilo SearchStep; el resto de sitios no lo pasa y se queda como
  // estaba.
  imgClassName?: string;
};

export const GameCover = ({
  url,
  className,
  iconSize,
  type = 'covers',
  imgClassName,
}: GameCoverProps): React.JSX.Element => {
  const src = useImageSrc(url, type);
  return (
    <div className={className}>
      {src ? (
        <img
          src={src}
          loading="lazy"
          alt=""
          className={`h-full w-full object-cover ${imgClassName ?? ''}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Gamepad2 size={iconSize} className="text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};
