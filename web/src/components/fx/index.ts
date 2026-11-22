// components/fx de la PWA: versiones ligeras de las primitivas «rock and
// roll» del escritorio (src/renderer/src/components/fx). Misma idea, otro
// presupuesto: solo transform y opacity, bucles que se paran con la pestaña
// oculta y nada que dependa de que una animación termine. Cada fichero
// documenta su uso en la cabecera. Keyframes: src/shared/theme/fosforo.css y
// web/src/index.css (fx-sweep).
export { EASE, installFxVisibility, loopPlayClass, prefersReducedMotion } from './motion';
export { useInView, useOffscreenPause } from './viewport';
export { CrtFlash, CrtReveal } from './CrtReveal';
export { playCrt, useCrtReveal, type CrtVariant } from './crt';
export { PowerOn } from './PowerOn';
export { Stagger } from './Stagger';
export { useStagger } from './useStagger';
export { Odometer, Ticker } from './Ticker';
export { useCountUp } from './useCountUp';
export { GlowText } from './GlowText';
export { Grain, ScanBeam } from './Backdrop';
export { VuMeter } from './VuMeter';
export { SlidingIndicator } from './SlidingIndicator';
export { Glitch } from './Glitch';
export { PressButton } from './PressButton';
export { flashAt, pressClass } from './press';
export { chartGroup, growX, growY, lightUp } from './chart';
