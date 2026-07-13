import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

const controlButtonClass = cn(
  'flex h-full w-11 items-center justify-center text-muted-foreground outline-none',
  'hover:bg-muted focus-visible:bg-muted',
);

const TitleBar = (): React.JSX.Element => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => window.api.window.onMaximizedChange(setIsMaximized), []);

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-7 items-center justify-between border-b border-border bg-card pl-3 text-foreground select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-[14px] font-semibold">Afterplay</span>
      <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
