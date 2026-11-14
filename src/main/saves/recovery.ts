import { parse } from 'yaml';
import { appCtx } from '../db/v2/appDb';
import {
  deleteDeviceSaveBackups,
  listIndexedSaveObjectKeys,
  listSaveGames,
  parseSaveObjectKey,
  recoverSaveBackups,
  saveFolderPrefix,
  type BucketDevice,
  type RecoveredSaveBackup,
  type SaveGame,
} from '../db/v2/queries/saves';
import type { CloudFolder, CloudInventory, RecoveryResult } from './contracts';
import type { MachineManifest } from './identity';
import { setPruneFloor } from './machine';
import { listVersions, MAPPING_FILE } from './mapping';
import { deriveLocations } from './paths';
import * as r2 from './r2';
import type { BackupMapping } from './types';

// Recuperación del índice a partir del bucket (PARTIDAS-GUARDADAS.md §9).
//
// El índice save_backups es lo ÚNICO que hace restaurable un backup: sin su
// fila, el zip está ahí arriba pagándose y la app no puede ni verlo ni
// borrarlo. Una reinstalación sin sync lo pierde entero.
//
// Esto lo reconstruye leyendo el bucket, que sabe explicarse solo:
//   · la clave da el saveKey y el dispositivo  (saves/<saveKey>/<deviceId>/…)
//   · el mapping.yaml da el nombre de ludusavi, las versiones, sus fechas,
//     de qué completo cuelga cada diferencial, sus ficheros y el registro
//   · machines/<id>.json da el nombre del PC y su %USERPROFILE%
//   · el propio listado da los tamaños reales, sin descargar nada

const SAVES_PREFIX = 'saves/';

type FolderObjects = { key: string; size: number; file: string };

type BucketFolder = { saveKey: string; machineId: string; objects: FolderObjects[] };

// saves/<saveKey>/<deviceId>/<fichero> (queries/saves/objectKey.ts) —
// cualquier otra forma se ignora en vez de adivinar: el bucket puede tener
// cosas que no ha puesto Afterplay.
const groupByFolder = (objects: { key: string; size: number }[]): Map<string, BucketFolder> => {
  const folders = new Map<string, BucketFolder>();
  for (const object of objects) {
    const parsed = parseSaveObjectKey(object.key);
    if (!parsed) continue;
    const id = `${parsed.saveKey}/${parsed.deviceId}`;
    const entry = folders.get(id) ?? {
      saveKey: parsed.saveKey,
      machineId: parsed.deviceId,
      objects: [],
    };
    entry.objects.push({ key: object.key, size: object.size, file: parsed.backupName });
    folders.set(id, entry);
  }
  return folders;
};

// La carpeta del bucket casa con el juego por su saveKey (el igdbId en decimal
// para todo lo que venía de la 1.x).
const gamesBySaveKey = (games: SaveGame[]): Map<string, SaveGame> =>
  new Map(
    games.flatMap((game): [string, SaveGame][] =>
      game.saveKey === null ? [] : [[game.saveKey, game]],
    ),
  );

const readManifests = async (): Promise<Map<string, MachineManifest>> => {
  const byId = new Map<string, MachineManifest>();
  try {
    for (const { key } of await r2.listKeys(r2.MACHINES_PREFIX)) {
      if (!key.endsWith('.json')) continue;
      const manifest = await r2.readJson<MachineManifest>(key);
      if (manifest?.machineId) byId.set(manifest.machineId, manifest);
    }
  } catch {
    // Sin registro de máquinas se recupera igual: solo faltarán el nombre
    // del PC y su home, que se suplen más abajo.
  }
  return byId;
};

// Qué hay realmente en el bucket, contrastado con lo que el índice conoce.
// Un LIST de saves/ (más otro de machines/) y ni una descarga: los tamaños
// vienen en el propio listado.
export const scanBucket = async (): Promise<CloudInventory> => {
  const objects = await r2.listKeys(SAVES_PREFIX);
  const folders = groupByFolder(objects);
  const manifests = await readManifests();
  const ctx = appCtx();
  const gameBySaveKey = gamesBySaveKey(listSaveGames(ctx));
  const currentMachineId = ctx.deviceId;

  // Las claves que el índice ya conoce, de TODOS los juegos — es lo que
  // distingue "esto ya se puede restaurar" de "esto está huérfano".
  const knownKeys = listIndexedSaveObjectKeys(ctx);

  const machineTotals = new Map<string, { totalBytes: number; backupCount: number }>();
  const result: CloudFolder[] = [];
  let totalBytes = 0;
  let unknownBytes = 0;

  for (const folder of folders.values()) {
    const zips = folder.objects.filter((object) => object.file !== MAPPING_FILE);
    const folderBytes = folder.objects.reduce((sum, object) => sum + object.size, 0);
    const unknown = zips.filter((object) => !knownKeys.has(object.key));

    totalBytes += folderBytes;
    unknownBytes += unknown.reduce((sum, object) => sum + object.size, 0);

    const machine = machineTotals.get(folder.machineId) ?? { totalBytes: 0, backupCount: 0 };
    machine.totalBytes += folderBytes;
    machine.backupCount += zips.length;
    machineTotals.set(folder.machineId, machine);

    const game = gameBySaveKey.get(folder.saveKey);
    result.push({
      saveKey: folder.saveKey,
      machineId: folder.machineId,
      gameTitle: game?.title ?? null,
      gameId: game?.id ?? null,
      backupCount: zips.length,
      totalBytes: folderBytes,
      unknownCount: unknown.length,
    });
  }

  return {
    totalBytes,
    objectCount: objects.length,
    unknownBytes,
    folders: result.sort((a, b) => b.totalBytes - a.totalBytes),
    machines: [...machineTotals.entries()]
      .map(([machineId, totals]) => ({
        machineId,
        machineName: manifests.get(machineId)?.machineName ?? null,
        home: manifests.get(machineId)?.home ?? null,
        isCurrent: machineId === currentMachineId,
        ...totals,
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes),
  };
};

// El %USERPROFILE% de la máquina que hizo el backup, deducido de las rutas
// absolutas del propio mapping.yaml. Es el plan B para carpetas subidas antes
// de que existiera el registro de máquinas: sin él, restaurar en otro PC no
// sabría traducir C:/Users/Lara -> C:/Users/Jon. Vacío si no se puede
// deducir, que buildRedirects ya trata como "no redirigir" (§8.2).
const HOME_RE = /^([A-Za-z]:\/Users\/[^/]+)\//;

const guessHome = (files: string[]): string => {
  for (const file of files) {
    const match = HOME_RE.exec(file);
    if (match) return match[1];
  }
  return '';
};

export const recoverIndexFromCloud = async (): Promise<RecoveryResult> => {
  const objects = await r2.listKeys(SAVES_PREFIX);
  const folders = groupByFolder(objects);
  const manifests = await readManifests();
  const gameBySaveKey = gamesBySaveKey(listSaveGames(appCtx()));
  const knownKeys = listIndexedSaveObjectKeys(appCtx());

  // Primero se lee todo el bucket (red) y después se escribe en UNA
  // transacción (recoverSaveBackups), que relee cada juego.
  const pending: RecoveredSaveBackup[] = [];
  const devices = new Map<string, BucketDevice>();
  let skippedNoGame = 0;
  let unreadableFolders = 0;

  for (const folder of folders.values()) {
    const zips = folder.objects.filter((object) => object.file !== MAPPING_FILE);
    // Nada que recuperar en esta carpeta: todas sus versiones ya están en el
    // índice. Se sale ANTES de bajar el mapping.yaml para no gastar lecturas
    // en lo que ya sabemos.
    if (zips.every((object) => knownKeys.has(object.key))) continue;

    const game = gameBySaveKey.get(folder.saveKey);
    if (!game) {
      // El juego no está en la biblioteca: sus backups siguen ahí y se
      // recuperarán en cuanto se añada. No se inventa un juego a partir de
      // una carpeta — eso es decisión del usuario, no de una recuperación.
      skippedNoGame += zips.filter((object) => !knownKeys.has(object.key)).length;
      continue;
    }

    const prefix = saveFolderPrefix(folder.saveKey, folder.machineId);
    const raw = await r2.readText(`${prefix}${MAPPING_FILE}`);
    if (!raw) {
      unreadableFolders++;
      continue;
    }

    let mapping: BackupMapping | null = null;
    try {
      mapping = (parse(raw) as BackupMapping | null) ?? null;
    } catch {
      unreadableFolders++;
      continue;
    }

    const versions = listVersions(mapping);
    // El nombre de ludusavi sale del propio mapping.yaml (la app ya se fía de
    // ese campo en findGameBackupDir); si faltara, el del juego sirve igual.
    const ludusaviName = mapping?.name ?? game.saveLudusaviName;
    if (!ludusaviName) {
      unreadableFolders++;
      continue;
    }

    const manifest = manifests.get(folder.machineId);
    const sizeByName = new Map(zips.map((object) => [object.file, object.size]));

    for (const version of versions) {
      const key = `${prefix}${version.name}`;
      if (knownKeys.has(key)) continue;
      // En el mapping.yaml puede haber versiones cuyo zip ya no está en el
      // bucket (una poda a medias): una fila apuntando a un objeto que no
      // existe solo daría un error al restaurar.
      if (!sizeByName.has(version.name)) continue;

      if (!devices.has(folder.machineId)) {
        devices.set(folder.machineId, {
          deviceId: folder.machineId,
          name: manifest?.machineName ?? null,
          home: manifest?.home ?? (guessHome(version.files) || null),
        });
      }
      pending.push({
        gameId: game.id,
        r2Key: key,
        createdAt: version.when ? new Date(version.when) : null,
        // Tamaño REAL del objeto en el bucket, no el del mapping: es lo que
        // se está pagando.
        sizeBytes: sizeByName.get(version.name) ?? 0,
        ludusaviName,
        differential: version.differential,
        parentBackupName: version.differential ? version.chain[0] : null,
        locations: deriveLocations(version.files),
        hasRegistry: version.hasRegistry,
      });
      knownKeys.add(key);
    }
  }

  const written = recoverSaveBackups(appCtx(), {
    devices: [...devices.values()],
    backups: pending,
  });
  const recovered = written.recovered;
  skippedNoGame += written.skippedNoGame;

  // El índice conoce ahora versiones que esta máquina NO tiene en su carpeta
  // local: sin este suelo, el siguiente backup las daría por caducadas y las
  // borraría del bucket y del índice (ver pruneFloor en machine.ts).
  if (recovered > 0) setPruneFloor(new Date());

  return { recovered, skippedNoGame, unreadableFolders };
};

// Tirar por completo lo que haya subido una máquina: la vía para dejar de
// pagar por los backups de un PC que ya no existe, o por la carpeta que dejó
// atrás una reinstalación que no llegó a reclamarse.
//
// Se borra el bucket primero y el índice después, igual que en el resto del
// módulo: un fallo a medias deja como mucho una fila apuntando a algo que ya
// no está (visible y arreglable) y nunca un objeto huérfano pagando espacio
// sin que nada lo liste.
export const deleteMachineFromCloud = async (machineId: string): Promise<number> => {
  if (machineId === appCtx().deviceId) {
    throw new Error("That's this PC — deleting its folder would wipe your own backups.");
  }

  const objects = await r2.listKeys(SAVES_PREFIX);
  const doomed = objects.filter((object) => parseSaveObjectKey(object.key)?.deviceId === machineId);
  await r2.deleteKeys(doomed.map((object) => object.key));
  // Y su manifiesto: sin él la máquina deja de existir también para la
  // reconciliación de identidad.
  await r2.deleteKeys([r2.machineKey(machineId)]);

  // El índice después del bucket: lápida a todas sus copias (una de las
  // rutas de mantenimiento de R-13).
  deleteDeviceSaveBackups(appCtx(), machineId);

  return doomed.length;
};
