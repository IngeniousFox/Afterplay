import { cn } from '@/lib/utils';
import { useOffscreenAnimation } from '../../hooks/useOffscreenAnimation';

// FONDOS DE HÉROE: capas absolutas (inset-0, sin eventos) para poner DENTRO de
// un contenedor `relative overflow-hidden` con arte. Nunca encima de texto de
// lectura larga: van detrás del contenido o sobre el arte.
//
//   <div className="relative overflow-hidden">
//     <img className="animate-ken-burns motion-reduce:animate-none" … />
//     <ScanLines crawl />   scanlines (--scan) que reptan un periodo a saltos
//     <ScanBeam every={9} /> un haz de luz que baja cada 9 s
//     <Grain />             grano de fósforo animado, muy sutil
//     <Vignette />          viñeta oscura en los bordes
//   </div>
//
// Ken Burns es solo una clase: `animate-ken-burns` en la imagen (28 s, ida y
// vuelta, escala 1.04 → 1.12). Con reduced motion se queda quieta a 1.04.
//
// Los bucles se pausan fuera de la vista (useOffscreenAnimation: un
// IntersectionObserver compartido por scroller) y Chromium no los pinta con
// la ventana oculta. Solo animan transform: nada de repintar el fondo.
// Reduced motion: todas quietas.

// El haz: una banda de luz ámbar del 25 % de alto que baja de arriba abajo en
// el primer cuarto del ciclo y descansa el resto. `every` = segundos de ciclo.
export const ScanBeam = ({
  every = 8,
  className,
}: {
  every?: number;
  className?: string;
}): React.JSX.Element => {
  const { observe, playState } = useOffscreenAnimation();
  return (
    <span
      ref={observe}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <span
        className="absolute inset-x-0 top-0 block h-1/4 animate-scan-beam bg-(image:--beam) mix-blend-screen [--beam-travel:400%] motion-reduce:hidden"
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

// Scanlines: la textura --scan de siempre; con `crawl`, reptan 3 px a saltos
// (3 pasos en 1.2 s), que se nota vivo sin pintar a 60 fps.
export const ScanLines = ({
  crawl = false,
  className,
}: {
  crawl?: boolean;
  className?: string;
}): React.JSX.Element => {
  const { observe, playState } = useOffscreenAnimation();
  return (
    <span
      ref={observe}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <span
        className={cn(
          'absolute inset-x-0 -top-0.75 bottom-0 block bg-(image:--scan)',
          crawl && 'animate-scan-crawl motion-reduce:animate-none',
        )}
        style={{ animationPlayState: playState }}
      />
    </span>
  );
};

// Grano: ruido fractal (SVG en --grain) que salta de sitio 5 veces por
// segundo. Una capa un 20 % más grande que su caja para que el salto no deje
// bordes. Muy sutil: opacity .07 por defecto.
export const Grain = ({ className }: { className?: string }): React.JSX.Element => {
  const { observe, playState } = useOffscreenAnimation();
  return (
    <span
      ref={observe}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 overflow-hidden opacity-7', className)}
    >
      <span
        className="absolute -inset-[10%] block animate-grain bg-(image:--grain) bg-size-[160px] mix-blend-overlay motion-reduce:animate-none"
        style={{ animationPlayState: playState }}
      />
    </span>
  );
};

export const Vignette = ({ className }: { className?: string }): React.JSX.Element => (
  <span
    aria-hidden
    className={cn('pointer-events-none absolute inset-0 bg-(image:--vignette)', className)}
  />
);
