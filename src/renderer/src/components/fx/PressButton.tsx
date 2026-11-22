import { useState } from 'react';
import { cn } from '@/lib/utils';
import { pressClass } from './press';

// PRESS BUTTON: el botón se hunde al pulsar (scale .95 y sombra interior, en
// 80 ms) y al soltar rebota con un ligero overshoot (--ease-spring, 320 ms).
// Asimétrico a propósito: pulsar es instantáneo, la vuelta tiene cuerpo.
//
//   // Solo la física, sobre cualquier botón existente:
//   <button className={cn(primaryButtonClass, buttonSize.md, pressClass)}>
//
//   // Con anillo expansivo y destello ámbar al pulsar (Play, Stop):
//   <PressButton burst="phosphor" className={cn(primaryButtonClass, …)} onClick={…}>
//
// `pressClass` va DESPUÉS de las clases del botón en cn(): tailwind-merge se
// queda con su escala y su curva. El destello no tapa nada (pointer-events
// none, por encima del fondo y por debajo del texto) y desaparece solo.
//
// Reduced motion: sin hundirse ni anillo; el destello queda como un fundido.

type Burst = 'phosphor' | 'live';

const RING: Record<Burst, string> = {
  phosphor: 'border-phosphor shadow-[0_0_14px_rgb(255_179_71/0.6)]',
  live: 'border-live shadow-[0_0_14px_rgb(255_94_87/0.6)]',
};
const FLASH: Record<Burst, string> = {
  phosphor:
    'bg-[radial-gradient(circle,rgb(255_236_200/0.85),rgb(255_179_71/0.35)_45%,transparent_70%)]',
  live: 'bg-[radial-gradient(circle,rgb(255_220_216/0.8),rgb(255_94_87/0.35)_45%,transparent_70%)]',
};

export const PressButton = ({
  burst,
  ref,
  className,
  onClick,
  children,
  ...rest
}: {
  burst?: Burst;
  ref?: React.Ref<HTMLButtonElement>;
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element => {
  // Cada pulsación monta un anillo nuevo (la clave cambia): su animación CSS
  // arranca sola y, al acabar, queda en opacity 0 hasta la siguiente.
  const [shots, setShots] = useState(0);
  return (
    <button
      type="button"
      {...rest}
      ref={ref}
      onClick={(event) => {
        if (burst) setShots((count) => count + 1);
        onClick?.(event);
      }}
      className={cn('relative isolate', className, pressClass)}
    >
      {burst && shots > 0 && (
        <span
          key={shots}
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
        >
          <span
            className={cn(
              'absolute inset-0 animate-press-ring rounded-[inherit] border-2 motion-reduce:hidden',
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
