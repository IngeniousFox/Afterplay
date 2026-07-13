import { useEffect, useState } from 'react';
import type { ImageCacheType } from '../../../shared/types';

// Resuelve una URL remota (IGDB/SteamGridDB) a algo listo para <img src>:
// local cacheado si se pudo, la URL remota si no (ver main/images/api.ts).
// null mientras no hay `url` que resolver, o todavía no ha llegado la
// respuesta — el consumidor decide qué pintar en ese hueco.
export const useImageSrc = (url: string | null, type: ImageCacheType): string | null => {
  // Guardo también la `url` que generó ese `src`, para poder detectar si es
  // una respuesta de una `url` anterior (guard de carrera al cambiar de
  // juego rápido) y no enseñar la carátula equivocada mientras llega la nueva.
  const [resolved, setResolved] = useState<{ url: string; src: string } | null>(null);

  useEffect(() => {
    // Sin url no hay nada que pedir — nada que setear en el efecto tampoco,
    // el `if (!url) return null` de abajo ya cubre este caso en el render.
    if (!url) return;

    let cancelled = false;
    window.api.images.getSrc(url, type).then((src) => {
      if (!cancelled) setResolved({ url, src });
    });

    return () => {
      cancelled = true;
    };
  }, [url, type]);

  if (!url) return null;
  return resolved?.url === url ? resolved.src : null;
};
