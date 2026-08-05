import { useEffect, useState } from 'react';
import type { ImageCacheType } from '../../../shared/types';

// Resuelve una URL remota (IGDB/SteamGridDB) a algo listo para <img src>:
// local cacheado si se pudo, la URL remota si no (ver main/images/api.ts).
// null mientras no hay `url` que resolver, o todavía no ha llegado la
// respuesta — el consumidor decide qué pintar en ese hueco.
//
// CACHÉ a nivel de módulo: la resolución url→src es estable durante la vida
// del proceso, y sin ella cada remontada de una parrilla (volver de una
// ficha en el modo TV: cientos de carátulas) relanzaba cientos de IPC y la
// pantalla se veía "cargando" mientras goteaban. Con la caché, el remontaje
// pinta en el PRIMER frame (useState arranca ya resuelto) y ni siquiera
// vuelve a preguntar. SOLO guarda resoluciones LOCALES (afterplay-image:) —
// el fallback remoto de un fallo de cacheo no entra nunca (ver el porqué en
// el efecto de abajo), así que un hit de caché es siempre una imagen que de
// verdad se puede pintar.
const srcCache = new Map<string, string>();

export const useImageSrc = (url: string | null, type: ImageCacheType): string | null => {
  // La key incluye el tipo: la misma URL puede cachearse como cover y como
  // hero con srcs distintos.
  const key = url ? `${type}:${url}` : null;
  // Guardo también la `key` que generó ese `src`, para poder detectar si es
  // una respuesta de una `key` anterior (guard de carrera al cambiar de
  // juego rápido) y no enseñar la carátula equivocada mientras llega la nueva.
  const [resolved, setResolved] = useState<{ key: string; src: string } | null>(() => {
    if (!key) return null;
    const cached = srcCache.get(key);
    return cached !== undefined ? { key, src: cached } : null;
  });

  // Ajustar-estado-durante-render (patrón de la casa): el MISMO componente
  // puede cambiar de juego sin remontarse — HeroBanner y su CoverThumb viven
  // fuera del key={game.id} de la ficha — y el initializer de arriba solo
  // corre en el montaje. Sin esto, con la key nueva YA en caché el efecto no
  // hacía nada (su guard de abajo corta) y el estado se quedaba apuntando a
  // la key del juego ANTERIOR: la PRIMERA visita a una ficha pintaba, y la
  // SEGUNDA — con la carátula en caché precisamente gracias a la primera —
  // se quedaba en blanco para siempre (bug real, sin un solo error en
  // consola porque aquí no falla nada: simplemente nadie sembraba el estado).
  if (key !== null && resolved?.key !== key) {
    const cached = srcCache.get(key);
    if (cached !== undefined) setResolved({ key, src: cached });
  }

  useEffect(() => {
    // Sin url no hay nada que pedir — nada que setear en el efecto tampoco,
    // el `if (!key) return null` de abajo ya cubre este caso en el render.
    if (!url || !key) return;
    // Ya resuelta: no hace falta ni preguntar. Antes esto SIEMPRE llamaba al
    // IPC, caché de módulo o no — el `srcCache` solo evitaba el parpadeo del
    // primer frame, pero cada remontaje (volver de una ficha, un filtro que
    // vuelve a montar la parrilla) disparaba una llamada de todas formas.
    // Con cientos de carátulas en pantalla, eso son cientos de idas y
    // vueltas IPC + un stat en el main por cada una, para preguntar algo que
    // ya se sabía. La revalidación de verdad (¿cambió el fichero local desde
    // la última vez?) no es lo que esto hacía — era una simple relectura del
    // mismo resultado.
    if (srcCache.has(key)) return;

    let cancelled = false;
    window.api.images.getSrc(url, type).then((src) => {
      // SOLO se acepta la resolución LOCAL (afterplay-image:). El fallback
      // remoto que getImageSrc devuelve cuando el cacheo falla NUNCA puede
      // pintarse aquí — el CSP de index.html (img-src 'self' data:
      // afterplay-image:) bloquea todo http(s) en <img> — y cachearlo
      // congelaba ese fallo para TODA la sesión (bug real): un 429 del CDN
      // en la ráfaga inicial dejaba a ese juego sin carátula ni hero aunque
      // el fichero aterrizara en disco un segundo después, porque este hook
      // ya no volvía a preguntar. Descartándolo, el placeholder se queda a
      // la vista y el PRÓXIMO montaje vuelve a preguntar — converge al
      // fichero local en cuanto existe, que es como se comportaba antes de
      // la caché de módulo.
      if (!src.startsWith('afterplay-image:')) return;
      srcCache.set(key, src);
      if (cancelled) return;
      // Sin re-render si la respuesta coincide con lo ya pintado (el caso
      // normal con la caché caliente).
      setResolved((prev) => (prev?.key === key && prev.src === src ? prev : { key, src }));
    });

    return () => {
      cancelled = true;
    };
  }, [url, key, type]);

  if (!key) return null;
  return resolved?.key === key ? resolved.src : null;
};
