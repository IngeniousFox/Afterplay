import { createElement } from 'react';
import { cn } from '../../lib/cn';
import { loopPlayClass } from './motion';

// GLOW TEXT: el bloom del fósforo en cifras y títulos clave.
//
//   <GlowText>23h</GlowText>                              halo ámbar fijo
//   <GlowText breathe className="text-phosphor">01:23:45</GlowText>
//   <GlowText as="span" tone="live" flicker>LIVE</GlowText>
//
// El halo del texto es un text-shadow FIJO (se pinta una vez). Lo que
// respira no es la sombra —animar text-shadow repinta el texto cada frame,
// caro en un móvil— sino una mancha de luz con degradado radial detrás de
// las cifras que sube y baja de OPACIDAD (3.6 s, compositor). Para lo que
// está vivo: el cronómetro.
//
// `flicker`: parpadeo de tubo al montar (opacidad, una vez).
// Reduced motion: sin respiración ni parpadeo; el halo queda fijo.

type Tone = 'phosphor' | 'live' | 'bone';

const TONE: Record<Tone, string> = {
  phosphor: '[text-shadow:0_0_1px_rgb(255_179_71/0.45),0_0_16px_rgb(255_179_71/0.32)]',
  live: '[text-shadow:0_0_1px_rgb(255_94_87/0.45),0_0_16px_rgb(255_94_87/0.3)]',
  bone: '[text-shadow:0_0_1px_rgb(233_228_216/0.3),0_0_20px_rgb(255_179_71/0.22)]',
};

const HALO: Record<Tone, string> = {
  phosphor: 'bg-[radial-gradient(closest-side,rgb(255_179_71/0.26),transparent)]',
  live: 'bg-[radial-gradient(closest-side,rgb(255_94_87/0.24),transparent)]',
  bone: 'bg-[radial-gradient(closest-side,rgb(255_179_71/0.16),transparent)]',
};

type GlowTag = 'span' | 'h1' | 'h2' | 'p' | 'div';

export const GlowText = ({
  as = 'span',
  tone = 'phosphor',
  breathe = false,
  flicker = false,
  className,
  children,
  ...rest
}: {
  as?: GlowTag;
  tone?: Tone;
  breathe?: boolean;
  flicker?: boolean;
} & React.HTMLAttributes<HTMLElement>): React.JSX.Element =>
  createElement(
    as,
    {
      ...rest,
      className: cn(
        'relative isolate',
        TONE[tone],
        flicker && 'animate-glow-flicker motion-reduce:animate-none',
        className,
      ),
    },
    breathe && (
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -inset-x-4 -inset-y-3 -z-10 block',
          HALO[tone],
          'animate-[led-live_3.6s_var(--ease-in-out)_infinite] motion-reduce:animate-none motion-reduce:opacity-70',
          loopPlayClass,
        )}
      />
    ),
    children,
  );
