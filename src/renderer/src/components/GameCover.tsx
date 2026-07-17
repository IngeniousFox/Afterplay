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
};

export const GameCover = ({
  url,
  className,
  iconSize,
  type = 'covers',
}: GameCoverProps): React.JSX.Element => {
  const src = useImageSrc(url, type);
  return (
    <div className={className}>
      {src ? (
        <img src={src} loading="lazy" alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <Gamepad2 size={iconSize} className="text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};
