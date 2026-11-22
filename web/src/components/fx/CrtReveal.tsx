import { useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { useCrtReveal, type CrtVariant } from './crt';
import { EASE, prefersReducedMotion } from './motion';

// CRT REVEAL: lo que aparece «se enciende» como un tubo.
//
//   <CrtReveal>…tarjeta…</CrtReveal>                    al montar (panel)
//   <CrtReveal variant="screen" replayKey={pathname}>   cada cambio de pantalla
//   const ref = useCrtReveal<HTMLElement>('panel')       sobre un nodo propio
//
//   · panel  (320 ms) scaleY .02 → 1 y opacidad: tarjetas héroe.
//   · screen (260 ms) solo opacidad: pantallas enteras, sin geometría.
//
// WAAPI con fill 'backwards': al acabar no queda nada puesto. Reduced motion:
// un fundido, sin escala.

export const CrtReveal = ({
  variant = 'panel',
  replayKey,
  delayMs = 0,
  ...rest
}: {
  variant?: CrtVariant;
  replayKey?: unknown;
  delayMs?: number;
} & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => {
  const ref = useCrtReveal<HTMLDivElement>(variant, replayKey, delayMs);
  return <div ref={ref} {...rest} />;
};

// CRT FLASH: el destello de fósforo que acompaña al encendido. Una capa
// absoluta (el padre tiene que estar posicionado) con un degradado ámbar que
// se apaga. En reposo es opacity 0: si no corre, no se ve nada.
//
//   <section className="relative overflow-hidden …">
//     <CrtFlash />                      al montar
//     <CrtFlash replayKey={count} tone="live" />
export const CrtFlash = ({
  replayKey,
  delayMs = 60,
  tone = 'phosphor',
  className,
}: {
  replayKey?: unknown;
  delayMs?: number;
  tone?: 'phosphor' | 'live';
  className?: string;
}): React.JSX.Element => {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== 'function') return undefined;
    const animation = element.animate([{ opacity: 0.9 }, { opacity: 0 }], {
      duration: prefersReducedMotion() ? 240 : 520,
      delay: delayMs,
      easing: EASE.out,
      fill: 'backwards',
    });
    return () => animation.cancel();
  }, [replayKey, delayMs]);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-10 opacity-0',
        tone === 'live'
          ? 'bg-[radial-gradient(120%_70%_at_50%_50%,rgb(255_220_216/0.5),rgb(255_94_87/0.22)_45%,transparent_75%)]'
          : 'bg-[radial-gradient(120%_70%_at_50%_50%,rgb(255_236_200/0.5),rgb(255_179_71/0.22)_45%,transparent_75%)]',
        className,
      )}
    />
  );
};
