import { cn } from '../../lib/cn';
import { loopPlayClass } from './motion';
import { useOffscreenPause } from './viewport';

// VU METER: barras de ecualizador que «bailan» mientras hay una sesión en
// marcha. CSS puro (scaleY desde la base, keyframe `vu` de fosforo.css), cada
// barra con su duración y su desfase.
//
//   <VuMeter />                      4 barras, ámbar, 14 px de alto
//   <VuMeter bars={5} tone="live" className="h-4" />
//
// Decorativo (aria-hidden): el estado ya lo dice el texto de al lado. Se
// pausa fuera de la vista y con la pestaña oculta. Reduced motion: barras
// quietas a alturas distintas, que siguen leyéndose como medidor.

const PATTERN = [
  { duration: 720, delay: -120, rest: 0.55 },
  { duration: 940, delay: -460, rest: 0.85 },
  { duration: 610, delay: -260, rest: 0.4 },
  { duration: 860, delay: -620, rest: 0.7 },
  { duration: 680, delay: -340, rest: 0.5 },
];

const TONE = {
  phosphor: 'bg-phosphor shadow-[0_0_5px_rgb(255_179_71/0.5)]',
  live: 'bg-live shadow-[0_0_5px_rgb(255_94_87/0.5)]',
} as const;

export const VuMeter = ({
  bars = 4,
  tone = 'phosphor',
  className,
}: {
  bars?: number;
  tone?: keyof typeof TONE;
  className?: string;
}): React.JSX.Element => {
  const { observe, playState } = useOffscreenPause();
  return (
    <span
      ref={observe}
      aria-hidden="true"
      className={cn('inline-flex h-3.5 flex-none items-end gap-0.5', className)}
    >
      {Array.from({ length: bars }, (_, index) => {
        const bar = PATTERN[index % PATTERN.length];
        return (
          <span
            key={index}
            className={cn(
              'block h-full w-0.75 origin-bottom rounded-[1px] animate-vu motion-reduce:animate-none',
              TONE[tone],
              loopPlayClass,
            )}
            style={{
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
