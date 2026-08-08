import axios from 'axios';
import { z } from 'zod';

// El % de reseñas de Steam, pedido a la PROPIA Steam.
//
// Antes esto salía de SteamSpy, junto con las etiquetas, y estaba mal por dos
// motivos distintos — los dos medidos en vivo el 8-ago-2026 y no deducidos:
//
//  1. SteamSpy NO tiene los juegos recientes. El caso que lo destapó:
//     REPLACED (appid 1663850). SteamSpy conoce el juego —devuelve su nombre,
//     su estudio y su precio— pero con `positive: 0`, `negative: 0` y `tags:
//     []`. La propia Steam, a la vez, decía 9.046 reseñas (7.630 positivas,
//     "Very Positive"). No es que el juego no tuviera reseñas: es que el
//     rastreo de SteamSpy no había llegado a él.
//  2. Y en los que SÍ tiene, van MUY atrasadas. Hollow Knight: 403.641
//     positivas según SteamSpy, 538.596 según Steam. Un tercio de menos.
//
// Sus cifras salían de un rastreo periódico propio; las de aquí son las de la
// ficha de la tienda, exactas y al día. Las ETIQUETAS también acabaron
// saliendo de Steam (steam/tags.ts) y SteamSpy ya no está en la app.
//
// Endpoint público de la tienda, sin clave y sin límite documentado; se pide
// una vez por juego y se guarda. `num_per_page=0` pide el RESUMEN sin traerse
// ni un solo texto de reseña: es la diferencia entre unos bytes y megas.
// `language=all` y `purchase_type=all` son los que hacen que el total cuadre
// con el que enseña la ficha de la tienda — sin ellos se dejan fuera idiomas
// y las claves regaladas/de terceros, y el número sale más bajo sin avisar.

const reviewsSchema = z.object({
  // 1 = la consulta fue bien. Cualquier otra cosa (appid inexistente, juego
  // retirado) viene sin resumen utilizable.
  success: z.number(),
  query_summary: z
    .object({
      total_positive: z.number().optional(),
      total_negative: z.number().optional(),
    })
    .optional(),
});

export type SteamReviewCounts = { steamPositive: number; steamNegative: number };

// El resumen es por juego y no hay endpoint de lotes, así que el barrido de
// biblioteca las pide en SERIE con esta pausa. Medio segundo (~2 por segundo)
// es ir de sobra por debajo de lo que aguanta un endpoint público de la
// tienda, y aun así menos de la mitad de lo que costaba SteamSpy, que exigía
// 1,1s por juego para traer lo mismo peor.
export const STEAM_REVIEWS_DELAY_MS = 500;

// null = Steam no supo decir nada de este appid (o no contestó). Como el
// resto de fuentes externas de la casa, quien llama conserva lo que hubiera:
// que hoy no conteste no invalida el dato de ayer.
export const getSteamReviewCounts = async (appId: number): Promise<SteamReviewCounts | null> => {
  if (!Number.isInteger(appId) || appId <= 0) return null;

  try {
    const response = await axios.get<unknown>(
      `https://store.steampowered.com/appreviews/${appId}`,
      {
        params: { json: 1, language: 'all', purchase_type: 'all', num_per_page: 0 },
        timeout: 10_000,
      },
    );
    const data = reviewsSchema.parse(response.data);
    if (data.success !== 1 || !data.query_summary) return null;

    const steamPositive = data.query_summary.total_positive;
    const steamNegative = data.query_summary.total_negative;
    if (steamPositive === undefined || steamNegative === undefined) return null;
    // Un juego recién publicado con CERO reseñas de verdad existe, y es
    // distinto de "no me he enterado": eso son dos ceros legítimos y se
    // guardan tal cual. El umbral de muestra ya se aplica al pintarlos
    // (MIN_STEAM_REVIEWS, en lib/ratings.ts), que es donde toca.
    return { steamPositive, steamNegative };
  } catch (error) {
    // Solo ASCII, misma convención que el resto de logs del main: la consola
    // de Windows no siempre usa UTF-8.
    console.warn(`[steam] sin resenas para el appid ${appId} (sigo sin ellas):`, error);
    return null;
  }
};
