import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IgdbSearchResult } from '../igdb/types';
import type { ScannedFolder } from './contracts';

// Lo que el escaneo de carpetas ya sabe, guardado entre cierres de la app.
//
// Vive en un fichero de userData y NO en la BD, por el mismo motivo que
// machine-saves.json (PARTIDAS-GUARDADAS.md §7.2): son rutas de ESTA
// máquina, y la BD viaja a otros PCs por Turso — `D:\Videojuegos\Palworld`
// no significa nada en el portátil.
//
// Sin esto, cada apertura de "Scan your folders" volvía a recorrer los
// discos y a consultar IGDB por CADA carpeta (dos peticiones cada una,
// limitadas a 4/seg): unos 10 segundos y ~35 peticiones para redescubrir
// exactamente lo mismo de la vez anterior. Con la caché, lo único que se
// paga es lo que ha cambiado.

type CacheEntry = {
  // Cuándo se vio esta carpeta POR PRIMERA VEZ. No cambia nunca — es la
  // base de la ventana de "instalación a medias" de needsDescribe. Anclarla
  // a scannedAt era un bug silencioso: cada re-mirada actualizaba scannedAt,
  // la ventana se deslizaba con ella y una carpeta sin .exe (ROMs, assets)
  // se recorría entera cada barrido PARA SIEMPRE.
  firstSeenAt: string;
  // Cuándo se miró DENTRO de la carpeta por última vez.
  scannedAt: string;
  folder: ScannedFolder;
  // Los candidatos de IGDB. Se guardan aquí porque el nombre de una carpeta
  // no cambia: volver a preguntar por "Palworld" cada vez que se abre el
  // modal es gastar el rate limit para recibir la misma respuesta.
  matches: IgdbSearchResult[];
  // Cuándo contestó IGDB por última vez, o null si NUNCA se pudo preguntar
  // (sin red, sin credenciales, rate limit). Es lo que separa "no es ningún
  // juego" de "todavía no lo sé": sin este campo, escanear sin internet
  // guardaba todas las carpetas como carpetas-que-no-son-juegos y ahí se
  // quedaban. Lo del disco (tamaño, .exe) se guarda igual — eso es cierto
  // haya red o no.
  matchedAt: string | null;
};

type ScanCacheFile = {
  version: 1;
  entries: Record<string, CacheEntry>;
};

// Tope de seguridad. Se llega aquí solo señalando por error la raíz de un
// disco; a partir de ahí se tiran las entradas más viejas. Nunca debería
// activarse con un uso normal (una biblioteca grande son ~200 carpetas).
const MAX_ENTRIES = 2000;

// NO se cachea "no encontrado" para siempre: un `matches: []` puede ser una
// verdad (carpeta que no es un juego) o un fallo pasajero de IGDB que se
// tragó el reintento. Se vuelve a preguntar al día siguiente; el resto de
// entradas, las que SÍ encontraron algo, no caducan nunca.
const EMPTY_MATCH_TTL_MS = 24 * 60 * 60 * 1000;

// Cuánto se espera antes de reintentar una carpeta a la que NO se le pudo
// preguntar a IGDB (sin red, sin credenciales). Corto comparado con el TTL
// de arriba, porque aquí no se sabe nada todavía; largo comparado con el
// barrido, para no repetir la tanda entera cada cinco minutos.
const MATCH_RETRY_MS = 10 * 60 * 1000;

// Ventana en la que una carpeta sin ejecutable se vuelve a mirar en cada
// barrido. Cubre el caso real que rompe todo lo demás: la carpeta aparece
// en cuanto el instalador la crea, y en ese instante no tiene ni .exe ni
// tamaño. Pasadas dos horas se acepta que esa carpeta simplemente no tiene
// ejecutable y se deja de mirar (si no, una carpeta de mods sin .exe se
// recorrería en disco cada cinco minutos para siempre).
const UNSETTLED_WINDOW_MS = 2 * 60 * 60 * 1000;

// Clave canónica de una ruta. Windows no distingue mayúsculas Y acepta los
// dos separadores, así que `D:/Juegos\X` y `d:\juegos/x` son LA MISMA
// carpeta. Sin unificar las dos cosas, una raíz guardada con barras normales
// no reconocía como suyas las rutas que genera path.join() (con barras
// invertidas) y la caché entera se veía vacía.
export const pathKey = (path: string): string => path.toLowerCase().replace(/\//g, '\\');
const keyOf = pathKey;

const getCachePath = (): string => join(app.getPath('userData'), 'scan-cache.json');

let cached: ScanCacheFile | null = null;

const read = (): ScanCacheFile => {
  if (cached) return cached;

  let file: ScanCacheFile;
  try {
    const parsed = JSON.parse(readFileSync(getCachePath(), 'utf-8')) as Partial<ScanCacheFile>;
    // La caché es DESECHABLE: cualquier cosa rara (versión de otro futuro,
    // fichero a medio escribir) se tira sin pensarlo. Lo único que se pierde
    // es tiempo de un escaneo, jamás datos del usuario.
    file =
      parsed.version === 1 && parsed.entries
        ? { version: 1, entries: parsed.entries }
        : emptyFile();
  } catch {
    file = emptyFile();
  }

  cached = file;
  return file;
};

const emptyFile = (): ScanCacheFile => ({ version: 1, entries: {} });

const write = (file: ScanCacheFile): void => {
  cached = file;
  try {
    writeFileSync(getCachePath(), `${JSON.stringify(file, null, 2)}\n`);
  } catch (error) {
    // Que no se pueda escribir la caché no puede tumbar un escaneo: como
    // mucho significa que la próxima vez habrá que repetirlo.
    console.warn('[scan] no se pudo guardar la cache:', error);
  }
};

const isUnder = (path: string, root: string): boolean =>
  keyOf(path).startsWith(`${keyOf(root).replace(/\\+$/, '')}\\`);

// Las entradas que cuelgan de las raíces configuradas AHORA. Filtrar al leer
// en vez de borrar al quitar una raíz tiene una ventaja concreta: quitar y
// volver a poner una carpeta no cuesta un reescaneo, la caché sigue ahí.
export const getCachedEntries = (roots: string[]): CacheEntry[] => {
  const entries = Object.values(read().entries);
  return entries.filter((entry) => roots.some((root) => isUnder(entry.folder.path, root)));
};

export const getCachedEntry = (path: string): CacheEntry | null =>
  read().entries[keyOf(path)] ?? null;

export const putCachedEntries = (incoming: CacheEntry[]): void => {
  if (incoming.length === 0) return;

  const entries = { ...read().entries };
  for (const entry of incoming) entries[keyOf(entry.folder.path)] = entry;

  write({ version: 1, entries: prune(entries) });
};

export const dropCachedEntries = (paths: string[]): void => {
  if (paths.length === 0) return;

  const entries = { ...read().entries };
  for (const path of paths) delete entries[keyOf(path)];

  write({ version: 1, entries });
};

const prune = (entries: Record<string, CacheEntry>): Record<string, CacheEntry> => {
  const all = Object.entries(entries);
  if (all.length <= MAX_ENTRIES) return entries;

  const newest = all
    .sort(([, a], [, b]) => b.scannedAt.localeCompare(a.scannedAt))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(newest);
};

// ¿Hay que volver a mirar DENTRO de esta carpeta? Solo si nunca se miró, o
// si APARECIÓ hace poco y aún no se le ha visto ejecutable — o sea, si puede
// que la estuviéramos mirando a mitad de una instalación. La ventana cuenta
// desde la PRIMERA vez que se vio (firstSeenAt), no desde el último vistazo:
// si contara desde scannedAt, cada re-mirada la reabriría y una carpeta sin
// .exe jamás dejaría de escanearse.
export const needsDescribe = (entry: CacheEntry | null, now: number): boolean => {
  if (!entry) return true;
  if (entry.folder.executableCandidates.length > 0) return false;
  return now - Date.parse(entry.firstSeenAt ?? entry.scannedAt) < UNSETTLED_WINDOW_MS;
};

// ¿Hay que volver a preguntarle a IGDB por esta carpeta? Solo si nunca se
// pudo preguntar, o si la respuesta que hay es un "nada" que ya ha caducado.
export const needsMatch = (entry: CacheEntry | null, now: number): boolean => {
  if (!entry) return true;
  // Nunca hubo respuesta (sin red al escanear): se reintenta, pero no en
  // cada barrido. Sin este freno, estar sin internet convertía el barrido de
  // cada cinco minutos en una tanda entera de búsquedas fallidas. El `??`
  // cubre entradas de una versión anterior del fichero sin el campo — sin
  // él, Date.parse(undefined) da NaN y la carpeta no se preguntaba jamás.
  const matchedAt = entry.matchedAt ?? null;
  if (matchedAt === null) return now - Date.parse(entry.scannedAt) > MATCH_RETRY_MS;
  if (entry.matches.length > 0) return false;
  return now - Date.parse(matchedAt) > EMPTY_MATCH_TTL_MS;
};

// El escaneo más reciente que hay en la caché — la fecha que la pantalla
// enseña como "actualizado hace X".
export const getLastScanAt = (roots: string[]): string | null => {
  const times = getCachedEntries(roots).map((entry) => entry.scannedAt);
  return times.length === 0 ? null : times.reduce((a, b) => (a > b ? a : b));
};

export type { CacheEntry };
