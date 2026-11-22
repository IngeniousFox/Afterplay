import { cn } from '../../lib/cn';
import { EASE, prefersReducedMotion } from './motion';

// LA FÍSICA DE PULSAR: el botón se hunde (scale .94 en 80 ms) y al soltar
// rebota con un ligero overshoot (--ease-spring, 320 ms). Asimétrico a
// propósito: pulsar es instantáneo, la vuelta tiene cuerpo.
//
//   <button className={cn(primaryButtonClass, pressClass)} …>
//
// Va DESPUÉS de las clases del botón: la transición se escribe entera y con
// `!` porque los botones de lib/styles.ts ya declaran la suya (y Tailwind v4
// anima la propiedad `scale`, no `transform`).
// Reduced motion: no se hunde.
export const pressClass = cn(
  '[transition:background-color_150ms_ease-out,border-color_150ms_ease-out,color_150ms_ease-out,opacity_150ms_ease-out,scale_320ms_var(--ease-spring)]!',
  'active:[transition:background-color_150ms_ease-out,border-color_150ms_ease-out,color_150ms_ease-out,opacity_150ms_ease-out,scale_80ms_ease-out]!',
  'active:scale-[.94] motion-reduce:active:scale-100',
);

// UN DESTELLO DE LUZ en un punto de la pantalla, sin componente que montar:
// una capa fija con un degradado radial que se apaga (opacidad) y se retira
// sola. Para confirmar algo que acaba de pasar aunque el botón que lo hizo ya
// no exista (Stop: la barra desaparece al parar). Mide el rect en el clic y
// pásalo después.
//
//   flashAt(button.getBoundingClientRect(), 'phosphor')
//
// Con reduced motion también se ve: es un fundido, no movimiento.
export const flashAt = (
  origin: Element | DOMRectReadOnly,
  tone: 'phosphor' | 'live' = 'phosphor',
): void => {
  if (typeof document === 'undefined' || typeof document.body.animate !== 'function') return;
  const rect = origin instanceof Element ? origin.getBoundingClientRect() : origin;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const color = tone === 'live' ? '255 94 87' : '255 179 71';
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '60',
    // Una elipse ancha y baja: luz que se derrama a lo largo de la barra.
    background: `radial-gradient(110vmax 16vmax at ${x}px ${y}px, rgb(255 236 200 / 0.8), rgb(${color} / 0.42) 30%, rgb(${color} / 0.12) 55%, transparent 75%)`,
  });
  document.body.appendChild(layer);
  const animation = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: prefersReducedMotion() ? 320 : 700,
    easing: EASE.out,
    fill: 'forwards',
  });
  const remove = (): void => layer.remove();
  void animation.finished.then(remove, remove);
};
