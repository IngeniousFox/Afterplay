import { useEffect, useRef } from 'react';
import { useGames } from './games';
import { resolveImageSrc } from './useImageSrc';
import { scheduleStatsPreload } from '../lib/statsRoute';

// EL TERCER RELOJ DEL ARRANQUE (la pareja de revealWhenReady en main/index.ts).
//
// La optimización del arranque creó la ventana antes de esperar a la base, y
// con ella nació una regresión de percepción: 'ready-to-show' dispara con el
// PRIMER frame del renderer, que es el cascarón — sin datos y sin carátulas.
// El splash se cerraba ahí, y los varios segundos de biblioteca poblándose
// pasaban delante del usuario en vez de detrás del splash.
//
// Este hook, montado UNA vez en la raíz, avisa al main cuando hay contenido
// de verdad: la lista de juegos ya resolvió Y las carátulas del primer
// pantallazo están DECODIFICADAS. Decodificar es la mitad que se ve: resolver
// el src es un IPC rápido, pero convertir un webp de 600px en píxeles es lo
// que hacía aparecer las carátulas a goteo. img.decode() mete cada una en la
// caché de imágenes de Chromium, así que cuando las cards monten su <img>
// con el mismo src, el pintado es instantáneo.
//
// Qué se calienta: las primeras por TÍTULO (lo de arriba de Library, que
// ordena alfabético insensible a mayúsculas) MÁS las últimas JUGADAS (lo que
// enseñan Home y las estanterías del modo TV). Son las dos primeras pantallas
// posibles; calentar la biblioteca entera sería pagar 333 decodificaciones
// para enseñar 20.
//
// El tope de tiempo importa más que la lista exacta: si el disco está frío y
// las carátulas tardan, se avisa igual al agotarse — un splash que se alarga
// indefinidamente es peor que dos carátulas llegando tarde. Y el main tiene
// además su propia red (CONTENT_GATE_MAX_MS, 12s) por si este aviso no llega
// nunca (un renderer roto de verdad): el peor caso es un splash largo una
// vez, nunca un splash colgado.
const TITLE_WARM_COUNT = 12;
const RECENT_WARM_COUNT = 8;
const WARM_TIMEOUT_MS = 1500;

const decodeCover = async (url: string): Promise<void> => {
  // Por resolveImageSrc y no por window.api.images.getSrc a pelo: ese es el
  // mismo camino que usan las cards, así que esta resolución queda SEMBRADA en
  // la caché de módulo de useImageSrc. Antes se tiraba, y las primeras cards
  // volvían a pedir por IPC exactamente lo que se acababa de resolver aquí —
  // el doble de idas y vueltas justo en el instante que este hook existe para
  // acortar. null = no pintable (fallo de cacheo, no se espera): esa card
  // saldrá con su placeholder, exactamente igual que hoy.
  const src = await resolveImageSrc(url, 'covers');
  if (src === null) return;
  const image = new Image();
  image.src = src;
  await image.decode();
};

export const useStartupContentSignal = (): void => {
  const { data: games, isError } = useGames();
  const sent = useRef(false);

  useEffect(() => {
    // Si la query REVIENTA, se avisa igual y ya: lo que hay que enseñar es el
    // estado de error, y retener el splash hasta la red de seguridad del main
    // sería castigar al usuario con más espera para la misma mala noticia.
    if (!sent.current && isError) {
      sent.current = true;
      window.api.window.startupContentReady();
      scheduleStatsPreload();
      return;
    }

    // Se dispara con la PRIMERA resolución de la query y nunca más: los
    // 'games:changed' posteriores re-ejecutan el efecto con datos nuevos,
    // pero el arranque solo ocurre una vez.
    if (sent.current || games === undefined) return;
    sent.current = true;

    const warm = async (): Promise<void> => {
      const byRecency = [...games]
        .filter((game) => game.lastPlayedAt !== null)
        .sort((a, b) => (b.lastPlayedAt as Date).getTime() - (a.lastPlayedAt as Date).getTime())
        .slice(0, RECENT_WARM_COUNT);

      const urls = [
        ...new Set(
          [...games.slice(0, TITLE_WARM_COUNT), ...byRecency]
            .map((game) => game.coverUrl)
            .filter((url): url is string => url !== null),
        ),
      ];

      // allSettled: una carátula corrupta o ausente no puede retrasar a las
      // demás ni tumbar el aviso. Y la carrera con el tope, por lo de arriba.
      const cap = new Promise<void>((resolve) => setTimeout(resolve, WARM_TIMEOUT_MS));
      await Promise.race([Promise.allSettled(urls.map(decodeCover)).then(() => undefined), cap]);

      window.api.window.startupContentReady();
      scheduleStatsPreload();
    };

    void warm();
  }, [games, isError]);
};
