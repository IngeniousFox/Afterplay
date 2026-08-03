import axios from 'axios';
import { z } from 'zod';

// Cliente de la Web API de RetroAchievements (RETROACHIEVEMENTS.md §4.2).
// Formas verificadas EN VIVO contra la API real (3-ago-2026) con la key del
// usuario — no contra documentación. Autenticación: la key viaja en `y`; el
// usuario (`u`) solo dice de quién son los datos que se piden.
//
// A diferencia de Steam (que distingue "no tienes el juego" con un 400/403),
// aquí todas las respuestas son 200 con JSON; los errores reales son de red
// o de key inválida (401), y suben tal cual — quien llama decide si son
// silenciables.

const BASE_URL = 'https://retroachievements.org/API';
const TIMEOUT_MS = 12_000;

export const hasRaCredentials = (): boolean =>
  Boolean(process.env.RA_USERNAME && process.env.RA_API_KEY);

const getCredentials = (): { username: string; apiKey: string } => {
  const username = process.env.RA_USERNAME;
  const apiKey = process.env.RA_API_KEY;
  if (!username || !apiKey) throw new Error('Sin credenciales de RetroAchievements');
  return { username, apiKey };
};

// Reintentos SOLO para el 429: la API de RA va detrás de Cloudflare con un
// límite por minuto bastante corto (comprobado en vivo: la pasada de
// catálogos lo pisó al 14º juego seguido). Un 429 no es un fallo — es "más
// despacio": se espera lo que pida Retry-After (o un backoff creciente) y se
// repite. Cualquier otro error sube tal cual, como siempre.
const MAX_ATTEMPTS = 4;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const raRequest = async (
  endpoint: string,
  params: Record<string, string | number>,
): Promise<unknown> => {
  const { apiKey } = getCredentials();

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await axios.get<unknown>(`${BASE_URL}/${endpoint}`, {
        params: { ...params, y: apiKey },
        timeout: TIMEOUT_MS,
      });
      return response.data;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status !== 429 || attempt >= MAX_ATTEMPTS) throw error;

      const retryAfter = axios.isAxiosError(error)
        ? Number(error.response?.headers?.['retry-after'])
        : NaN;
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s
      await sleep(waitMs);
    }
  }
};

// Fechas de RA: "YYYY-MM-DD HH:mm:ss" en UTC (documentado por RA y coherente
// con lo observado en vivo). null si no viene o no parsea.
const parseRaDate = (raw: string | undefined | null): Date | null => {
  if (!raw) return null;
  const ms = Date.parse(`${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
};

// Las URLs de los badges: la API da solo el nombre; el fichero vive en su
// CDN de media. La variante _lock es el icono apagado — mismo papel que el
// iconGrayUrl de Steam.
export const raBadgeUrl = (badgeName: string): string =>
  `https://media.retroachievements.org/Badge/${badgeName}.png`;
export const raBadgeLockedUrl = (badgeName: string): string =>
  `https://media.retroachievements.org/Badge/${badgeName}_lock.png`;

// ── GetConsoleIDs ──────────────────────────────────────────────────────────

const consoleSchema = z.object({
  ID: z.number(),
  Name: z.string(),
  Active: z.boolean(),
  IsGameSystem: z.boolean(),
});

export type RaConsole = { id: number; name: string };

// Solo los sistemas ACTIVOS y de juego: la lista incluye eventos y "Hubs"
// inactivos que no son consolas.
export const getRaConsoles = async (): Promise<RaConsole[]> => {
  const parsed = z.array(consoleSchema).parse(await raRequest('API_GetConsoleIDs.php', {}));
  return parsed
    .filter((entry) => entry.Active && entry.IsGameSystem)
    .map((entry) => ({ id: entry.ID, name: entry.Name }));
};

// ── GetGameList (por consola, solo juegos CON set) ─────────────────────────

const gameListEntrySchema = z.object({
  ID: z.number(),
  Title: z.string(),
  NumAchievements: z.number(),
});

export type RaGameListEntry = { raGameId: number; title: string; numAchievements: number };

export const getRaGameList = async (consoleId: number): Promise<RaGameListEntry[]> => {
  const parsed = z
    .array(gameListEntrySchema)
    .parse(await raRequest('API_GetGameList.php', { i: consoleId, f: 1 }));
  return (
    parsed
      .map((entry) => ({
        raGameId: entry.ID,
        title: entry.Title,
        numAchievements: entry.NumAchievements,
      }))
      // Fuera hacks, homebrew marcados y subsets: "~Hack~ Pokémon Bronze" o
      // "[Subset - Bonus]" emparejarían por título contra el juego real y son
      // OTRO set. El juego canónico nunca lleva esas marcas.
      .filter((entry) => !entry.title.startsWith('~') && !entry.title.includes('[Subset'))
  );
};

// ── GetGameInfoAndUserProgress (catálogo + tus desbloqueos, en una) ────────

const progressAchievementSchema = z.object({
  ID: z.number(),
  Title: z.string(),
  Description: z.string().nullable().optional(),
  Points: z.number(),
  BadgeName: z.string(),
  NumAwarded: z.number(),
  DisplayOrder: z.number().nullable().optional(),
  DateEarned: z.string().optional(),
  DateEarnedHardcore: z.string().optional(),
});

const gameProgressSchema = z.object({
  ID: z.number(),
  Title: z.string(),
  NumDistinctPlayers: z.number(),
  NumAchievements: z.number(),
  // Objeto indexado por id — {} cuando el juego no tiene logros. z.record
  // sobre el value; las claves dan igual (cada entry ya trae su ID).
  Achievements: z.record(z.string(), progressAchievementSchema).or(z.array(z.never())),
});

export type RaAchievementDefinition = {
  raAchievementId: number;
  title: string;
  description: string | null;
  points: number;
  badgeName: string;
  // % de jugadores del juego que lo tienen — rareza DENTRO de la comunidad
  // RA (no comparable 1:1 con Steam, pero misma gramática de colores).
  globalPercent: number | null;
  sortIndex: number;
  // Fecha MÁS TEMPRANA de las dos (softcore/hardcore) — "la primera vez que
  // lo hiciste", la misma regla que el fundido de fuentes.
  earnedAt: Date | null;
};

export type RaGameProgress = {
  raGameId: number;
  title: string;
  achievements: RaAchievementDefinition[];
};

export const getRaGameProgress = async (raGameId: number): Promise<RaGameProgress> => {
  const { username } = getCredentials();
  const parsed = gameProgressSchema.parse(
    await raRequest('API_GetGameInfoAndUserProgress.php', { g: raGameId, u: username }),
  );

  const entries = Array.isArray(parsed.Achievements) ? [] : Object.values(parsed.Achievements);
  const players = Math.max(1, parsed.NumDistinctPlayers);

  return {
    raGameId: parsed.ID,
    title: parsed.Title,
    achievements: entries.map((entry) => {
      const earnedDates = [parseRaDate(entry.DateEarned), parseRaDate(entry.DateEarnedHardcore)]
        .filter((date): date is Date => date !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      return {
        raAchievementId: entry.ID,
        title: entry.Title,
        description: entry.Description?.trim() ? entry.Description : null,
        points: entry.Points,
        badgeName: entry.BadgeName,
        globalPercent:
          parsed.NumDistinctPlayers > 0
            ? Math.round((entry.NumAwarded / players) * 1000) / 10
            : null,
        sortIndex: entry.DisplayOrder ?? 0,
        earnedAt: earnedDates[0] ?? null,
      };
    }),
  };
};

// ── GetUserRecentAchievements (el sondeo en vivo) ──────────────────────────

const recentSchema = z.object({
  Date: z.string(),
  AchievementID: z.number(),
  GameID: z.number(),
  GameTitle: z.string(),
});

export type RaRecentUnlock = {
  raAchievementId: number;
  raGameId: number;
  gameTitle: string;
  unlockedAt: Date | null;
};

export const getRaRecentUnlocks = async (minutes: number): Promise<RaRecentUnlock[]> => {
  const { username } = getCredentials();
  const parsed = z
    .array(recentSchema)
    .parse(await raRequest('API_GetUserRecentAchievements.php', { u: username, m: minutes }));
  return parsed.map((entry) => ({
    raAchievementId: entry.AchievementID,
    raGameId: entry.GameID,
    gameTitle: entry.GameTitle,
    unlockedAt: parseRaDate(entry.Date),
  }));
};
