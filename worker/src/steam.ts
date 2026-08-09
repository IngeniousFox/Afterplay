// La tienda de Steam como RESPALDO del buscador, igual que en el escritorio
// (src/main/steam/store.ts).
//
// El caso que existe de verdad: juegos anunciados y con página de tienda de
// los que IGDB no sabe absolutamente nada — ni por nombre, ni por búsqueda, ni
// por appid. Con la columna `games.igdbId` ya nullable, esos juegos se pueden
// dar de alta con `{ steamAppId }` como fuente, y este es el buscador que los
// encuentra.
//
// Sin clave de API: `storesearch` es un endpoint público de la tienda, no de
// la Web API de Steam. Lo que sí necesita clave son los logros y las stats de
// jugador, que aquí no se tocan.

const SEARCH_LIMIT = 12;

type StoreSearchResponse = {
  items?: { id: number; name: string; tiny_image?: string }[];
};

export type SteamSearchResult = {
  steamAppId: number;
  title: string;
  coverUrl: string | null;
};

export const searchSteamStore = async (query: string): Promise<SteamSearchResult[]> => {
  const term = query.trim();
  if (term.length < 2) return [];

  try {
    const url = new URL('https://store.steampowered.com/api/storesearch/');
    url.searchParams.set('term', term);
    url.searchParams.set('l', 'english');
    url.searchParams.set('cc', 'US');

    const response = await fetch(url.toString(), {
      // La tienda de Steam se cae o se pone lenta de vez en cuando, y esto es
      // un RESPALDO: que tarde no puede colgar el buscador entero.
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as StoreSearchResponse;
    return (data.items ?? []).slice(0, SEARCH_LIMIT).map((item) => ({
      steamAppId: item.id,
      title: item.name,
      // `tiny_image` es la miniatura apaisada del buscador. Se usa solo para
      // pintar la fila del resultado: al dar de alta, el escritorio pide la
      // ficha entera y se queda con la carátula VERTICAL de verdad.
      coverUrl: item.tiny_image ?? null,
    }));
  } catch {
    // Un respaldo que falla no es un error de la búsqueda: simplemente no
    // aporta nada esta vez.
    return [];
  }
};
