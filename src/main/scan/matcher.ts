import type { IgdbSearchResult } from '../igdb/types';
import { searchGames } from '../igdb/api';
import { buildSearchQueries } from './folderTitle';

// Cruzar nombres de carpeta con el catálogo de IGDB. Vive aparte del handler
// IPC porque tiene DOS clientes con ritmos muy distintos: el botón de Scan
// (decenas de carpetas de golpe) y el vigilante de fondo (una o dos, las que
// acaban de aparecer). Los dos tienen que respetar el mismo límite.

// Cuántas búsquedas van a la vez. El límite de IGDB es de 4 peticiones por
// segundo y CADA búsqueda nuestra son dos (relevancia + comodín, ver
// igdb/api.ts), así que de dos en dos vamos justo por debajo sin necesitar
// un limitador de verdad.
const SEARCH_CONCURRENCY = 2;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// `failed` distingue "IGDB dice que no hay nada" de "no se pudo preguntar".
// Parece un detalle y no lo es: sin esa diferencia, un corte de red de diez
// segundos se guardaba en la caché como "esta carpeta no es ningún juego" y
// se quedaba así hasta que alguien forzase un reescaneo a mano.
export type FolderMatch = { matches: IgdbSearchResult[]; failed: boolean };

export const matchFolderName = async (folderName: string): Promise<FolderMatch> => {
  // Cadena de consultas, de la más fiel al nombre de la carpeta a la más
  // recortada (ver folderTitle.ts). Se para en la PRIMERA que devuelva algo:
  // una carpeta limpia no paga el coste ni el riesgo de las variantes.
  let failed = false;

  for (const query of buildSearchQueries(folderName)) {
    // Un fallo de búsqueda NO es "sin resultados": con 16 carpetas seguidas
    // es casi siempre el rate limit de IGDB (4 peticiones/seg), y tragárselo
    // pintaba juegos perfectamente conocidos como "no match". Se reintenta
    // una vez tras un respiro antes de darlo por vacío.
    let result = await searchGames(query).catch(() => null);
    if (result === null) {
      await sleep(1500);
      result = await searchGames(query).catch(() => null);
    }

    if (result === null) {
      failed = true;
      continue;
    }
    // Se recorta a lo que la pantalla de escaneo pinta de verdad (portada,
    // título, año, dos géneros) y NADA MÁS — en particular sin `summary`
    // (la sinopsis completa de IGDB, cientos de caracteres de prosa) ni
    // `platforms`, que ella nunca lee. La diferencia importa aquí y no en
    // una búsqueda normal porque esto SÍ se escribe a disco (scan-cache.json)
    // y se queda ahí indefinidamente para cada carpeta y cada uno de sus
    // hasta 6 candidatos — guardar la sinopsis completa de media biblioteca
    // sin usarla nunca sería puro peso muerto en el fichero.
    if (result.length > 0) {
      return {
        matches: result.slice(0, 6).map((match) => ({ ...match, summary: null, platforms: [] })),
        failed: false,
      };
    }
  }

  return { matches: [], failed };
};

// Varias carpetas por lotes, respetando el límite. Devuelve los resultados
// en el mismo orden en que llegaron los nombres.
export const matchFolderNames = async (folderNames: string[]): Promise<FolderMatch[]> => {
  const results: FolderMatch[] = [];

  for (let index = 0; index < folderNames.length; index += SEARCH_CONCURRENCY) {
    const batch = folderNames.slice(index, index + SEARCH_CONCURRENCY);
    results.push(...(await Promise.all(batch.map((name) => matchFolderName(name)))));
    // Respiro entre lotes: cada búsqueda son DOS peticiones (relevancia +
    // comodín), así que un lote de 2 ya toca el límite de 4/seg de IGDB.
    // Sin esta pausa, los lotes encadenados lo superaban y las búsquedas
    // caían con 429.
    if (index + SEARCH_CONCURRENCY < folderNames.length) await sleep(600);
  }

  return results;
};
