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
// EL ENDPOINT CAMBIÓ (visto el 13-nov-2026). Hasta entonces se pedía a la
// tienda, `store.steampowered.com/appreviews/<appid>?json=1`. Valve lo retiró:
// ahora contesta un 302 a la portada de la tienda para cualquier appid, axios
// seguía la redirección, recibía HTML donde esperaba JSON y esta función
// devolvía null para TODOS los juegos — sin un solo error visible, porque
// "Steam no supo decir nada" es una respuesta prevista. Lo cazó el test de
// integración en vivo (e2e/integraciones.spec.ts), que es para lo que está.
//
// El sustituto documentado es la API web, `IUserReviewsService/GetAppReviews`
// (partner.steamgames.com/doc/webapi/IUserReviewsService). Sigue sin pedir
// clave. Lo que cambia respecto al de la tienda, y por qué cada parámetro:
//
//  · Los parámetros van en `input_json`, y los que eran texto son números.
//  · `languages: ['all']` (antes `language=all`) y `purchase_type: 1` (= All,
//    antes `purchase_type=all`) son los que hacen que el total cuadre con el
//    de la ficha de la tienda. OJO: el valor por defecto de `purchase_type`
//    es 0 = solo compras en Steam, que deja fuera las claves de terceros y da
//    un número más bajo sin avisar; y sin `languages` solo cuenta el inglés
//    (Portal 2: 174.827 reseñas en inglés frente a 469.674 en total).
//  · `num_per_page: 1` y no 0. En el endpoint viejo, 0 pedía el RESUMEN sin
//    traer textos; en este, 0 significa "el valor por defecto" (20 reseñas
//    enteras, ~25 KB). Con 1 la respuesta ronda 1 KB. No hay forma de pedir
//    solo el resumen.
//  · La respuesta va envuelta en `response` y ya no trae `success`: un appid
//    que no existe (o sin página de reseñas) devuelve `{"response":{}}`.
//  · Sin clave, las llamadas comparten un límite bajo y sin cifra documentada;
//    pasarse devuelve 429. Se pide una vez por juego y se guarda.
const REVIEWS_URL = 'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/';

// Valores de los enumerados de la API (antes eran texto en la URL).
const PURCHASE_TYPE_ALL = 1;

const reviewsSchema = z.object({
  response: z.object({
    // Solo viene en la primera página y con review_type = All, que es justo
    // lo que se pide. Ausente = el appid no existe o no tiene reseñas.
    query_summary: z
      .object({
        total_positive: z.number().optional(),
        total_negative: z.number().optional(),
      })
      .optional(),
  }),
});

export type SteamReviewCounts = { steamPositive: number; steamNegative: number };

// El resumen es por juego y no hay endpoint de lotes, así que el barrido de
// biblioteca las pide en SERIE con esta pausa. Medio segundo (~2 por segundo)
// era ir de sobra por debajo de lo que aguantaba el endpoint de la tienda. El
// de la API web no documenta su límite sin clave: si un barrido empieza a
// recibir 429 (queda en el log, ver abajo), este es el número que subir.
export const STEAM_REVIEWS_DELAY_MS = 500;

// La interpretación de la respuesta, separada de la llamada para poder
// probarla sin red: fue justo un cambio de FORMA de lo que contesta Steam lo
// que dejó esto devolviendo null en silencio.
//
// null = la respuesta no trae un resumen utilizable.
export const parseSteamReviewCounts = (payload: unknown): SteamReviewCounts | null => {
  const parsed = reviewsSchema.safeParse(payload);
  if (!parsed.success) return null;

  const summary = parsed.data.response.query_summary;
  if (!summary) return null;

  const steamPositive = summary.total_positive;
  const steamNegative = summary.total_negative;
  if (steamPositive === undefined || steamNegative === undefined) return null;
  // Un juego recién publicado con CERO reseñas de verdad existe, y es
  // distinto de "no me he enterado": eso son dos ceros legítimos y se
  // guardan tal cual. El umbral de muestra ya se aplica al pintarlos
  // (MIN_STEAM_REVIEWS, en lib/ratings.ts), que es donde toca.
  return { steamPositive, steamNegative };
};

// null = Steam no supo decir nada de este appid (o no contestó). Como el
// resto de fuentes externas de la casa, quien llama conserva lo que hubiera:
// que hoy no conteste no invalida el dato de ayer.
export const getSteamReviewCounts = async (appId: number): Promise<SteamReviewCounts | null> => {
  if (!Number.isInteger(appId) || appId <= 0) return null;

  try {
    const response = await axios.get<unknown>(REVIEWS_URL, {
      params: {
        input_json: JSON.stringify({
          appid: appId,
          languages: ['all'],
          purchase_type: PURCHASE_TYPE_ALL,
          num_per_page: 1,
        }),
      },
      timeout: 10_000,
      // Sin seguir redirecciones: así fue como el endpoint anterior murió sin
      // hacer ruido (un 302 a una página HTML que axios seguía tan contento).
      // Si este se retira igual, que sea un error con su código en el log.
      maxRedirects: 0,
    });

    const counts = parseSteamReviewCounts(response.data);
    if (counts === null && !isEmptyAnswer(response.data)) {
      // Contestó, pero con una forma que no se entiende: no es "este juego no
      // tiene reseñas", es que Steam ha vuelto a cambiar algo. Se dice.
      console.warn(`[steam] respuesta de resenas con forma inesperada para el appid ${appId}`);
    }
    return counts;
  } catch (error) {
    // Solo ASCII, misma convención que el resto de logs del main: la consola
    // de Windows no siempre usa UTF-8.
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 429) {
      console.warn(`[steam] limite de peticiones de resenas alcanzado (appid ${appId})`);
    } else {
      console.warn(`[steam] sin resenas para el appid ${appId} (sigo sin ellas):`, error);
    }
    return null;
  }
};

// `{"response":{}}`: lo que contesta Steam para un appid que no existe o que
// no tiene página de reseñas. Es un "no hay nada" legítimo, no un fallo.
const isEmptyAnswer = (payload: unknown): boolean => {
  if (typeof payload !== 'object' || payload === null) return false;
  const inner = (payload as { response?: unknown }).response;
  return typeof inner === 'object' && inner !== null && Object.keys(inner).length === 0;
};
