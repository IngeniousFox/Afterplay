import { app } from 'electron';
import { homedir } from 'node:os';

// Rutas: tokenización, ubicaciones y guardas de destino
// (PARTIDAS-GUARDADAS.md §8.1 y §10bis.5).

// Ludusavi habla con barras normales en todas partes (sus rutas, su
// config.yaml, su mapping.yaml). Windows acepta las dos, así que se
// normaliza en la frontera y dentro de este módulo ya no hay que pensarlo.
export const toSlashes = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '');

// ── Tokenización ──────────────────────────────────────────────────────────
// Lo que se guarda y SINCRONIZA nunca es una ruta absoluta, es una
// plantilla: `<winAppData>/StardewValley/Saves`. Se tokeniza al guardar y se
// expande al usar, así una ruta elegida a mano en un PC sigue valiendo en
// otro donde el usuario se llama distinto.
//
// El orden importa y va de MÁS ESPECÍFICO a MÁS GENÉRICO: con <home> arriba
// se comería a <winAppData>, que empieza igual.
type Marker = { token: string; resolve: () => string | null };

const MARKERS: Marker[] = [
  { token: '<winAppData>', resolve: () => process.env.APPDATA ?? null },
  { token: '<winLocalAppData>', resolve: () => process.env.LOCALAPPDATA ?? null },
  {
    token: '<winLocalAppDataLow>',
    resolve: () => (process.env.USERPROFILE ? `${process.env.USERPROFILE}/AppData/LocalLow` : null),
  },
  // Vía API de carpeta conocida y NO home + "/Documents": con OneDrive la
  // carpeta real puede ser C:/Users/X/OneDrive/Documentos, y componerla a
  // mano da una ruta que no existe.
  { token: '<winDocuments>', resolve: () => safeGetPath('documents') },
  { token: '<winSavedGames>', resolve: () => (homedir() ? `${homedir()}/Saved Games` : null) },
  { token: '<home>', resolve: () => homedir() },
];

const safeGetPath = (name: 'documents'): string | null => {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
};

export const tokenizePath = (absolutePath: string): string => {
  const path = toSlashes(absolutePath);
  for (const marker of MARKERS) {
    const base = marker.resolve();
    if (!base) continue;
    const prefix = toSlashes(base);
    if (path.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) {
      return `${marker.token}${path.slice(prefix.length)}`;
    }
    if (path.toLowerCase() === prefix.toLowerCase()) return marker.token;
  }
  // Una ruta fuera del perfil de usuario (D:/Juegos/...) no se puede
  // tokenizar: se guarda tal cual y el otro PC la usará solo si existe. Es
  // el caso que resuelve el destino personalizado de §10bis.5.
  return path;
};

export const expandPath = (tokenized: string): string => {
  for (const marker of MARKERS) {
    if (!tokenized.startsWith(marker.token)) continue;
    const base = marker.resolve();
    if (!base) return tokenized;
    return toSlashes(`${toSlashes(base)}${tokenized.slice(marker.token.length)}`);
  }
  return toSlashes(tokenized);
};

// ── Aviso de partidas atadas a la cuenta de Steam (§11.1) ─────────────────
// Varios juegos meten el SteamID (17 dígitos) DENTRO de la ruta. Entre dos
// PCs con la misma cuenta funciona; entre cuentas distintas no, y ningún
// mecanismo de tokenización lo arregla, porque el ID es parte del dato. Lo
// único que se puede hacer es avisar.
export const hasSteamIdPattern = (path: string): boolean =>
  /(^|\/)\d{17}(\/|$)/.test(toSlashes(path));

// ── Ubicaciones ───────────────────────────────────────────────────────────
// Un juego puede guardar en varios sitios a la vez (AppData + Documentos +
// carpeta de instalación). Redirigir solo uno deja la partida a medias
// (§4.9-3), así que la UI razona en UBICACIONES y no en "la carpeta del
// juego". Estas son las que se derivan de las rutas que trae un backup.

const segments = (path: string): string[] => toSlashes(path).split('/').filter(Boolean);

const longestCommonDirectory = (paths: string[]): string => {
  if (paths.length === 0) return '';
  // Se trabaja sobre las CARPETAS: el último segmento de cada ruta es el
  // nombre del archivo y no puede formar parte de una ubicación.
  const lists = paths.map((path) => segments(path).slice(0, -1));
  const [first, ...rest] = lists;
  const common: string[] = [];
  for (let index = 0; index < first.length; index++) {
    const part = first[index];
    if (!rest.every((list) => list[index]?.toLowerCase() === part.toLowerCase())) break;
    common.push(part);
  }
  return common.join('/');
};

// Contenedores demasiado genéricos para ser "la ubicación de un juego": si
// el prefijo común de todo se queda en C:/Users/Lara/AppData/Roaming, lo que
// hay debajo son carpetas de juegos distintas, no una sola ubicación.
const genericContainers = (): string[] => {
  const candidates = [
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    process.env.USERPROFILE ? `${process.env.USERPROFILE}/AppData/LocalLow` : null,
    process.env.USERPROFILE ? `${process.env.USERPROFILE}/AppData` : null,
    safeGetPath('documents'),
    homedir(),
    homedir() ? `${homedir()}/Saved Games` : null,
    'C:/Program Files',
    'C:/Program Files (x86)',
  ];
  return candidates
    .filter((value): value is string => Boolean(value))
    .map((value) => toSlashes(value).toLowerCase());
};

const isGenericContainer = (path: string, generic: string[]): boolean => {
  const lower = toSlashes(path).toLowerCase();
  // Raíz de unidad ("c:") o vacío: siempre genérico.
  if (lower === '' || /^[a-z]:$/.test(lower)) return true;
  // "C:/Users" y similares: por encima de cualquier carpeta conocida.
  return generic.includes(lower) || generic.some((container) => container.startsWith(`${lower}/`));
};

const MAX_LOCATION_DEPTH = 8;

const splitLocations = (paths: string[], generic: string[], depth: number): string[] => {
  if (paths.length === 0) return [];
  const prefix = longestCommonDirectory(paths);
  if (depth >= MAX_LOCATION_DEPTH || !isGenericContainer(prefix, generic)) return [prefix];

  // El prefijo común sigue siendo un contenedor genérico: se baja un
  // segmento más y se agrupa por él.
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const rest = segments(path).slice(segments(prefix).length);
    // Un archivo suelto directamente dentro del contenedor no se puede
    // afinar más: su ubicación es la carpeta que lo contiene.
    const head = rest.length > 1 ? rest[0] : null;
    const key = head ? [prefix, head].filter(Boolean).join('/') : prefix;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  if (groups.size <= 1) return [prefix];
  return [...groups.entries()].flatMap(([key, group]) =>
    key === prefix ? [prefix] : splitLocations(group, generic, depth + 1),
  );
};

// Las ubicaciones distintas que cubre una lista de archivos de un backup.
export const deriveLocations = (filePaths: string[]): string[] => {
  const normalized = filePaths.map(toSlashes).filter(Boolean);
  if (normalized.length === 0) return [];
  const unique = [...new Set(splitLocations(normalized, genericContainers(), 0))].filter(Boolean);
  return unique.sort();
};

// ── Guardas del destino de una restauración (§10bis.5) ────────────────────
// No hay ningún motivo legítimo para volcar una partida en la raíz de una
// unidad o dentro de Windows, y sí muchas formas de liarla.
export const forbiddenTargetReason = (target: string): string | null => {
  const path = toSlashes(target);
  const lower = path.toLowerCase();

  if (!path || /^[a-z]:$/.test(lower)) return "You can't restore into the root of a drive.";

  const systemRoots = [
    toSlashes(process.env.SystemRoot ?? 'C:/Windows').toLowerCase(),
    'c:/program files',
    'c:/program files (x86)',
  ];
  if (systemRoots.some((root) => lower === root || lower.startsWith(`${root}/`))) {
    return "You can't restore into Windows system folders.";
  }

  const appPaths = [
    safeToSlashes(() => app.getPath('userData')),
    safeToSlashes(() => app.getAppPath()),
  ];
  if (
    appPaths.some((appPath) => appPath && (lower === appPath || lower.startsWith(`${appPath}/`)))
  ) {
    return "You can't restore into Afterplay's own folder.";
  }

  return null;
};

const safeToSlashes = (get: () => string): string | null => {
  try {
    return toSlashes(get()).toLowerCase();
  } catch {
    return null;
  }
};
