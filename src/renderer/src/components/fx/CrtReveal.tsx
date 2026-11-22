import { useCrtReveal, type CrtVariant } from './crt';

// CRT REVEAL: lo que aparece «se enciende» como un tubo. Una línea que se
// abre en vertical con un destello de brillo que se asienta.
//
//   <CrtReveal>…panel…</CrtReveal>                 al montar
//   <CrtReveal replayKey={pathname} variant="screen" className="h-full">
//   const ref = useCrtReveal<HTMLElement>('power-on')   sobre un nodo propio
//   className="animate-crt-in" | "animate-power-on"     solo CSS, al montar
//
// Variantes:
//   · panel    (300 ms) paneles, popovers, la paleta: scaleY .02 → 1.
//   · power-on (760 ms) el arranque: punto → línea → pantalla → parpadeo.
//                       Para la app, el logo, Now playing y la entrada en TV.
//   · screen   (240 ms) cambio de pantalla: solo brillo y opacidad, SIN
//                       geometría, para que nada mida cajas a medio escalar.
//
// Va con WAAPI y fill 'backwards': al acabar no queda ningún transform ni
// filter puesto (un filter residual en un contenedor cambiaría el bloque de
// referencia de sus hijos `fixed`). El hijo está visible en reposo; si la
// animación no corre, se ve igual. `replayKey` la repite al cambiar; la que
// estaba a medias se cancela (es un one-shot corto, no un gesto).
//
// Reduced motion: un fundido, sin escala.

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
