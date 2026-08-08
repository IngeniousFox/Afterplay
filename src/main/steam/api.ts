import axios from 'axios';
import { z } from 'zod';
import { hasImageFilename, normalizeSteamCommunityImageUrl } from '../images/steamCdn';

// Cliente de la Steam Web API para los logros (LOGROS.md §3).
//
// Tres endpoints, con tres niveles de exigencia distintos — y esa diferencia
// es la que decide qué funciona para quién:
//
//   · GetSchemaForGame        -> el CATÁLOGO de logros. Pide key, pero
//                                responde para CUALQUIER appid tengas el
//                                juego o no. Es lo que permite enseñar los
//                                logros de un juego pirata o solo planeado.
//   · GetGlobalAchievement…   -> la rareza. NO pide key ni nada.
//   · GetPlayerAchievements   -> TUS desbloqueos. Pide key + tu SteamID64, y
//                                respeta la privacidad del perfil: los
//                                "detalles de juego" tienen que estar en
//                                público. La key no se lo salta.

const BASE_URL = 'https://api.steampowered.com/ISteamUserStats';
const TIMEOUT_MS = 10_000;

// Un juego puede tener stats pero NO logros — el campo entero falta entonces.
const schemaResponse = z.object({
  game: z
    .object({
      gameName: z.string().optional(),
      availableGameStats: z
        .object({
          achievements: z
            .array(
              z.object({
                name: z.string(),
                displayName: z.string(),
                // Ausente en los OCULTOS, y para siempre: Steam no la manda
                // nunca por la Web API — tampoco al desbloquearlos (la API de
                // jugador devuelve "" en esos). El nombre sí lo da; lo único
                // que se queda en secreto es qué hay que hacer.
                description: z.string().optional(),
                hidden: z.number(),
                icon: z.string().optional(),
                icongray: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

const globalPercentagesResponse = z.object({
  achievementpercentages: z
    .object({
      // percent llega como string en unas respuestas y como número en otras
      // — coerce lo normaliza sin tener que adivinar cuál toca.
      achievements: z.array(z.object({ name: z.string(), percent: z.coerce.number() })).optional(),
    })
    .optional(),
});

const playerAchievementsResponse = z.object({
  playerstats: z.object({
    success: z.boolean().optional(),
    error: z.string().optional(),
    achievements: z
      .array(
        z.object({
          apiname: z.string(),
          achieved: z.number(),
          // Segundos unix. Puede ser 0 en logros desbloqueados muy antiguos:
          // Steam no guardó la fecha en sus primeros años.
          unlocktime: z.number(),
        }),
      )
      .optional(),
  }),
});

// Los iconos que da GetSchemaForGame apuntan a una ubicación que Steam ya no
// sirve para buena parte del catálogo — el porqué completo, en images/
// steamCdn.ts. Se traducen AQUÍ para que lo que se guarde nazca ya bien.
//
// Y se descartan las que no llevan fichero (terminan en '/'): así es como
// Steam devuelve el icono de un logro al que su desarrollador aún no le ha
// puesto ninguno, y guardar eso es guardar una URL que no puede funcionar
// nunca — un 403 garantizado por cada logro del juego. Sin icono es null,
// que es lo que de verdad es.
const normalizeIconUrl = (url: string | undefined): string | null => {
  if (!url) return null;
  const normalized = normalizeSteamCommunityImageUrl(url);
  return hasImageFilename(normalized) ? normalized : null;
};

export type SteamAchievementDef = {
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  iconGrayUrl: string | null;
  hidden: boolean;
  sortIndex: number;
};

export type SteamUnlock = {
  apiName: string;
  // null cuando Steam registró el desbloqueo sin fecha (unlocktime 0) — sí
  // lo tienes, pero no se sabe cuándo. Distinto de "no lo tienes".
  unlockedAt: Date | null;
};

const getKey = (): string | null => process.env.STEAM_API_KEY || null;
export const getSteamUserId = (): string | null => process.env.STEAM_USER_ID64 || null;
export const hasSteamKey = (): boolean => getKey() !== null;

// Un 400 o un 403 de esta API casi nunca son un error de verdad: son como
// contesta "este appid no tiene stats" y "este appid no existe". Se distingue
// aquí para que quien llama no tenga que mirar códigos HTTP.
//
// El caso más común no es un appid malo, es un juego que TODAVÍA no ha salido:
// mientras está en "coming soon" no hay stats que servir aunque su ficha ya
// anuncie logros (comprobado con Enter the kOS, que los lista y aun así da
// 403). Es un "no" que caduca solo el día del lanzamiento, así que se sigue
// preguntando en cada sync — pero sin ruido, porque es la respuesta esperada.
class SteamNoStatsError extends Error {}

const steamGet = async (
  path: string,
  params: Record<string, string | number>,
): Promise<unknown> => {
  try {
    const response = await axios.get<unknown>(`${BASE_URL}/${path}`, {
      params,
      timeout: TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 400 || error.response?.status === 403)
    ) {
      throw new SteamNoStatsError(`${path}: ${error.response?.status}`);
    }
    throw error;
  }
};

// El catálogo de logros de un juego. Devuelve [] si el juego no tiene
// ninguno — que es una respuesta legítima, no un fallo (7 Days to Die, por
// ejemplo, tiene stats pero cero logros).
export const getAchievementSchema = async (appId: number): Promise<SteamAchievementDef[]> => {
  const key = getKey();
  if (!key) throw new Error('Sin STEAM_API_KEY');

  let raw: unknown;
  try {
    raw = await steamGet('GetSchemaForGame/v2/', { key, appid: appId, l: 'english' });
  } catch (error) {
    if (error instanceof SteamNoStatsError) return [];
    throw error;
  }

  const parsed = schemaResponse.parse(raw);
  const achievements = parsed.game?.availableGameStats?.achievements ?? [];

  return achievements.map((achievement, index) => ({
    apiName: achievement.name,
    displayName: achievement.displayName,
    description: achievement.description ?? null,
    iconUrl: normalizeIconUrl(achievement.icon),
    iconGrayUrl: normalizeIconUrl(achievement.icongray),
    hidden: achievement.hidden === 1,
    sortIndex: index,
  }));
};

// Rareza: apiName -> % de jugadores que lo tienen. Sin key. Nunca lanza — la
// rareza es un adorno y no debe tumbar una sync.
//
// null y no un Map vacío cuando falla, y la diferencia importa: un mapa vacío
// significa "este juego NO publica porcentajes" (respuesta legítima), y quien
// llama lo escribe tal cual. Con el fallo devolviendo también vacío, un
// timeout de 10s o un 429 de un instante bastaban para machacar con null la
// rareza buena que ya había guardada, y la ficha se quedaba sin porcentajes
// hasta la siguiente sync que sí tuviera suerte. Ahora "no se pudo saber" se
// distingue de "no hay nada que saber", y solo lo segundo escribe.
export const getGlobalPercentages = async (appId: number): Promise<Map<string, number> | null> => {
  try {
    const raw = await steamGet('GetGlobalAchievementPercentagesForApp/v2/', { gameid: appId });
    const parsed = globalPercentagesResponse.parse(raw);
    const result = new Map<string, number>();
    for (const entry of parsed.achievementpercentages?.achievements ?? []) {
      result.set(entry.name, entry.percent);
    }
    return result;
  } catch (error) {
    // Un juego sin stats (el caso de los que no han salido) no es un fallo: es
    // Steam contestando, y en silencio como sus dos hermanas de aquí al lado.
    // Con un warn se llenaba el log de trazas en cada sync, una por cada juego
    // de la lista de pendientes que aún no ha salido — y son justo los que más
    // veces se resincronizan.
    //
    // Se devuelve null igual (no un mapa vacío) y a propósito: "todavía no hay
    // porcentajes" no es "este juego no publica porcentajes". El día que salga
    // los tendrá, y hasta entonces no hay por qué escribir nada.
    if (!(error instanceof SteamNoStatsError)) {
      console.warn(`[steam] sin rareza para ${appId} (se conserva la guardada):`, error);
    }
    return null;
  }
};

// Tus desbloqueos en un juego. null (y no []) cuando Steam se niega a
// contestar — juego que no tienes, perfil privado, sin stats: en ese caso NO
// se sabe nada, que es muy distinto de "no has desbloqueado ninguno" y no
// debe guardarse como si lo fuera.
export const getPlayerUnlocks = async (appId: number): Promise<SteamUnlock[] | null> => {
  const key = getKey();
  const steamId = getSteamUserId();
  if (!key || !steamId) return null;

  let raw: unknown;
  try {
    raw = await steamGet('GetPlayerAchievements/v1/', { key, steamid: steamId, appid: appId });
  } catch (error) {
    if (error instanceof SteamNoStatsError) return null;
    throw error;
  }

  const parsed = playerAchievementsResponse.parse(raw);
  if (parsed.playerstats.success === false) return null;

  return (parsed.playerstats.achievements ?? [])
    .filter((achievement) => achievement.achieved === 1)
    .map((achievement) => ({
      apiName: achievement.apiname,
      unlockedAt: achievement.unlocktime > 0 ? new Date(achievement.unlocktime * 1000) : null,
    }));
};
