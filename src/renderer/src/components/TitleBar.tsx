import { Copy, Minus, Square, Tv2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useFullscreen } from '../hooks/useFullscreen';
import { requestEnterBigPicture } from '../hooks/useBigPicture';
import { cn } from '@/lib/utils';

const controlButtonClass = cn(
  'flex h-full w-11 items-center justify-center text-muted-foreground outline-none',
  'hover:bg-muted focus-visible:bg-muted',
);

const TitleBar = (): React.JSX.Element | null => {
  const [isMaximized, setIsMaximized] = useState(false);
  const fullscreen = useFullscreen();

  useEffect(() => window.api.window.onMaximizedChange(setIsMaximized), []);

  // Marca en <html> el hueco de 2rem que #root le reserva a esta barra (ver
  // main.css) para que se lo quede el contenido: sin esto, F11 quitaba el
  // chrome del SO pero dejaba una franja vacía del tamaño de la TitleBar
  // flotando en la parte de arriba — "pantalla completa" a medias.
  useEffect(() => {
    document.documentElement.classList.toggle('is-fullscreen', fullscreen);
  }, [fullscreen]);

  if (fullscreen) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-60 flex h-7 items-center justify-between border-b border-border bg-card pl-3 text-foreground select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-sm font-semibold">Afterplay</span>
      <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Big Picture (BIG-PICTURE.md §2): el disparador descubrible sin
            leer ningún manual — los otros tres (F11, --bigpicture, segunda
            instancia) hay que conocerlos. */}
        <button
          type="button"
          aria-label="Big Picture mode"
          title="Big Picture (F11)"
          onClick={() => requestEnterBigPicture()}
          className={controlButtonClass}
        >
          <Tv2 className="size-3.5" strokeWidth={2.25} />
        </button>
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => window.api.window.minimize()}
          className={controlButtonClass}
        >
          <Minus className="size-3.5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          onClick={() => window.api.window.maximize()}
          className={controlButtonClass}
        >
          {isMaximized ? (
            <Copy className="size-3.5" strokeWidth={2.5} />
          ) : (
            <Square className="size-3.5" strokeWidth={2.5} />
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={() => window.api.window.close()}
          className={cn(
            controlButtonClass,
            'hover:bg-destructive/20 hover:text-destructive focus-visible:bg-destructive/20 focus-visible:text-destructive',
          )}
        >
          <X className="size-4.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
