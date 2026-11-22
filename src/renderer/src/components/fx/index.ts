// components/fx: las primitivas de movimiento de la pasada «rock and roll» de
// Fósforo (escritorio y TV). Cada fichero documenta su uso en la cabecera.
// Keyframes y curvas: src/shared/theme/fosforo.css (animate-*, ease-spring).
export { EASE, canHover, prefersReducedMotion, useReducedMotion } from './motion';
export { CrtReveal } from './CrtReveal';
export { playCrt, useCrtReveal, type CrtVariant } from './crt';
export { Stagger } from './Stagger';
export { useStagger, type StaggerOptions, type StaggerVariant } from './useStagger';
export { Odometer, Ticker } from './Ticker';
export { GlowText } from './GlowText';
export { Grain, ScanBeam, ScanLines, Vignette } from './Backdrop';
export { TiltCover, TiltGlare } from './TiltCover';
export { useTiltRegion } from './tilt';
export { PressButton } from './PressButton';
export { pressClass } from './press';
export { SlidingIndicator } from './SlidingIndicator';
export { celebrate, type CelebrationKind, type SparkOrigin } from './sparks';
export { VuMeter } from './VuMeter';
export { Glitch } from './Glitch';
export { chartGroup, chartPaused, drawLine, growX, growY, spinIn, useInView } from './chart';
