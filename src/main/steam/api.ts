import axios from 'axios';
import { z } from 'zod';
import { normalizeSteamCommunityImageUrl } from '../images/steamCdn';

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
const normalizeIconUrl = (url: string | undefined): string | null =>
  url ? normalizeSteamCommunityImageUrl(url) : null;

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

// Un 400 de esta API casi nunca es un error de verdad: es como contesta
// "este appid no tiene stats" y "este appid no existe". Se distingue aquí
// para que quien llama no tenga que mirar códigos HTTP.
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

// Rareza: apiName -> % de jugadores que lo tienen. Sin key. Si falla, se
// devuelve vacío — la rareza es un adorno, nunca debe tumbar una sync.
export const getGlobalPercentages = async (appId: number): Promise<Map<string, number>> => {
  const result = new Map<string, number>();
  try {
    const raw = await steamGet('GetGlobalAchievementPercentagesForApp/v2/', { gameid: appId });
    const parsed = globalPercentagesResponse.parse(raw);
    for (const entry of parsed.achievementpercentages?.achievements ?? []) {
      result.set(entry.name, entry.percent);
    }
  } catch {
    // Silencio a propósito: un juego sin porcentajes publicados es normal.
  }
  return result;
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
