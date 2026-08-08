import axios from 'axios';
import { z } from 'zod';
import type { ReleaseDatePrecision } from '../igdb/types';

// La ficha de un juego SEGÚN STEAM — para los juegos que existen en Steam y
// que IGDB todavía no tiene.
//
// El caso que lo trajo: "Enter the kOS" (appid 4414410), anunciado y con
// página de tienda, del que IGDB no sabe absolutamente nada — ni por nombre,
// ni por búsqueda, ni por appid. Con `games.igdbId` obligatorio esos juegos no
// se podían ni dar de alta; ahora la columna admite null y esta es la fuente
// que los rellena mientras IGDB no llegue.
//
// TODO lo que da esto es PROVISIONAL por diseño: en cuanto alguno de los tres
// refrescos encuentra la ficha de IGDB, se adopta aquella como fuente y esto
// se sustituye entero (ver external/adoptIgdb.ts). Por eso no se mezcla con
// nada: o el juego es de IGDB, o es de Steam, nunca mitad y mitad.
//
// Una sola llamada a cada uno de los dos endpoints que ya usa la casa:
//  · IStoreBrowseService/GetItems — descripción, estudio, editora, fecha de
//    salida REAL (timestamp, no el texto localizado de appdetails) y los
//    nombres de fichero de las imágenes.
//  · appdetails — los géneros, que GetItems no da.

const assetsSchema = z.object({
  // "steam/apps/4414410/${FILENAME}?t=1785155723"
  asset_url_format: z.string(),
  // La VERTICAL (600x900), que es la forma de carátula que usa la app — la
  // misma proporción que el cover_big de IGDB. `header` es apaisada y no
  // sirve: puesta de carátula se ve deformada o recortada por la mitad.
  library_capsule: z.string().optional(),
  library_hero: z.string().optional(),
  header: z.string().optional(),
});

const getItemsSchema = z.object({
  response: z.object({
    store_items: z
      .array(
        z.object({
          success: z.number().optional(),
          visible: z.boolean().optional(),
          name: z.string().optional(),
          assets: assetsSchema.optional(),
          basic_info: z
            .object({
              short_description: z.string().optional(),
              developers: z.array(z.object({ name: z.string() })).optional(),
              publishers: z.array(z.object({ name: z.string() })).optional(),
            })
            .optional(),
          release: z
            .object({
              // Unix en SEGUNDOS. Ausente en los "por anunciar".
              steam_release_date: z.number().optional(),
              is_coming_soon: z.boolean().optional(),
            })
            .optional(),
        }),
      )
      .optional(),
  }),
});

const appDetailsSchema = z.record(
  z.string(),
  z.object({
    success: z.boolean(),
    data: z
      .object({
        genres: z.array(z.object({ description: z.string() })).optional(),
      })
      .optional(),
  }),
);

const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';

const assetUrl = (assets: z.infer<typeof assetsSchema>, file: string | undefined): string | null =>
  file ? ASSET_BASE + assets.asset_url_format.replace('${FILENAME}', file) : null;

// Steam devuelve la descripción con entidades HTML (&quot;, &amp;…) porque su
// origen es la ficha web. Aquí se pinta como texto plano, así que se
// deshacen — solo las cinco que aparecen de verdad, sin meter un parser
// entero para esto.
const decodeEntities = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

export type SteamStoreDetails = {
  title: string;
  summary: string | null;
  developer: string | null;
  publisher: string | null;
  genres: string[] | null;
  coverUrl: string | null;
  heroUrl: string | null;
  releaseYear: number | null;
  releaseDate: Date | null;
  releaseDatePrecision: ReleaseDatePrecision | null;
};

// null = Steam no sabe de este appid, o contestó algo ilegible. Quien llama
// decide qué hacer; aquí no se inventa nada.
export const getSteamStoreDetails = async (appId: number): Promise<SteamStoreDetails | null> => {
  if (!Number.isInteger(appId) || appId <= 0) return null;

  try {
    const [itemsResponse, detailsResponse] = await Promise.all([
      axios.get<unknown>('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/', {
        params: {
          input_json: JSON.stringify({
            ids: [{ appid: appId }],
            context: { language: 'english', country_code: 'US' },
            data_request: { include_assets: true, include_basic_info: true, include_release: true },
          }),
        },
        timeout: 15_000,
      }),
      // Los géneros solo están aquí. Su fallo NO tumba el alta: un juego sin
      // géneros se da de alta igual, como cualquier otro al que le falte un
      // dato accesorio.
      axios
        .get<unknown>('https://store.steampowered.com/api/appdetails', {
          params: { appids: appId, l: 'english' },
          timeout: 10_000,
        })
        .catch(() => null),
    ]);

    const item = getItemsSchema.parse(itemsResponse.data).response.store_items?.[0];
    if (!item || item.visible === false || !item.name) return null;

    const assets = item.assets;
    const basic = item.basic_info;
    const release = item.release?.steam_release_date;

    let genres: string[] | null = null;
    if (detailsResponse) {
      const parsed = appDetailsSchema.safeParse(detailsResponse.data);
      const entry = parsed.success ? parsed.data[String(appId)] : undefined;
      const list = entry?.success ? (entry.data?.genres ?? []) : [];
      if (list.length > 0) genres = list.map((genre) => genre.description);
    }

    const releaseDate = release !== undefined ? new Date(release * 1000) : null;

    return {
      title: item.name,
      summary: basic?.short_description ? decodeEntities(basic.short_description) : null,
      developer: basic?.developers?.[0]?.name ?? null,
      publisher: basic?.publishers?.[0]?.name ?? null,
      genres,
      // La vertical si la hay; si no, la apaisada antes que nada — mejor una
      // carátula con la forma rara que un hueco gris.
      coverUrl: assets
        ? (assetUrl(assets, assets.library_capsule) ?? assetUrl(assets, assets.header))
        : null,
      heroUrl: assets ? assetUrl(assets, assets.library_hero) : null,
      releaseYear: releaseDate?.getFullYear() ?? null,
      releaseDate,
      // Steam da el día exacto cuando lo hay; los "por anunciar" no traen
      // fecha ninguna y se quedan sin ella (no en un año inventado).
      releaseDatePrecision: releaseDate ? 'day' : null,
    };
  } catch (error) {
    // Solo ASCII, misma convención que el resto de logs del main.
    console.warn(`[steam] sin ficha de tienda para el appid ${appId}:`, error);
    return null;
  }
};

// Búsqueda en la tienda para el alta — el respaldo de cuando IGDB no
// encuentra nada. Devuelve appid + nombre, que es lo justo para pintar una
// fila de resultado; el resto se pide con getSteamStoreDetails al elegirlo.
const searchSchema = z.object({
  items: z
    .array(z.object({ id: z.number(), name: z.string(), tiny_image: z.string().optional() }))
    .optional(),
});

export type SteamSearchResult = { appId: number; title: string; thumbnailUrl: string | null };

export const searchSteamStore = async (query: string): Promise<SteamSearchResult[]> => {
  const term = query.trim();
  if (term.length === 0) return [];

  try {
    const response = await axios.get<unknown>('https://store.steampowered.com/api/storesearch/', {
      params: { term, l: 'english', cc: 'US' },
      timeout: 10_000,
    });
    return (searchSchema.parse(response.data).items ?? []).map((item) => ({
      appId: item.id,
      title: item.name,
      thumbnailUrl: item.tiny_image ?? null,
    }));
  } catch (error) {
    console.warn('[steam] fallo buscando en la tienda:', error);
    return [];
  }
};
