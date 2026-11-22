import { cn } from '@/lib/utils';
import { useOffscreenAnimation } from '../../hooks/useOffscreenAnimation';

// VU METER: barras de ecualizador que «bailan» mientras hay una sesión en
// marcha. Puro CSS (scaleY desde la base); cada barra con su duración y su
// desfase para que no vayan al unísono.
//
//   <VuMeter />                         5 barras, ámbar, 14 px de alto
//   <VuMeter bars={4} tone="live" className="h-3" />
//   <VuMeter active={!silent} />        quieto (alturas fijas) sin señal
//
// Decorativo (aria-hidden): el estado ya lo dice el texto de al lado. Se
// pausa fuera de la vista (útil en las tarjetas «en marcha» de una rejilla
// larga) y con la ventana oculta. Reduced motion o `active` false: barras
// quietas a alturas distintas, que siguen leyéndose como «medidor».

const PATTERN = [
  { duration: 720, delay: -120, rest: 0.55 },
  { duration: 940, delay: -460, rest: 0.85 },
  { duration: 610, delay: -260, rest: 0.4 },
  { duration: 860, delay: -620, rest: 0.7 },
  { duration: 680, delay: -340, rest: 0.5 },
  { duration: 1010, delay: -80, rest: 0.8 },
];

const TONE = {
  phosphor: 'bg-phosphor shadow-[0_0_6px_rgb(255_179_71/0.55)]',
  live: 'bg-live shadow-[0_0_6px_rgb(255_94_87/0.55)]',
  tube: 'bg-tube shadow-[0_0_6px_rgb(95_211_224/0.55)]',
} as const;

export const VuMeter = ({
  bars = 5,
  tone = 'phosphor',
  active = true,
  className,
}: {
  bars?: number;
  tone?: keyof typeof TONE;
  active?: boolean;
  className?: string;
}): React.JSX.Element => {
  const { observe, playState } = useOffscreenAnimation();
  return (
    <span
      ref={observe}
      aria-hidden
      className={cn('inline-flex h-3.5 flex-none items-end gap-0.5', className)}
    >
      {Array.from({ length: bars }, (_, index) => {
        const bar = PATTERN[index % PATTERN.length];
        return (
          <span
            key={index}
            className={cn(
              'block h-full w-0.75 origin-bottom rounded-[1px]',
              TONE[tone],
              active ? 'animate-vu motion-reduce:animate-none' : 'opacity-60',
            )}
            style={{
              // En reposo (sin animación) cada barra se queda a su altura.
              transform: `scaleY(${bar.rest})`,
              animationDuration: `${bar.duration}ms`,
              animationDelay: `${bar.delay}ms`,
              animationPlayState: playState,
            }}
          />
        );
      })}
    </span>
  );
};
