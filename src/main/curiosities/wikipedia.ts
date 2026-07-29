import axios from 'axios';
import { z } from 'zod';
import { igdbRequest } from '../igdb/client';

// El grounding de las curiosidades: el artículo REAL de Wikipedia del juego,
// en texto plano, para que el modelo tenga algo que contrastar en vez de
// tirar solo de memoria.
//
// La URL no se adivina buscando por título (dos juegos pueden llamarse
// igual): IGDB la trae exacta en su campo `websites` — type 3 es Wikipedia,
// comprobado en vivo (y ojo: el campo es `type`; el antiguo `category` ya ni
// se devuelve). La cobertura es muy buena incluso en indies pequeños.

// Los websites vienen expandidos (`websites.type, websites.url`), así que
// cada entrada es un objeto con sus campos, no un id suelto.
const websitesResponseSchema = z.array(
  z.object({
    id: z.number(),
    websites: z.array(z.object({ type: z.number().optional(), url: z.string() })).optional(),
    version_parent: z.number().optional(),
    parent_game: z.number().optional(),
  }),
);

const WIKIPEDIA_TYPE = 3;

// Tope del artículo que viaja en el prompt (~7k tokens): de sobra para los
// hechos jugosos (desarrollo, recepción, legado van al principio) sin pagar
// artículos-río enteros como el de Minecraft.
const EXTRACT_MAX_CHARS = 25_000;

const extractResponseSchema = z.object({
  query: z.object({
    pages: z.record(z.string(), z.object({ extract: z.string().optional() })),
  }),
});

export type WikipediaArticle = {
  url: string;
  extract: string;
};

const findWikipediaSite = (
  game: z.infer<typeof websitesResponseSchema>[number] | undefined,
): string | null =>
  game?.websites?.find(
    (entry) => entry.type === WIKIPEDIA_TYPE && entry.url.includes('wikipedia.org'),
  )?.url ?? null;

// null = el juego no tiene artículo de Wikipedia (según IGDB) o la página no
// tiene texto. Los errores de red/credenciales SÍ lanzan: significan "no se
// pudo comprobar", y el que llama debe dejar el juego pendiente para otro
// intento, no generar sin grounding creyendo que no había artículo.
export const getWikipediaArticle = async (igdbId: number): Promise<WikipediaArticle | null> => {
  if (!Number.isInteger(igdbId)) return null;

  const raw = await igdbRequest(
    'games',
    `fields websites.type, websites.url, version_parent, parent_game; where id = ${igdbId};`,
  );
  const [game] = websitesResponseSchema.parse(raw);
  let url = findWikipediaSite(game);

  // Las EDICIONES (Definitive, remaster, bundle...) casi nunca llevan su
  // propio enlace en IGDB, pero su juego base sí — comprobado con la
  // biblioteca real (Mafia II Definitive, Guacamelee STCE...). El artículo
  // del base es el grounding correcto: habla del mismo juego.
  const parentId = game?.version_parent ?? game?.parent_game;
  if (!url && parentId !== undefined) {
    const parentRaw = await igdbRequest(
      'games',
      `fields websites.type, websites.url; where id = ${parentId};`,
    );
    const [parent] = websitesResponseSchema.parse(parentRaw);
    url = findWikipediaSite(parent);
  }

  if (!url) return null;

  // El título del artículo va en la propia URL (/wiki/The_Witcher_3...). Se
  // respeta el host tal cual por si algún juego apunta a una Wikipedia que no
  // sea la inglesa.
  let host: string;
  let title: string;
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/wiki\/(.+)$/);
    if (!match) return null;
    host = parsed.hostname;
    title = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  // La API de extractos devuelve el artículo entero en texto plano —
  // exactamente el formato que quiere un prompt, sin HTML que limpiar.
  //
  // User-Agent obligatorio: la política de Wikimedia (https://w.wiki/4wJS)
  // exige que identifique la app y un contacto, y desde hace poco rechazan
  // con 403 el user-agent por defecto de axios ("axios/1.18.1") por no
  // cumplirla — comprobado en vivo con este mismo fallo.
  const response = await axios.get<unknown>(`https://${host}/w/api.php`, {
    params: {
      action: 'query',
      prop: 'extracts',
      explaintext: 1,
      format: 'json',
      redirects: 1,
      titles: title,
    },
    headers: {
      'User-Agent': 'Afterplay/1.0 (personal game-tracking app; https://github.com/afterplay)',
    },
    timeout: 15_000,
  });

  const data = extractResponseSchema.parse(response.data);
  const page = Object.values(data.query.pages)[0];
  const extract = page?.extract?.trim();
  if (!extract) return null;

  return { url, extract: extract.slice(0, EXTRACT_MAX_CHARS) };
};
