import { cn } from '../../lib/cn';
import { loopPlayClass } from './motion';
import { useOffscreenPause } from './viewport';

// FONDOS DE HÉROE: capas absolutas (inset-0, sin eventos) para poner DENTRO de
// un contenedor `relative overflow-hidden` con arte. Nunca encima de texto
// largo: van sobre el arte, detrás del contenido.
//
//   <div className="relative overflow-hidden">
//     <img className="animate-ken-burns motion-reduce:animate-none" … />
//     <ScanBeam every={9} />   un haz de luz que baja cada 9 s
//     <Grain />                grano de fósforo, muy sutil
//   </div>
//
// Ken Burns es solo una clase (`animate-ken-burns`, fosforo.css); añade
// `loopPlayClass` para que se pare con la pestaña oculta.
//
// Solo animan transform. Se pausan fuera de la vista (IntersectionObserver
// compartido) y con la pestaña oculta (--fx-play). Reduced motion: quietas.

export const ScanBeam = ({
  every = 8,
  className,
}: {
  every?: number;
  className?: string;
}): React.JSX.Element => {
  const { observe, playState } = useOffscreenPause();
  return (
    <span
      ref={observe}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <span
        className={cn(
          'absolute inset-x-0 top-0 block h-1/4 animate-scan-beam bg-(image:--beam) [--beam-travel:400%] motion-reduce:hidden',
          loopPlayClass,
        )}
        style={
          {
            '--beam-period': `${every}s`,
            animationPlayState: playState,
          } as React.CSSProperties
        }
      />
    </span>
  );
};

// Grano: ruido fractal (--grain) que salta de sitio 5 veces por segundo. A
// saltos (steps), no a 60 fps.
export const Grain = ({ className }: { className?: string }): React.JSX.Element => {
  const { observe, playState } = useOffscreenPause();
  return (
    <span
      ref={observe}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden opacity-8', className)}
    >
      <span
        className={cn(
          'absolute -inset-[10%] block animate-grain bg-(image:--grain) bg-size-[160px] motion-reduce:animate-none',
          loopPlayClass,
        )}
        style={{ animationPlayState: playState }}
      />
    </span>
  );
};
