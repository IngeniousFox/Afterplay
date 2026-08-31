import { useCallback, useState } from 'react';
import { createViewportPool } from '../lib/intersectionPool';

// ¿Está este elemento lo bastante cerca de la parte visible como para que
// valga la pena tener su imagen viva?
//
// El problema que resuelve, medido con un Plan de 650 juegos: la cola ya monta
// las filas por tandas y las envuelve en content-visibility:auto, así que
// Chromium no maqueta ni pinta lo que no cabe en pantalla y las carátulas
// (loading="lazy") ni siquiera se piden. Todo correcto… hasta que bajas. Cada
// fila por la que pasas carga su carátula, y a partir de ahí NADIE la suelta:
// el <img> sigue en el DOM con su src, así que el bitmap descodificado sigue
// vivo aunque la fila esté a diez pantallas de distancia. Recorrer la lista
// entera una vez deja las 650 en memoria — y una carátula de IGDB es 264x374,
// unos 395 KB descodificada, se pinte al tamaño que se pinte.
//
// Con esto el <img> se DESMONTA al alejarse y vuelve al acercarse: lo vivo
// pasa de "todo lo que has visitado" a "lo que tienes cerca". El hueco no se
// mueve ni un píxel porque la caja de la carátula tiene tamaño fijo, y no hay
// parpadeo porque content-visibility despierta la fila antes (a media
// pantalla) de que este margen la alcance.
const NEAR_MARGIN_PX = 800;

// UN observador por scroller, compartido por todas las filas que cuelgan de
// él (lib/intersectionPool): uno por fila serían cientos de observadores
// midiendo exactamente el mismo rectángulo — justo el coste que este módulo
// viene a quitar. La fontanería está allí porque estaba copiada aquí y en
// useOffscreenAnimation; aquí se queda solo lo que es POLÍTICA de este hook:
// el margen y qué se hace al montar y al soltar.
const pool = createViewportPool(NEAR_MARGIN_PX);

// Arranca en `true` a propósito: una fila recién montada pinta su carátula ya,
// y es el observador quien la apaga si resulta estar lejos. Al revés se vería
// un hueco en el primer pantallazo, porque la primera pasada del observador no
// llega hasta el frame siguiente.
//
// `observe` y no `ref`/`attachRef`: el compilador de React da por buena
// cualquier propiedad que suene a ref y prohíbe leer el objeto entero durante
// el render — que es justo donde hay que pasar la callback Y leer `near`.
export const useNearViewport = (): {
  observe: (node: HTMLElement | null) => (() => void) | undefined;
  near: boolean;
} => {
  const [near, setNear] = useState(true);

  // Sin useRef para llevar la cuenta de lo observado: la callback devuelve su
  // LIMPIEZA (React 19), que es quien deja de observar al desmontar o al
  // cambiar de nodo. Además de ser menos código, es lo que mantiene el objeto
  // que devuelve este hook libre de refs — con una dentro, el compilador de
  // React da por contaminado todo lo que sale de aquí y prohíbe leer `near`
  // en el render, que es justo para lo que existe.
  const observe = useCallback((node: HTMLElement | null) => {
    // React 19 no llama con null cuando la callback devuelve limpieza, pero el
    // tipo de RefCallback sigue admitiéndolo — y aquí no hay nada que hacer.
    if (!node) return undefined;
    return pool.observe(node, setNear);
  }, []);

  return { observe, near };
};
