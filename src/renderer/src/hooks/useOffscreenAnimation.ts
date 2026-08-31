import { useCallback, useState } from 'react';
import { createViewportPool } from '../lib/intersectionPool';

// Pausa las animaciones CSS infinitas de un elemento cuando sale de la vista
// (IntersectionObserver -> animation-play-state: paused) y las reanuda,
// idénticas, al volver. No toca keyframes, duraciones ni easings: solo CUÁNDO
// corren. Una animación pausada conserva su Animation y su currentTime — al
// reaparecer sigue el mismo pulso de siempre, no uno recortado.
//
// El problema que resuelve, medido en un bench con el estado típico de la
// biblioteca (333 cards montadas, 3 en LIVE justo bajo el fold): las 9
// animaciones de las cards live siguen `running` aunque no se vea ninguna
// (getAnimations() las lista todas corriendo — Chromium no las frena solo),
// y 6 de esos 9 nodos animan box-shadow (glow-card, pulse-badge) — categoría
// PAINT: cada frame pasa por style+paint en el main thread, a diferencia de
// pulse-dot (opacity), que corre en el compositor. Con el main thread
// saturado de trabajo sintético, esas 3 cards invisibles le robaban un 3-10%
// (5 rondas de pares paused/running adyacentes, mediana 8%; ruido alto por
// carga ajena, pero dirección positiva en las 5) — y sin nada más animando,
// son ellas las que impiden que el renderer quede EN REPOSO: 60 ciclos de
// estilo+pintado por segundo para pixels que no existen. Con la pausa: 0
// animaciones corriendo fuera de la vista, las mismas 9 idénticas dentro.
//
// El margen: el glow-card alcanza hasta 40px más allá de la caja de la card
// (blur del box-shadow en su keyframe del 50%). Pausar justo al cruzar el
// borde congelaría un halo aún visible — con 64px de margen la animación
// solo se pausa cuando ni su sombra puede asomar.
const RUN_MARGIN_PX = 64;

// UN observador por scroller, compartido: uno por card serían cientos
// midiendo el mismo rectángulo. La fontanería sale de lib/intersectionPool —
// la MISMA que usa useNearViewport, no una copia como hasta ahora. El pool en
// sí es propio porque el margen es distinto (un observador no mide con dos
// márgenes a la vez); aquí queda solo la política: 64px, y qué se hace al
// montar y al soltar.
const pool = createViewportPool(RUN_MARGIN_PX);

// Arranca en 'running' a propósito: el invariante es que NUNCA se vea una
// animación congelada — un elemento recién montado pinta su primer frame ya
// animando, y es el observador quien lo pausa un frame después si resulta
// estar lejos (ese frame de más es invisible; el contrario no lo sería).
//
// `observe` y no `ref`: mismo motivo que useNearViewport — el compilador de
// React trata como ref cualquier propiedad que lo parezca y prohibiría leer
// `playState` en el render, que es justo para lo que existe.
export const useOffscreenAnimation = (): {
  observe: (node: HTMLElement | null) => (() => void) | undefined;
  playState: 'running' | 'paused';
} => {
  const [visible, setVisible] = useState(true);

  const observe = useCallback((node: HTMLElement | null) => {
    // React 19 no llama con null cuando la callback devuelve limpieza, pero
    // el tipo de RefCallback sigue admitiéndolo.
    if (!node) return undefined;
    const unobserve = pool.observe(node, setVisible);
    return () => {
      unobserve();
      // De vuelta al estado seguro: si el mismo hook observa otro nodo
      // después (el badge LIVE se desmonta y remonta al reabrir sesión con
      // la card A LA VISTA), que nazca corriendo — el observador lo pausará
      // si de verdad está lejos. Al revés, nacería congelado en pantalla.
      setVisible(true);
    };
  }, []);

  return { observe, playState: visible ? 'running' : 'paused' };
};
