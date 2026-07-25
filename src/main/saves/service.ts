import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { applyLudusaviConfig } from './config';
import type { RestorePlanFile } from './contracts';
import { listVersions, readMapping, removeBackupsFromMapping, type BackupVersion } from './mapping';
import { hasSteamIdPattern, toSlashes } from './paths';
import {
  ensureLudusaviReady,
  ensureSavesDirs,
  getBackupDir,
  getRestoreWorkspaceDir,
  runLudusavi,
} from './run';
import type {
  LudusaviCustomGame,
  LudusaviFindOutput,
  LudusaviGameEntry,
  LudusaviOperationOutput,
  LudusaviRedirect,
} from './types';

// Operaciones de alto nivel sobre ludusavi. Todo lo de aquí es local: subir
// y bajar de R2 vive en r2.ts, y quién decide cuándo hacer cada cosa, en
// ipc/saves.ts. La separación importa porque la mitad local funciona sin
// credenciales de nube (escanear, detectar, ver qué hay) y la nube sin
// binario no funciona en absoluto.

const ESCANEO_TIMEOUT_MS = 15 * 60 * 1000;

// Los archivos de un juego en la salida de un backup/preview, ya
// normalizados y sin los que ludusavi marcó como ignorados.
const entryFiles = (entry: LudusaviGameEntry): { path: string; bytes: number }[] =>
  Object.entries(entry.files ?? {})
    .filter(([, file]) => !file.ignored)
    .map(([path, file]) => ({ path: toSlashes(path), bytes: file.bytes ?? 0 }));

const entryRegistryKeys = (entry: LudusaviGameEntry): string[] =>
  Object.entries(entry.registry ?? {})
    .filter(([, value]) => !value.ignored)
    .map(([key]) => key);

export type ScannedGame = {
  // Nombre con el que ludusavi conoce el juego. Es la clave de todo lo
  // demás: se guarda en la BD para no re-emparejar por título en cada
  // operación (§7.1).
  ludusaviName: string;
  files: { path: string; bytes: number }[];
  registryKeys: string[];
  totalBytes: number;
  // Partida atada a la cuenta de Steam (§11.1): entre dos PCs con la misma
  // cuenta va; entre cuentas distintas, no. Solo se puede avisar.
  steamIdInPath: boolean;
};

const toScannedGame = (name: string, entry: LudusaviGameEntry): ScannedGame => {
  const files = entryFiles(entry);
  return {
    ludusaviName: name,
    files,
    registryKeys: entryRegistryKeys(entry),
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    steamIdInPath: files.some((file) => hasSteamIdPattern(file.path)),
  };
};

// Escaneo completo de la biblioteca: UNA sola invocación que compara todo lo
// instalado contra el manifest (§4.1 — 8,8s en la biblioteca real). No
// escribe nada: es un --preview.
export const scanLibrary = async (
  customGames: LudusaviCustomGame[] = [],
): Promise<ScannedGame[]> => {
  await ensureLudusaviReady();

  const output = await runLudusavi<LudusaviOperationOutput>(
    ['backup', '--preview', '--api', '--force', '--no-cloud-sync'],
    { timeoutMs: ESCANEO_TIMEOUT_MS, configure: () => applyLudusaviConfig({ customGames }) },
  );

  return (
    Object.entries(output.games ?? {})
      .filter(([, entry]) => entry.decision !== 'Ignored')
      .map(([name, entry]) => toScannedGame(name, entry))
      // Un juego "detectado" sin un solo archivo ni clave no aporta nada: es
      // ruido en la pantalla de resultados.
      .filter((game) => game.files.length > 0 || game.registryKeys.length > 0)
  );
};

// Empareja un título de Afterplay con el nombre que usa ludusavi. Se prueba
// primero exacto y luego --normalized (ignora mayúsculas, sufijos de edición
// y de año), que es lo que hizo que el emparejamiento fuera 11/11 en la
// prueba real (§4.2).
export const findLudusaviName = async (title: string): Promise<string | null> => {
  await ensureLudusaviReady();

  for (const args of [
    ['find', '--api', '--backup', title],
    ['find', '--api', '--backup', '--normalized', title],
  ]) {
    const output = await runLudusavi<LudusaviFindOutput>(args, {
      configure: () => applyLudusaviConfig(),
    }).catch(() => null);
    const [match] = Object.keys(output?.games ?? {});
    if (match) return match;
  }
  return null;
};

// Estado local de un juego concreto sin escribir nada: qué archivos tiene
// ahora mismo y si difieren del último backup. Es lo que alimenta el
// indicador de la ficha (§10.4) — barato y sin red.
export const previewGame = async (
  ludusaviName: string,
  customGames: LudusaviCustomGame[] = [],
): Promise<{ game: ScannedGame | null; change: 'new' | 'different' | 'same' | 'none' }> => {
  await ensureLudusaviReady();

  const output = await runLudusavi<LudusaviOperationOutput>(
    ['backup', '--preview', '--api', '--force', '--no-cloud-sync', ludusaviName],
    { configure: () => applyLudusaviConfig({ customGames }) },
  );

  const entry = output.games?.[ludusaviName];
  if (!entry) return { game: null, change: 'none' };

  const changed = output.overall?.changedGames;
  const change = changed?.new
    ? 'new'
    : changed?.different
      ? 'different'
      : changed?.same
        ? 'same'
        : 'none';
  return { game: toScannedGame(ludusaviName, entry), change };
};

// Backup real de un juego. Escribe en la carpeta local; subirlo a R2 es otro
// paso (ipc/saves.ts), a propósito: si la nube falla, la copia local ya
// existe y el siguiente intento la sube.
export const backupGame = async (
  ludusaviName: string,
  customGames: LudusaviCustomGame[] = [],
): Promise<ScannedGame | null> => {
  await ensureLudusaviReady();

  const output = await runLudusavi<LudusaviOperationOutput>(
    ['backup', '--api', '--force', '--no-cloud-sync', ludusaviName],
    { configure: () => applyLudusaviConfig({ customGames }) },
  );

  const entry = output.games?.[ludusaviName];
  return entry ? toScannedGame(ludusaviName, entry) : null;
};

// Carpeta local de un juego dentro del directorio de backups. Ludusavi usa
// el nombre del juego tal cual como nombre de carpeta.
export const getGameBackupDir = (ludusaviName: string, baseDir = getBackupDir()): string =>
  join(baseDir, ludusaviName);

export const listLocalVersions = (
  ludusaviName: string,
  baseDir = getBackupDir(),
): BackupVersion[] => listVersions(readMapping(getGameBackupDir(ludusaviName, baseDir)));

// Borra versiones de la carpeta LOCAL, no solo de la nube.
//
// Sin esto, borrar una copia desde la app no servía de nada: el zip seguía en
// disco, y el siguiente backup (a) lo usaba como base para un diferencial y
// (b) lo volvía a subir al reconciliar el espejo con R2. Es decir, la versión
// que acababas de borrar reaparecía sola, y encima con un incremental colgado
// de ella. Caso real, visto en la primera prueba de verdad.
export const deleteLocalBackups = (ludusaviName: string, names: string[]): void => {
  const dir = getGameBackupDir(ludusaviName);
  if (!existsSync(dir)) return;

  for (const name of names) rmSync(join(dir, name), { force: true });

  // Si no queda ninguna versión, la carpeta entera sobra: un mapping.yaml sin
  // backups solo sirve para confundir a la siguiente lectura.
  if (!removeBackupsFromMapping(dir, names)) rmSync(dir, { recursive: true, force: true });
};

// Nota: la lista de versiones sale del mapping.yaml (listLocalVersions) y no
// del subcomando `backups --api`. Los dos dicen lo mismo, pero el
// mapping.yaml además trae las rutas de cada versión —de donde salen las
// ubicaciones redirigibles— y leerlo no cuesta una invocación del binario.

export type RestoreOptions = {
  ludusaviName: string;
  // Carpeta que contiene la carpeta del juego (la local, o una temporal
  // materializada desde R2).
  restoreRoot: string;
  // Versión concreta a restaurar. Sin ella, ludusavi coge la más reciente.
  backupName?: string;
  redirects?: LudusaviRedirect[];
  // Excluir el registro del restore — es lo que permite "exportar a una
  // carpeta" sin escribir en HKCU (§4.9-4). Se le pasan las claves que trae
  // esa versión del backup.
  skipRegistryKeys?: string[];
  preview: boolean;
};

export type RestorePlan = {
  files: RestorePlanFile[];
  registryKeys: string[];
  totalBytes: number;
};

// Restaura (o previsualiza) un juego. El preview devuelve exactamente el
// mismo plan que ejecutaría el restore real, así que el diálogo de
// confirmación enseña la verdad y no una aproximación.
export const restoreGame = async (options: RestoreOptions): Promise<RestorePlan> => {
  const { ludusaviName, restoreRoot, backupName, redirects, skipRegistryKeys, preview } = options;

  await ensureLudusaviReady();

  const output = await runLudusavi<LudusaviOperationOutput>(
    [
      'restore',
      '--api',
      '--force',
      '--no-cloud-sync',
      ...(preview ? ['--preview'] : []),
      ...(backupName ? ['--backup', backupName] : []),
      ludusaviName,
    ],
    {
      configure: () =>
        applyLudusaviConfig({
          restorePath: restoreRoot,
          redirects: redirects ?? [],
          toggledRegistry: skipRegistryKeys?.length
            ? { [ludusaviName]: Object.fromEntries(skipRegistryKeys.map((key) => [key, false])) }
            : {},
        }),
    },
  );

  const entry = output.games?.[ludusaviName];
  const files = Object.entries(entry?.files ?? {})
    .filter(([, file]) => !file.ignored)
    .map(([target, file]) => ({
      target: toSlashes(target),
      source: file.originalPath ? toSlashes(file.originalPath) : null,
      bytes: file.bytes ?? 0,
    }));

  return {
    files,
    registryKeys: entryRegistryKeys(entry ?? {}),
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  };
};

// Carpeta temporal donde se materializa lo bajado de R2 antes de restaurar.
// Se borra siempre al terminar: es material de un solo uso.
// FUERA de la carpeta de backups a propósito: ahí dentro, cada subcarpeta es
// un juego para ludusavi, y un directorio temporal se colaría como uno más
// en cualquier operación que mire la carpeta entera.
export const createRestoreWorkspace = (ludusaviName: string): string => {
  ensureSavesDirs();
  const root = getRestoreWorkspaceDir();
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, ludusaviName), { recursive: true });
  return root;
};

export const clearRestoreWorkspace = (): void => {
  rmSync(getRestoreWorkspaceDir(), { recursive: true, force: true });
};

// ¿Hay algo dentro de la carpeta de destino? Restaurar ahí sobrescribe lo que
// coincida de nombre (verificado en §4.9-5), así que hay que avisar. Lo que
// no esté en el backup sobrevive: un restore no borra lo ajeno.
export const isDirectoryNonEmpty = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
};
