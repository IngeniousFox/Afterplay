import { cn } from '@/lib/utils';

// TILT COVER: la portada se inclina en 3D (máx. 8°) siguiendo al ratón, con un
// reflejo especular que se mueve y una sombra que se alarga. Al salir vuelve
// suave (450 ms ease-out, interrumpible: es una transición, no un keyframe).
//
//   // UNA vez, en un contenedor que envuelva todas las portadas (RootLayout
//   // ya lo hace con <main>; en TV, su propio raíz):
//   const tiltRegion = useTiltRegion();   <main ref={tiltRegion}>
//
//   // Cada portada:
//   <TiltCover className="rounded-sm">
//     <span className="relative block overflow-hidden rounded-sm …">
//       <img … />
//       <TiltGlare />                       dentro de la caja que recorta
//       <StatusLed className="group-data-tilting/tilt:brightness-150 …" />
//     </span>
//   </TiltCover>
//
// RENDIMIENTO: no hay listeners por portada. Un solo pointermove delegado por
// región busca `[data-tilt]` con closest(), y en el siguiente frame escribe
// tres variables CSS en ESA portada (sus pocos hijos heredan). En reposo la
// portada no lleva transform alguno (ni capa ni contexto de apilamiento): el
// transform 3D solo existe mientras está `data-tilting` y en su vuelta.
//
// Los hijos reaccionan con el grupo `group/tilt`: `group-data-tilting/tilt:*`.
//
// Solo con ratón de verdad (hover: hover, pointer: fine). Reduced motion: no
// hay tilt ni reflejo; queda el hover de siempre del consumidor.

export const TiltCover = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element => (
  <span
    data-tilt=""
    className={cn(
      'group/tilt relative block',
      'transition-[transform,scale,box-shadow] duration-450 ease-out',
      'data-tilting:duration-150',
      'data-tilting:[transform:perspective(700px)_rotateX(var(--tilt-rx,0deg))_rotateY(var(--tilt-ry,0deg))_translateY(-3px)]',
      'data-tilting:shadow-[0_22px_32px_-12px_rgb(3_6_7/0.9)]',
      className,
    )}
  >
    {children}
  </span>
);

// El reflejo: un brillo radial que sigue al ratón. Va dentro de la caja con
// overflow-hidden de la portada para respetar sus esquinas.
export const TiltGlare = ({ className }: { className?: string }): React.JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 ease-out',
      'bg-[radial-gradient(circle_at_var(--glare-x,50%)_var(--glare-y,0%),rgb(255_226_180/0.32),rgb(255_179_71/0.08)_35%,transparent_62%)]',
      'group-data-tilting/tilt:opacity-100',
      className,
    )}
  />
);
