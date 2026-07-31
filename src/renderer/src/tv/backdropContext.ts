import { createContext, useContext, useEffect } from 'react';

// El fondo ambiental del modo TV (rediseño Hydra-style): cada pantalla
// declara QUÉ arte debe respirar detrás de todo — el hero del juego actual
// en Home, el del juego abierto en la ficha, el protagonista del mes en el
// Journey — y el layout lo pinta difuminado a pantalla completa con un
// crossfade. Es lo que mata el "fondo negro": el modo entero queda bañado
// por la luz del juego que estés mirando.
//
// Contrato de módulo sin componentes (regla de Fast Refresh): el contexto y
// el hook viven aquí; el provider y las capas de imagen, en el layout.

export const TvBackdropContext = createContext<((src: string | null) => void) | null>(null);

// La pantalla llama con su src YA resuelto (useImageSrc) — null mientras
// carga o si no hay arte. Último en hablar gana; no se limpia al desmontar
// (la siguiente pantalla pone el suyo y limpiar antes solo metería un
// parpadeo a negro entre medias).
export const useTvBackdrop = (src: string | null): void => {
  const setBackdrop = useContext(TvBackdropContext);

  useEffect(() => {
    if (!setBackdrop || src === null) return;
    setBackdrop(src);
  }, [setBackdrop, src]);
};

// EL CIELO A ESCENA: la pantalla que quiera la noche de luciérnagas como
// protagonista (la cubierta del Journey) DESPEJA el arte del fondo — el
// null aquí es intención, no "aún cargando", por eso es otro hook y no un
// caso más de useTvBackdrop. El shell funde el arte saliente y devuelve el
// enjambre a plena luz (ver FireflyCanvas.active).
export const useTvSkyBackdrop = (active: boolean): void => {
  const setBackdrop = useContext(TvBackdropContext);

  useEffect(() => {
    if (!setBackdrop || !active) return;
    setBackdrop(null);
  }, [setBackdrop, active]);
};
