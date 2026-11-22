import { useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { prefersReducedMotion } from './motion';

// GLITCH: una interferencia breve (240 ms) al ENTRAR en un estado malo, como
// perder la conexión. Nunca en bucle.
//
//   <Glitch active={offline} as="div" className="…">…</Glitch>
//
// El escritorio separa los canales con drop-shadow (un filter). Aquí, solo
// transform y opacity: el contenido tiembla a saltos (translateX y skewX) y
// dos franjas de color, roja y cian, cruzan desplazadas y se apagan, como un
// desgarro de señal. Las franjas son capas absolutas: el contenedor tiene que
// estar posicionado (relative, sticky…; ponlo tú en className) y recorta lo
// que sobresale.
//
// Reduced motion: sin temblor ni franjas; un parpadeo de opacidad.

const SHAKE: Keyframe[] = [
  { transform: 'none' },
  { offset: 0.15, transform: 'translateX(-3px)' },
  { offset: 0.35, transform: 'translateX(3px) skewX(-8deg)' },
  { offset: 0.55, transform: 'translateX(-1px)' },
  { offset: 0.75, transform: 'translateX(1px)' },
  { transform: 'none' },
];

const tear = (dx: number): Keyframe[] => [
  { opacity: 0, transform: 'translateX(0)' },
  { offset: 0.12, opacity: 0.9, transform: `translateX(${dx}px)` },
  { offset: 0.45, opacity: 0.6, transform: `translateX(${-dx}px)` },
  { offset: 0.7, opacity: 0, transform: 'translateX(0)' },
  { opacity: 0, transform: 'translateX(0)' },
];

type GlitchTag = 'span' | 'div';

export const Glitch = ({
  active,
  replayKey,
  as: Tag = 'span',
  className,
  children,
  ...rest
}: {
  active: boolean;
  replayKey?: unknown;
  as?: GlitchTag;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>): React.JSX.Element => {
  const ref = useRef<HTMLElement | null>(null);
  const red = useRef<HTMLSpanElement | null>(null);
  const cyan = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof element.animate !== 'function') return undefined;
    if (prefersReducedMotion()) {
      const blink = element.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], {
        duration: 240,
        easing: 'ease-out',
      });
      return () => blink.cancel();
    }
    const timing = { duration: 240, easing: 'steps(6, end)' };
    const animations = [element.animate(SHAKE, timing)];
    if (red.current) animations.push(red.current.animate(tear(6), timing));
    if (cyan.current) animations.push(cyan.current.animate(tear(-5), timing));
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [active, replayKey]);

  return (
    <Tag
      {...rest}
      ref={(node: HTMLElement | null) => {
        ref.current = node;
      }}
      className={cn('overflow-hidden', className)}
    >
      <span
        ref={red}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[22%] h-[18%] bg-live/55 opacity-0 mix-blend-screen"
      />
      <span
        ref={cyan}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[58%] h-[14%] bg-tube/55 opacity-0 mix-blend-screen"
      />
      {children}
    </Tag>
  );
};
