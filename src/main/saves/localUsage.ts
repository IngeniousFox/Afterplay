import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  getKnownLudusaviNames,
  getOwnBackupEntries,
} from '../db/queries/saves/getLocalBackupsIndex';
import type { LocalBackupsUsage } from './contracts';
import { getMachineId } from './machine';
import { MAPPING_FILE, readMapping } from './mapping';
import { isR2Configured } from './r2';
import { getBackupDir } from './run';
import { deleteLocalBackups, findGameBackupDir } from './service';

// Mantenimiento de la carpeta LOCAL de backups (save-backups/, ver run.ts).
// Nunca se limpia sola: la retención de ludusavi (§9.1, full:3+differential:5)
// solo poda versiones VIEJAS de un juego cuando llega una NUEVA para ese
// mismo juego — un juego que se desinstala, se deja de respaldar, o
// simplemente no se vuelve a tocar en años se queda con su carpeta entera
// congelada en disco para siempre, sin que nada avise de cuánto ocupa ni dé
// forma de recuperarlo salvo borrar el juego de la biblioteca entera.
//
// La idea de fondo, la misma que images/maintenance.ts: esta carpeta NO es
// el dato — es la fuente desde la que se sube a R2, y R2 es quien de verdad
// importa (una restauración SIEMPRE baja de R2, nunca de aquí — ver
// orchestrator.ts:materializeBackup). Una vez algo está confirmado en el
// índice, la copia local es pura caché de disco: prescindible.

const EMPTY_USAGE: LocalBackupsUsage = {
  totalBytes: 0,
  totalFiles: 0,
  reclaimableBytes: 0,
  reclaimableFiles: 0,
  orphanBytes: 0,
  orphanFolders: 0,
};

const fileSize = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

export const getLocalBackupsUsage = async (): Promise<LocalBackupsUsage> => {
  const root = getBackupDir();
  if (!existsSync(root)) return EMPTY_USAGE;

  // Reclamable de verdad SOLO con nube configurada: sin R2, lo local es la
  // ÚNICA copia que existe — nada aquí puede marcarse como prescindible.
  const r2Configured = isR2Configured();
  const own = r2Configured ? await getOwnBackupEntries(getMachineId()) : [];
  const reclaimablePaths = new Set(
    own.map((entry) => join(findGameBackupDir(entry.ludusaviName), entry.backupName)),
  );
  const known = new Set(await getKnownLudusaviNames());

  const usage: LocalBackupsUsage = { ...EMPTY_USAGE };

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    // El nombre real viene del propio mapping.yaml, no del directorio — es
    // la misma fuente de verdad que usa findGameBackupDir para lo contrario
    // (nombre -> carpeta). Si no se puede leer (backup a medias, disco
    // raro), la carpeta se cuenta en el total pero NUNCA como huérfana: ante
    // la duda, no se toca — misma regla que el resto del módulo.
    const mappingName = readMapping(dir)?.name ?? null;
    let dirBytes = 0;

    let files: import('node:fs').Dirent[];
    try {
      files = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile()) continue;
      const filePath = join(dir, file.name);
      const size = fileSize(filePath);
      dirBytes += size;
      usage.totalBytes += size;
      usage.totalFiles++;
      if (file.name !== MAPPING_FILE && reclaimablePaths.has(filePath)) {
        usage.reclaimableBytes += size;
        usage.reclaimableFiles++;
      }
    }

    if (mappingName && !known.has(mappingName)) {
      usage.orphanBytes += dirBytes;
      usage.orphanFolders++;
    }
  }

  return usage;
};

// Borra lo prescindible: los zips ya confirmados en el índice de esta
// máquina (vía deleteLocalBackups, el mismo camino que un borrado manual de
// versión — así el mapping.yaml se queda consistente y una carpeta que se
// vacía del todo se recoge sola) y las carpetas huérfanas enteras.
export const cleanLocalBackups = async (): Promise<{
  files: number;
  bytes: number;
  folders: number;
}> => {
  if (!isR2Configured()) return { files: 0, bytes: 0, folders: 0 };
  const root = getBackupDir();
  if (!existsSync(root)) return { files: 0, bytes: 0, folders: 0 };

  let files = 0;
  let bytes = 0;
  let folders = 0;

  // Ficheros de una carpeta y su tamaño, en un mapa nombre -> bytes. Sirve
  // para medir por DIFERENCIA (antes/después de borrar) en vez de dar por
  // hecho qué se lleva deleteLocalBackups: cuando la última versión de un
  // juego se va, la carpeta entera desaparece con ella (incluido su
  // mapping.yaml) — contar solo los zips pedidos se quedaba corto en ese
  // caso, exactamente lo que el test de caracterización destapó.
  const folderContents = (dir: string): Map<string, number> => {
    const contents = new Map<string, number>();
    if (!existsSync(dir)) return contents;
    try {
      for (const file of readdirSync(dir, { withFileTypes: true })) {
        if (file.isFile()) contents.set(file.name, fileSize(join(dir, file.name)));
      }
    } catch {
      // Carpeta ilegible: no hay nada seguro que medir aquí, se deja tal cual.
    }
    return contents;
  };

  // 1. Ya sincronizadas.
  const own = await getOwnBackupEntries(getMachineId());
  const byGame = new Map<string, string[]>();
  for (const entry of own) {
    const filePath = join(findGameBackupDir(entry.ludusaviName), entry.backupName);
    if (!existsSync(filePath)) continue;
    const list = byGame.get(entry.ludusaviName) ?? [];
    list.push(entry.backupName);
    byGame.set(entry.ludusaviName, list);
  }
  for (const [ludusaviName, names] of byGame) {
    const dir = findGameBackupDir(ludusaviName);
    const before = folderContents(dir);
    deleteLocalBackups(ludusaviName, names);
    const after = folderContents(dir);
    for (const [name, size] of before) {
      if (!after.has(name)) {
        files++;
        bytes += size;
      }
    }
  }

  // 2. Huérfanas — releído tras el paso 1: alguna carpeta puede haberse
  // vaciado y desaparecido ya sola.
  const known = new Set(await getKnownLudusaviNames());
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const mappingName = readMapping(dir)?.name ?? null;
      if (!mappingName || known.has(mappingName)) continue;

      let dirBytes = 0;
      let dirFiles = 0;
      try {
        for (const file of readdirSync(dir, { withFileTypes: true })) {
          if (file.isFile()) {
            dirBytes += fileSize(join(dir, file.name));
            dirFiles++;
          }
        }
      } catch {
        // Si ni se puede listar, se borra igual: una carpeta huérfana e
        // ilegible no es un caso "ante la duda" — nada la reclama y nada
        // puede leerla tampoco.
      }
      rmSync(dir, { recursive: true, force: true });
      bytes += dirBytes;
      files += dirFiles;
      folders++;
    }
  }

  return { files, bytes, folders };
};
