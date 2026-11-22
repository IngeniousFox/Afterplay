// La cascada de entrada del modo TV, ya en el idioma de Fósforo: el mismo
// screen-in del sistema (240 ms, 8 px, ease-out; con reduced motion queda en
// fundido porque la distancia es una variable) y un desfase de 40 ms por
// bloque con tope en el sexto.

export const tvRevealClass = 'animate-screen-in';

export const tvRevealStyle = (index: number): React.CSSProperties => ({
  animationDelay: `${Math.min(index, 6) * 40}ms`,
});

// LAS PIEZAS COMUNES DEL MODO TV EN FÓSFORO (README-tvpwa.md, "Modo TV").
//
// La escala 10-foot cuelga del font-size del layout (≈24 px a 1080p), así que
// todo va en em: 1em es el cuerpo, 0.92em el dato secundario (22 px) y nada
// baja de 0.85em (20 px, el suelo de TV del sistema).
//
// EL FOCO: borde/anillo Phosphor + halo ámbar (`shadow-glow-halo`) y escala
// 1.06 en 200 ms; la salida, en 120 ms. Con reduced motion no hay escala: se
// quedan anillo y halo. No se ha probado en una tele de verdad, por eso
// escala y duraciones viven AQUÍ, en tres constantes, y el layout las
// publica como variables CSS (--tv-focus-*) que leen las clases de abajo.
// Si el hardware va justo, el sistema propone bajar a 140 ms y quitar la
// escala: basta con tocar estos números.

export const TV_FOCUS_SCALE = 1.06;
export const TV_FOCUS_IN_MS = 200;
export const TV_FOCUS_OUT_MS = 120;

export const tvFocusVars = {
  '--tv-focus-scale': String(TV_FOCUS_SCALE),
  '--tv-focus-in': `${TV_FOCUS_IN_MS}ms`,
  '--tv-focus-out': `${TV_FOCUS_OUT_MS}ms`,
} as React.CSSProperties;

// La transición de cualquier pieza enfocable (reposo = salida, 120 ms).
export const tvFocusMotion =
  'outline-hidden transition-[scale,box-shadow,background-color,border-color,color,opacity] duration-(--tv-focus-out) ease-out';

// El foco "caliente": escala y entrada en 200 ms. Sin escala con reduced
// motion (el anillo y el halo explican el estado solos).
export const tvFocusScale =
  'scale-(--tv-focus-scale) duration-(--tv-focus-in) motion-reduce:scale-100';

// Halo sobre portadas, filas y tarjetas: anillo de 2 px + brillo ámbar.
export const tvFocusHalo = 'shadow-glow-halo duration-(--tv-focus-in)';

// Halo de los botones: doble anillo con hueco Cabinet y el mismo brillo.
export const tvButtonHalo =
  'shadow-[0_0_0_3px_var(--color-cabinet),0_0_0_6px_var(--color-phosphor),0_0_32px_rgb(255_179_71/0.45)] duration-(--tv-focus-in)';

// Superficies: panel plano de Fósforo (sin sombra: no flota).
export const tvPanelClass = 'rounded-md border border-line bg-panel';

// El rótulo de un bloque: Barlow semibold, minúscula, Dust. Nada de
// eyebrows en mayúsculas espaciadas.
export const tvLabelClass = 'text-[1.08em] leading-tight font-semibold text-dust';
