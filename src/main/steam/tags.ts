import axios from 'axios';
import { z } from 'zod';
import type { SteamTag } from '../igdb/types';

// Las ETIQUETAS de Steam, pedidas a la propia Steam.
//
// Antes venían de SteamSpy, y SteamSpy ya no está en la app por lo que se
// midió el 8-ago-2026 con REPLACED (appid 1663850): decía `tags: []` y cero
// reseñas de un juego que en Steam tenía 20 etiquetas y 9.046 reseñas. Su
// rastreo propio no llega a los juegos recientes, y en los que sí tiene va
// muy atrasado (Hollow Knight: 403.641 reseñas según SteamSpy, 538.596 según
// Steam). Se probó si la API de la tienda servía de sustituto y las tres
// cosas quedaron comprobadas en vivo, no supuestas:
//
//  · `store.steampowered.com/api/appdetails` NO sirve: da `genres` (Action,
//    Adventure, Indie — lo mismo que ya da IGDB) y `categories` (Single-
//    player, Steam Achievements: características, no etiquetas). De tags,
//    nada.
//  · `IStoreBrowseService/GetItems` SÍ: devuelve las etiquetas ordenadas,
//    pero por NÚMERO de etiqueta, sin nombre.
//  · `IStoreService/GetTagList` cierra el círculo: el diccionario entero
//    (446 etiquetas) que traduce esos números a "Pixel Graphics",
//    "Cyberpunk", "Story Rich"…
//
// Las dos sin clave, las dos JSON, y GetItems ADEMÁS ACEPTA LOTES —probado
// con 60 appids de una tacada, 60 de 60—, así que las etiquetas de la
// biblioteca entera son un puñado de peticiones en vez de una por juego cada
// 1,1 segundos. El barrido pasó de minutos de etiquetas a segundos.
//
// Sigue siendo dato DECORATIVO, igual que cuando venía de SteamSpy: si esto
// se rompe, lo guardado se queda y deja de refrescarse. Nada de la app
// depende de que conteste.

// Steam lista una veintena; a partir de la décima son ruido de cola larga.
// Mismo tope que tenía SteamSpy, para que las fichas no cambien de aspecto.
const MAX_TAGS = 8;

// Probado con 60 de una vez sin despeinarse. Se queda en 50 porque todo esto
// viaja en la QUERY STRING (input_json) y lo que hay que cuidar aquí no es el
// número de juegos sino el largo de la URL.
const BATCH_SIZE = 50;

const tagListSchema = z.object({
  response: z.object({
    tags: z.array(z.object({ tagid: z.number(), name: z.string() })),
  }),
});

const storeItemsSchema = z.object({
  response: z.object({
    store_items: z
      .array(
        z.object({
          appid: z.number().optional(),
          // weight es el PESO relativo de la etiqueta, no un recuento de
          // personas: sirve para ordenar y para nada más (ver SteamTag).
          tags: z.array(z.object({ tagid: z.number(), weight: z.number() })).optional(),
        }),
      )
      .optional(),
  }),
});

// El diccionario de etiquetas es un catálogo estático de Steam (446 entradas)
// que no cambia de una semana para otra: se pide UNA vez por arranque y se
// queda. Se cachea la PROMESA y no el resultado, para que un barrido que
// dispara varios lotes a la vez no lance cuatro peticiones idénticas.
let tagNamesPromise: Promise<Map<number, string>> | null = null;

const fetchTagNames = async (): Promise<Map<number, string>> => {
  const response = await axios.get<unknown>(
    'https://api.steampowered.com/IStoreService/GetTagList/v1/',
    { params: { language: 'english' }, timeout: 10_000 },
  );
  const { response: data } = tagListSchema.parse(response.data);
  return new Map(data.tags.map((tag) => [tag.tagid, tag.name]));
};

const getTagNames = async (): Promise<Map<number, string>> => {
  // Si falla, se OLVIDA la promesa fallida: cachear un rechazo dejaría la app
  // sin etiquetas hasta el próximo reinicio por un corte de red de un segundo.
  tagNamesPromise ??= fetchTagNames().catch((error) => {
    tagNamesPromise = null;
    throw error;
  });
  return tagNamesPromise;
};

// Las etiquetas de un LOTE de juegos: appid -> etiquetas, solo para los que
// tienen alguna. Los ausentes del mapa simplemente no las tienen (o Steam no
// supo de ellos) y quien llama conserva lo que hubiera — misma convención que
// el resto de fuentes externas de la casa.
export const getSteamTags = async (appIds: number[]): Promise<Map<number, SteamTag[]>> => {
  const result = new Map<number, SteamTag[]>();
  const valid = appIds.filter((appId) => Number.isInteger(appId) && appId > 0);
  if (valid.length === 0) return result;

  try {
    const names = await getTagNames();

    for (let start = 0; start < valid.length; start += BATCH_SIZE) {
      const batch = valid.slice(start, start + BATCH_SIZE);
      const response = await axios.get<unknown>(
        'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/',
        {
          params: {
            input_json: JSON.stringify({
              ids: batch.map((appid) => ({ appid })),
              context: { language: 'english', country_code: 'US' },
              // Se piden 20 y luego se recortan a MAX_TAGS: el orden lo decide
              // Steam y hay que verlo entero para quedarse con la cabeza.
              data_request: { include_tag_count: 20 },
            }),
          },
          timeout: 15_000,
        },
      );
      const { response: data } = storeItemsSchema.parse(response.data);

      for (const item of data.store_items ?? []) {
        if (item.appid === undefined || !item.tags || item.tags.length === 0) continue;
        const tags = item.tags
          .map((tag) => ({ name: names.get(tag.tagid), votes: tag.weight }))
          // Una etiqueta cuyo número no está en el diccionario (recién creada,
          // o de otro idioma) se cae en vez de pintarse como "undefined".
          .filter((tag): tag is SteamTag => tag.name !== undefined)
          .slice(0, MAX_TAGS);
        if (tags.length > 0) result.set(item.appid, tags);
      }
    }
  } catch (error) {
    // Solo ASCII, misma convención que el resto de logs del main: la consola
    // de Windows no siempre usa UTF-8. Se devuelve lo que se hubiera reunido
    // hasta el fallo: media biblioteca con etiquetas es mejor que ninguna.
    console.warn('[steam] fallo pidiendo las etiquetas (sigo sin ellas):', error);
  }

  return result;
};

// Las de UN juego — el alta y el botón de la ficha, que van de uno en uno.
export const getSteamTagsForApp = async (appId: number): Promise<SteamTag[] | null> =>
  (await getSteamTags([appId])).get(appId) ?? null;
