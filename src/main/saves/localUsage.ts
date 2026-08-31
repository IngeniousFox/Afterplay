import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  getKnownLudusaviNames,
  getOwnBackupEntries,
} from '../db/queries/saves/getLocalBackupsIndex';
import type { LocalBackupsUsage } from './contracts';
import { getMachineId, setPruneFloor } from './machine';
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
// índice, la copia local es prescindible.
//
// Pero prescindible NO quiere decir inofensiva de borrar: el espejo de
// syncGameToR2 retira del bucket todo objeto que no esté en esta carpeta
// —así replica la retención de ludusavi—, así que vaciarla equivale a
// afirmar "esas versiones ya no valen" y el siguiente backup del juego se
// llevaría por delante su historial en la nube. Por eso cleanLocalBackups
// sube el suelo de poda ANTES de borrar nada: es exactamente el mismo caso
// que recuperar el índice desde el bucket (ver pruneFloor en machine.ts).

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
  // ÚNICA copia que existe — nada aquí puede marcarse como prescindible. Eso
  // vale para las dos mitades del censo, huérfanas incluidas: la puerta solo
  // cubría los zips ya sincronizados y el conteo de huérfanas corría siempre,
  // mientras que cleanLocalBackups se va en seco sin R2 (línea de abajo) sin
  // llegar nunca a su barrido. Resultado: Ajustes cantaba "1,2 GB
  // reclaimable" con el botón activo, y el clic contestaba "Nothing to free"
  // dejando el disco igual — el número decía que sobraba algo que ninguna
  // acción de la app podía tocar.
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

    if (r2Configured && mappingName && !known.has(mappingName)) {
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
  // La misma puerta que el censo, y por el mismo motivo: sin R2 nada de esta
  // carpeta es prescindible —ni los zips ya subidos, que no existen, ni las
  // huérfanas, que sin nube son la única copia de esa partida—. Las dos
  // mitades tienen que gatearse igual aquí y en getLocalBackupsUsage o el
  // botón de Ajustes se habilita con un número que este barrido no puede
  // hacer bueno.
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

  // 1. QUÉ se va a borrar. Se decide entero antes de tocar el disco porque el
  // suelo de poda (paso 2) tiene que estar puesto antes del primer rmSync.
  const own = await getOwnBackupEntries(getMachineId());
  const byGame = new Map<string, string[]>();
  for (const entry of own) {
    const filePath = join(findGameBackupDir(entry.ludusaviName), entry.backupName);
    if (!existsSync(filePath)) continue;
    const list = byGame.get(entry.ludusaviName) ?? [];
    list.push(entry.backupName);
    byGame.set(entry.ludusaviName, list);
  }

  // Huérfanas: el nombre real sale del mapping.yaml, no del directorio (misma
  // fuente que findGameBackupDir). Sin nombre legible no se toca — ante la
  // duda, no borrar. Ningún juego con filas en el índice puede caer aquí:
  // getKnownLudusaviNames incluye los nombres de save_backups enteros, así
  // que las dos listas de este paso no se solapan nunca.
  const known = new Set(await getKnownLudusaviNames());
  const orphanDirs: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const mappingName = readMapping(dir)?.name ?? null;
    if (!mappingName || known.has(mappingName)) continue;
    orphanDirs.push(dir);
  }

  if (byGame.size === 0 && orphanDirs.length === 0) return { files: 0, bytes: 0, folders: 0 };

  // 2. El suelo de poda, ANTES de borrar. Sin esto, el espejo a R2 leía la
  // carpeta recién vaciada como "la retención ya descartó esas versiones" y el
  // siguiente backup de cada juego borraba del bucket y del índice todo su
  // historial anterior — irreversible y sin un solo error a la vista. La
  // limpieza no es la retención de ludusavi hablando: es el usuario liberando
  // disco, y esta instalación deja de tener autoridad para afirmar que lo de
  // antes caducó.
  //
  // Va delante y no al final porque el paso 3 borra juego a juego y puede
  // lanzar a mitad: en Windows un EPERM/EBUSY (ludusavi o el antivirus con el
  // zip abierto) en el juego N deja los 1..N-1 ya borrados, y con el suelo al
  // final no se llegaba a poner nunca — justo el borrado en la nube que esto
  // existe para impedir. Subirlo de más solo cuesta espacio en el bucket;
  // subirlo de menos cuesta datos.
  setPruneFloor(new Date());

  // 3. Ya sincronizadas.
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

  // 4. Huérfanas. La lista es la del paso 1, no un relistado: alguna carpeta
  // puede haber desaparecido ya sola en el paso 3 (un juego que se queda sin
  // versiones se lleva su carpeta entera), y para esas no hay nada que hacer.
  for (const dir of orphanDirs) {
    if (!existsSync(dir)) continue;

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

  return { files, bytes, folders };
};
