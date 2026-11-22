import { useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from './motion';

// GLITCH: un desplazamiento RGB breve (220 ms) cuando algo se rompe: un error
// de sync, una desconexión. Con MUCHA moderación: solo al ENTRAR en el estado
// malo, nunca en bucle.
//
//   <Glitch active={tone === 'error'}>
//     <span className="size-2 rounded-full bg-live" /> Sync error
//   </Glitch>
//   <Glitch active={offline} replayKey={problemCode} as="div" className="…">
//
// Se dispara al pasar `active` a true (también al montar ya activo) y cada
// vez que cambia `replayKey` estando activo. Es un drop-shadow rojo y cian
// desplazado más un temblor horizontal a saltos; vale igual para texto que
// para un LED. No toca el layout: es un `inline-flex` por defecto.
//
// Reduced motion: sin temblor ni desplazamiento; un parpadeo de opacidad.

const FRAMES: Keyframe[] = [
  { transform: 'translateX(0)', filter: 'none' },
  {
    offset: 0.15,
    transform: 'translateX(-2px)',
    filter: 'drop-shadow(2px 0 0 rgb(255 94 87 / 0.9)) drop-shadow(-2px 0 0 rgb(95 211 224 / 0.9))',
  },
  {
    offset: 0.35,
    transform: 'translateX(2px) skewX(-6deg)',
    filter: 'drop-shadow(-3px 0 0 rgb(255 94 87 / 0.9)) drop-shadow(3px 0 0 rgb(95 211 224 / 0.9))',
  },
  {
    offset: 0.55,
    transform: 'translateX(-1px)',
    filter: 'drop-shadow(1px 0 0 rgb(255 94 87 / 0.8)) drop-shadow(-1px 0 0 rgb(95 211 224 / 0.8))',
  },
  { offset: 0.75, transform: 'translateX(1px)', filter: 'none' },
  { transform: 'translateX(0)', filter: 'none' },
];

const REDUCED: Keyframe[] = [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }];

type GlitchTag = 'span' | 'div';

export const Glitch = ({
  active,
  replayKey,
  as: Tag = 'span',
  className,
  children,
}: {
  active: boolean;
  replayKey?: unknown;
  as?: GlitchTag;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element => {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof element.animate !== 'function') return undefined;
    const reduced = prefersReducedMotion();
    const animation = element.animate(reduced ? REDUCED : FRAMES, {
      duration: 220,
      easing: reduced ? 'ease-out' : 'steps(6, end)',
    });
    return () => animation.cancel();
  }, [active, replayKey]);

  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        ref.current = node;
      }}
      className={cn('inline-flex', className)}
    >
      {children}
    </Tag>
  );
};
