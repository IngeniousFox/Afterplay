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
export const TV_FOCUS_IN_MS = 240;
export const TV_FOCUS_OUT_MS = 120;
// La entrada del foco va con muelle (un overshoot pequeño, ~4 % de la
// escala): la portada «salta» hacia ti y se asienta. La salida, ease-out.
export const TV_FOCUS_EASE = 'var(--ease-spring)';

// ── «ROCK AND ROLL» A 10 PIES ───────────────────────────────────────────────
// Todas las intensidades de los efectos de TV, en un sitio. Si una tele o un
// PC modesto van justos, se baja aquí sin tocar componentes. Lo que lee el
// CSS sale como variable (--tv-*) por tvFocusVars; lo demás lo leen los
// efectos en JS (focusFx.ts, FireflyCanvas, las pantallas).

// El reflejo que cruza la portada enfocada: cada cuántos segundos pasa y
// cuánto espera tras ganar el foco (que el muelle se asiente antes).
export const TV_SHEEN_PERIOD_S = 4.2;
export const TV_SHEEN_DELAY_MS = 650;

// La estela de fósforo al saltar de fila: duración, opacidad de partida y
// cuánto tiene que bajar o subir el foco (en altos del elemento) para contar
// como cambio de fila.
export const TV_TRAIL_MS = 300;
export const TV_TRAIL_OPACITY = 0.6;
export const TV_TRAIL_ROW_JUMP = 0.5;

// La chispa de A: cuántas motas, cuánto vuelan (px a 1080p, escala con la
// fuente) y cuánto duran.
export const TV_SPARK_COUNT = 8;
export const TV_SPARK_REACH_PX = 54;
export const TV_SPARK_MS = 440;

// Las motas del fondo y el foco: radio de influencia (fracción del lado
// corto de la pantalla), cuánto se acercan (fracción de su distancia) y
// cuánto más brillan las cercanas. Suave: se intuye, no se ve tirar.
export const TV_MOTE_REACH = 0.24;
export const TV_MOTE_PULL = 0.12;
export const TV_MOTE_BRIGHTEN = 0.9;

// Grano y viñeta de toda la pantalla.
export const TV_GRAIN_OPACITY = 0.06;
export const TV_VIGNETTE_OPACITY = 0.85;

// El haz de los héroes (segundos por pasada) y el conteo de las cifras.
export const TV_HERO_BEAM_EVERY_S = 9;
export const TV_TICKER_MS = 900;

// El fin de sesión: desde cuándo es «larga» (chispas de sesión) y cuánto se
// espera a soltarlas (que el Ticker haya aterrizado).
export const TV_LONG_SESSION_SEC = 60 * 60;
export const TV_CELEBRATE_DELAY_MS = 700;

export const tvFocusVars = {
  '--tv-focus-scale': String(TV_FOCUS_SCALE),
  '--tv-focus-in': `${TV_FOCUS_IN_MS}ms`,
  '--tv-focus-out': `${TV_FOCUS_OUT_MS}ms`,
  '--tv-focus-ease': TV_FOCUS_EASE,
  '--tv-sheen-period': `${TV_SHEEN_PERIOD_S}s`,
  '--tv-sheen-delay': `${TV_SHEEN_DELAY_MS}ms`,
  '--tv-grain-opacity': String(TV_GRAIN_OPACITY),
  '--tv-vignette-opacity': String(TV_VIGNETTE_OPACITY),
} as React.CSSProperties;

// La transición de cualquier pieza enfocable (reposo = salida, 120 ms).
export const tvFocusMotion =
  'outline-hidden transition-[scale,box-shadow,background-color,border-color,color,opacity] duration-(--tv-focus-out) ease-out';

// El foco "caliente": escala con muelle en 240 ms. Sin escala con reduced
// motion (el anillo y el halo explican el estado solos).
export const tvFocusScale =
  'scale-(--tv-focus-scale) duration-(--tv-focus-in) ease-(--tv-focus-ease) motion-reduce:scale-100';

// Halo sobre portadas, filas y tarjetas: anillo de 2 px, brillo ámbar y una
// sombra que se alarga debajo (la pieza se despega del fondo). Entra con el
// mismo muelle que la escala.
export const tvFocusHalo =
  'shadow-[0_0_0_2px_#ffb347,0_0_32px_rgb(255_179_71/0.45),0_22px_36px_-14px_rgb(3_6_7/0.9)] duration-(--tv-focus-in) ease-(--tv-focus-ease)';

// Halo de los botones: doble anillo con hueco Cabinet y el mismo brillo.
export const tvButtonHalo =
  'shadow-[0_0_0_3px_var(--color-cabinet),0_0_0_6px_var(--color-phosphor),0_0_32px_rgb(255_179_71/0.45),0_18px_30px_-12px_rgb(3_6_7/0.9)] duration-(--tv-focus-in) ease-(--tv-focus-ease)';

// Superficies: panel plano de Fósforo (sin sombra: no flota).
export const tvPanelClass = 'rounded-md border border-line bg-panel';

// El rótulo de un bloque: Barlow semibold, minúscula, Dust. Nada de
// eyebrows en mayúsculas espaciadas.
export const tvLabelClass = 'text-[1.08em] leading-tight font-semibold text-dust';
