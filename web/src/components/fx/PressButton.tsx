import { useState } from 'react';
import { cn } from '../../lib/cn';
import { pressClass } from './press';

// PRESS BUTTON: se hunde al pulsar y rebota (pressClass) y, con `burst`, suelta
// un anillo que se expande y un destello (keyframes press-ring y press-flash
// de fosforo.css: transform y opacidad). Para los momentos: Stop, Start.
//
//   <PressButton burst="live" className={…} onClick={…}>
//
// Cada pulsación monta un anillo nuevo (cambia la clave): su animación CSS
// arranca sola y al acabar queda en opacity 0. Reduced motion: sin anillo ni
// hundirse; el destello queda como un fundido.

type Burst = 'phosphor' | 'live';

const RING: Record<Burst, string> = {
  phosphor: 'border-phosphor',
  live: 'border-live',
};
const FLASH: Record<Burst, string> = {
  phosphor:
    'bg-[radial-gradient(circle,rgb(255_236_200/0.85),rgb(255_179_71/0.35)_45%,transparent_70%)]',
  live: 'bg-[radial-gradient(circle,rgb(255_220_216/0.8),rgb(255_94_87/0.35)_45%,transparent_70%)]',
};

export const PressButton = ({
  burst,
  className,
  onClick,
  children,
  ...rest
}: {
  burst?: Burst;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element => {
  const [shots, setShots] = useState(0);
  return (
    <button
      type="button"
      {...rest}
      onClick={(event) => {
        if (burst) setShots((count) => count + 1);
        onClick?.(event);
      }}
      className={cn('relative isolate', className, pressClass)}
    >
      {burst && shots > 0 && (
        <span
          key={shots}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        >
          <span
            className={cn(
              'absolute inset-0 animate-press-ring rounded-[inherit] border-2 [--ring-to-y:1.6] motion-reduce:hidden',
              RING[burst],
            )}
          />
          <span
            className={cn('absolute -inset-3 animate-press-flash rounded-full', FLASH[burst])}
          />
        </span>
      )}
      {children}
    </button>
  );
};
