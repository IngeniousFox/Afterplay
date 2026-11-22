import { cn } from '@/lib/utils';

// La física de PressButton (ver PressButton.tsx): hundirse y rebotar.
//
// La transición se escribe entera (y con !): los botones de controls.ts
// transicionan `transform`, pero la escala de Tailwind v4 es la propiedad
// `scale`, y aquí cada propiedad lleva su tiempo: colores a 150 ms, escala con
// rebote. El important evita depender del orden del CSS generado.
export const pressClass = cn(
  '[transition:background-color_150ms_ease-out,border-color_150ms_ease-out,color_150ms_ease-out,box-shadow_150ms_ease-out,scale_320ms_var(--ease-spring)]!',
  'active:[transition:background-color_150ms_ease-out,border-color_150ms_ease-out,color_150ms_ease-out,box-shadow_80ms_ease-out,scale_80ms_ease-out]!',
  'active:scale-[.95] active:shadow-[inset_0_2px_6px_rgb(0_0_0/0.35)]',
  'motion-reduce:active:scale-100',
);
