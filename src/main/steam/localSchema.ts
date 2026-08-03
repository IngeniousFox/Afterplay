import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isVdfObject, parseBinaryVdf } from './binaryVdf';
import type { VdfObject, VdfValue } from './binaryVdf';

// Las descripciones de los logros OCULTOS, sacadas de tu propia instalación
// de Steam (LOGROS.md §6).
//
// El porqué de todo esto: la Web API de Steam NO da nunca la descripción de
// un logro oculto. Comprobado a fondo — 253 logros ocultos de 13 juegos de
// esta biblioteca, cero con descripción; ni en el catálogo, ni en la
// respuesta de jugador, ni siquiera en los que ya están desbloqueados. La
// página pública de estadísticas tampoco la trae.
//
// Pero el cliente de Steam SÍ las enseña, así que las tiene: las guarda en
// `appcache/stats/UserGameStatsSchema_<appid>.bin`, un VDF binario con el
// schema completo del juego en todos los idiomas. Leerlo de ahí es local,
// instantáneo, gratis y sin depender de nadie — nada de scraping ni de APIs
// de terceros.
//
// Límite honesto: solo hay fichero de los juegos que TU Steam ha cacheado
// (los que tienes en la cuenta y ha visto alguna vez). Para el resto, no hay
// descripción oculta y la app lo dice en vez de inventarla.

const execFileAsync = promisify(execFile);

let steamPathCache: string | null | undefined;

// Dónde está instalado Steam. El registro es la fuente fiable (la gente lo
// instala en otro disco constantemente); las rutas típicas quedan de
// respaldo por si la consulta falla.
const resolveSteamPath = async (): Promise<string | null> => {
  if (steamPathCache !== undefined) return steamPathCache;

  const candidates: string[] = [];

  if (process.platform === 'win32') {
    for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam'])
      try {
        const { stdout } = await execFileAsync('reg', ['query', key, '/v', 'SteamPath'], {
          windowsHide: true,
        });
        const match = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (match) candidates.push(match[1].trim());
      } catch {
        // Clave inexistente: se prueba la siguiente.
      }

    candidates.push(
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Steam'),
    );
  }

  steamPathCache = candidates.find((path) => existsSync(join(path, 'appcache', 'stats'))) ?? null;
  return steamPathCache;
};

export type LocalAchievementText = {
  displayName: string | null;
  description: string | null;
};

// La cadena de un campo que puede venir como texto plano o como objeto de
// idiomas ({ english: "...", spanish: "..." }). Se prefiere inglés, que es lo
// que pide el resto de la app a la API; si no está, la primera que haya —
// una descripción en otro idioma sigue siendo mejor que ninguna.
const localizedString = (value: VdfValue | undefined): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (!isVdfObject(value)) return null;

  const english = value.english;
  if (typeof english === 'string' && english.trim()) return english.trim();

  for (const [key, candidate] of Object.entries(value)) {
    // `token` es la clave interna de localización ("NEW_ACHIEVEMENT_3_9_DESC"),
    // no un texto para enseñar a nadie.
    if (key === 'token') continue;
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
};

// Recorre el árbol buscando los nodos de logro. Se busca por FORMA (un nodo
// con `name` de texto y un `display` dentro) en vez de por la ruta exacta
// stats/N/bits/M: esa ruta ha cambiado entre versiones del fichero, y la
// forma no.
const collectAchievements = (node: VdfObject, into: Map<string, LocalAchievementText>): void => {
  const name = node.name;
  const display = node.display;

  if (typeof name === 'string' && isVdfObject(display)) {
    into.set(name, {
      displayName: localizedString(display.name),
      description: localizedString(display.desc),
    });
    return;
  }

  for (const child of Object.values(node)) {
    if (isVdfObject(child)) collectAchievements(child, into);
  }
};

// Textos de los logros de un juego según el Steam local. Map vacío si no hay
// fichero (juego que tu Steam no ha cacheado) o si algo va mal leyéndolo —
// esto es SIEMPRE un extra sobre lo que ya dio la API, nunca un requisito.
export const getLocalAchievementTexts = async (
  appId: number,
): Promise<Map<string, LocalAchievementText>> => {
  const result = new Map<string, LocalAchievementText>();

  try {
    const steamPath = await resolveSteamPath();
    if (!steamPath) return result;

    const file = join(steamPath, 'appcache', 'stats', `UserGameStatsSchema_${appId}.bin`);
    if (!existsSync(file)) return result;

    collectAchievements(parseBinaryVdf(readFileSync(file)), result);
  } catch (error) {
    console.warn(`[steam] no se pudo leer el schema local de ${appId} (sigo sin el):`, error);
  }

  return result;
};
