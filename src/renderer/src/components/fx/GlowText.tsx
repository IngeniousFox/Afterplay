import { createElement } from 'react';
import { cn } from '@/lib/utils';

// GLOW TEXT: el bloom del fósforo. Un text-shadow en capas (un halo fino y
// otro ancho) del color del tono, para cifras y títulos clave. Solo en
// héroes y cifras: en texto de lectura cansa.
//
//   <GlowText>23h</GlowText>                         ámbar, quieto
//   <GlowText as="h2" tone="bone" flicker>Hades</GlowText>   parpadeo de encendido
//   <GlowText breathe className="text-phosphor">01:23:45</GlowText>
//
//   · tone     phosphor (por defecto) | tube | live | bone: el color del halo,
//              no el del texto (ponlo tú con text-*). bone da un halo ámbar
//              muy suave, para títulos claros sobre arte.
//   · breathe  el halo respira (3.6 s, en bucle). Para lo que está vivo: el
//              cronómetro de una sesión.
//   · flicker  parpadeo de tubo al montar (900 ms, una vez). Para lo que
//              acaba de encenderse.
//
// Reduced motion: sin respiración ni parpadeo; el halo se queda fijo.

type Tone = 'phosphor' | 'tube' | 'live' | 'bone';

// Las clases van literales para que Tailwind las encuentre. --glow alimenta
// el keyframe glow-breathe (fosforo.css).
const TONE: Record<Tone, string> = {
  phosphor:
    '[--glow:var(--color-phosphor)] [text-shadow:0_0_1px_rgb(255_179_71/0.45),0_0_18px_rgb(255_179_71/0.32)]',
  tube: '[--glow:var(--color-tube)] [text-shadow:0_0_1px_rgb(95_211_224/0.45),0_0_18px_rgb(95_211_224/0.3)]',
  live: '[--glow:var(--color-live)] [text-shadow:0_0_1px_rgb(255_94_87/0.45),0_0_18px_rgb(255_94_87/0.3)]',
  bone: '[--glow:var(--color-phosphor)] [text-shadow:0_0_1px_rgb(233_228_216/0.3),0_0_24px_rgb(255_179_71/0.22)]',
};

type GlowTag = 'span' | 'h1' | 'h2' | 'h3' | 'p' | 'div' | 'dd';

export const GlowText = ({
  as = 'span',
  tone = 'phosphor',
  breathe = false,
  flicker = false,
  className,
  ...rest
}: {
  as?: GlowTag;
  tone?: Tone;
  breathe?: boolean;
  flicker?: boolean;
} & React.HTMLAttributes<HTMLElement>): React.JSX.Element =>
  createElement(as, {
    ...rest,
    className: cn(
      TONE[tone],
      // Las dos animaciones pueden ir juntas: la de parpadeo es opacity y la
      // de respirar text-shadow.
      breathe && flicker
        ? 'animate-[glow-flicker_900ms_linear_both,glow-breathe_3.6s_var(--ease-in-out)_900ms_infinite]'
        : breathe
          ? 'animate-glow-breathe'
          : flicker
            ? 'animate-glow-flicker'
            : undefined,
      'motion-reduce:animate-none',
      className,
    ),
  });
