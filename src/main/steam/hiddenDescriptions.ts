import axios from 'axios';
import { z } from 'zod';

// El último recurso para las descripciones de los logros OCULTOS (LOGROS.md §9).
//
// Orden de fuentes, de más propia a más ajena — y esta es la última:
//   1. API de Steam        -> nunca da la descripción de un oculto. Nunca.
//   2. Schema local de Steam -> sí la tiene, pero SOLO de los juegos que tu
//      cliente ha cacheado, o sea los que están en tu cuenta.
//   3. Steam Hunters (esto) -> el hueco que queda: juegos que están en Steam
//      pero no en TU cuenta. En la práctica, los pirata.
//
// Por qué un tercero, habiendo evitado dependencias hasta ahora: porque no
// hay alternativa. Hydra resuelve esto con un servidor propio que sirve el
// catálogo ya completo — no es una técnica que se pueda copiar en el cliente,
// es infraestructura. Sin backend, o se pregunta fuera o esos logros se
// quedan mudos para siempre.
//
// Las reglas con las que se usa, para que la dependencia pese lo menos
// posible:
//   · Solo se pregunta por juegos con appid Y que tengan ocultos SIN
//     descripción tras haber probado las dos fuentes de arriba.
//   · NADA se guarda en la base de datos. Es información de un tercero sobre
//     un juego, no un dato tuyo — no tiene por qué vivir en tu biblioteca ni
//     viajar a Turso. Se pide y se usa.
//   · Caché en MEMORIA mientras la app viva, para no repetir la misma
//     pregunta cada vez que abres la misma ficha.
//   · Si falla, silencio: los ocultos se quedan como estaban.

const BASE_URL = 'https://steamhunters.com/api/apps';
const TIMEOUT_MS = 6000;

const responseSchema = z.array(
  z.object({
    apiName: z.string(),
    description: z.string().optional(),
  }),
);

// apiName -> descripción, por appid. Vive lo que viva el proceso: no toca
// disco ni base de datos.
const memoryCache = new Map<number, Map<string, string>>();

// Tope LRU del caché. "Mientras la app viva" sin techo era una fuga con otro
// nombre en un proceso que pasa días en la bandeja: medido con volumen real
// (script suelto, process.memoryUsage), 300 appids con 40 descripciones cada
// uno retienen 6,1 MB. Con 64 appids el peor caso ronda 1,3 MB y el propósito
// original —no repetir la misma pregunta al reabrir la misma ficha— sigue
// cubierto de sobra: nadie alterna entre 64 fichas en una misma sesión.
const MEMORY_CACHE_MAX_APPS = 64;

// Los appid que ya fallaron, para no reintentar en bucle cada vez que se abre
// la ficha de un juego que ese servicio no conoce. Sin tope a propósito, al
// revés que memoryCache: son números pelados y 1.000 appids son 20 KB medidos
// — capar esto costaría más código del que ahorra.
const failed = new Set<number>();

export const getHiddenDescriptions = async (appId: number): Promise<Map<string, string>> => {
  const cached = memoryCache.get(appId);
  if (cached) {
    // Reinsertar al usar: el orden de inserción del Map hace de cola LRU, y
    // el que se acaba de usar pasa a ser el último candidato a salir.
    memoryCache.delete(appId);
    memoryCache.set(appId, cached);
    return cached;
  }
  if (failed.has(appId)) return new Map();

  try {
    const response = await axios.get<unknown>(`${BASE_URL}/${appId}/achievements`, {
      timeout: TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });

    const result = new Map<string, string>();
    for (const entry of responseSchema.parse(response.data)) {
      const description = entry.description?.trim();
      if (description) result.set(entry.apiName, description);
    }

    // Lleno = fuera el menos usado, que es el primero en orden de inserción
    // (el get de arriba reinserta al tocar).
    if (memoryCache.size >= MEMORY_CACHE_MAX_APPS) {
      const oldest = memoryCache.keys().next().value;
      if (oldest !== undefined) memoryCache.delete(oldest);
    }
    memoryCache.set(appId, result);
    return result;
  } catch {
    // Servicio caído, juego que no conoce, sin red... da igual: no es un
    // error que nadie deba ver. Los ocultos siguen diciendo "Hidden
    // achievement" y ya está.
    failed.add(appId);
    return new Map();
  }
};
