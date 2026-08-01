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
// pinta en el PRIMER frame (useState arranca ya resuelto) y el IPC queda
// como revalidación en segundo plano — si el main pasó de la URL remota al
// fichero local, converge sin parpadeo en cuanto responde.
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

  useEffect(() => {
    // Sin url no hay nada que pedir — nada que setear en el efecto tampoco,
    // el `if (!key) return null` de abajo ya cubre este caso en el render.
    if (!url || !key) return;

    let cancelled = false;
    window.api.images.getSrc(url, type).then((src) => {
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
