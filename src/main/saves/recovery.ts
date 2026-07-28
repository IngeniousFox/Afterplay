import { parse } from 'yaml';
import { createSaveBackup } from '../db/queries/saves/createSaveBackup';
import { deleteSaveBackups } from '../db/queries/saves/deleteSaveBackups';
import { getSaveBackups } from '../db/queries/saves/getSaveBackups';
import { getSaveGames } from '../db/queries/saves/getSaveGames';
import type { CloudFolder, CloudInventory, RecoveryResult } from './contracts';
import type { MachineManifest } from './identity';
import { getMachineId, setPruneFloor } from './machine';
import { listVersions, MAPPING_FILE } from './mapping';
import { deriveLocations } from './paths';
import * as r2 from './r2';
import type { BackupMapping } from './types';

// Recuperación del índice a partir del bucket (PARTIDAS-GUARDADAS.md §9).
//
// El índice save_backups es lo ÚNICO que hace restaurable un backup: sin su
// fila, el zip está ahí arriba pagándose y la app no puede ni verlo ni
// borrarlo. Y ese índice viaja por Turso, así que una reinstalación sin sync
// configurado lo pierde entero.
//
// Esto lo reconstruye leyendo el bucket, que sabe explicarse solo:
//   · la clave da el igdbId y el machineId  (saves/<igdbId>/<machineId>/…)
//   · el mapping.yaml da el nombre de ludusavi, las versiones, sus fechas,
//     de qué completo cuelga cada diferencial, sus ficheros y el registro
//   · machines/<id>.json da el nombre del PC y su %USERPROFILE%
//   · el propio listado da los tamaños reales, sin descargar nada

const SAVES_PREFIX = 'saves/';

type ParsedKey = { igdbId: number; machineId: string; file: string };

// saves/<igdbId>/<machineId>/<fichero> — cualquier otra forma se ignora en
// vez de adivinar: el bucket puede tener cosas que no ha puesto Afterplay.
const parseKey = (key: string): ParsedKey | null => {
  const parts = key.split('/');
  if (parts.length !== 4 || parts[0] !== 'saves') return null;
  const igdbId = Number(parts[1]);
  if (!Number.isInteger(igdbId) || igdbId <= 0) return null;
  if (!parts[2] || !parts[3]) return null;
  return { igdbId, machineId: parts[2], file: parts[3] };
};

type FolderObjects = { key: string; size: number; file: string };

const groupByFolder = (
  objects: { key: string; size: number }[],
): Map<string, { igdbId: number; machineId: string; objects: FolderObjects[] }> => {
  const folders = new Map<
    string,
    { igdbId: number; machineId: string; objects: FolderObjects[] }
  >();
  for (const object of objects) {
    const parsed = parseKey(object.key);
    if (!parsed) continue;
    const id = `${parsed.igdbId}/${parsed.machineId}`;
    const entry = folders.get(id) ?? {
      igdbId: parsed.igdbId,
      machineId: parsed.machineId,
      objects: [],
    };
    entry.objects.push({ key: object.key, size: object.size, file: parsed.file });
    folders.set(id, entry);
  }
  return folders;
};

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
  const games = await getSaveGames();
  const gameByIgdbId = new Map(games.map((game) => [game.igdbId, game]));
  const currentMachineId = getMachineId();

  // Las claves que el índice ya conoce, de TODOS los juegos — es lo que
  // distingue "esto ya se puede restaurar" de "esto está huérfano".
  const knownKeys = new Set<string>();
  for (const game of games) {
    for (const row of await getSaveBackups(game.id)) knownKeys.add(row.r2Key);
  }

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

    const game = gameByIgdbId.get(folder.igdbId);
    result.push({
      igdbId: folder.igdbId,
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
  const games = await getSaveGames();
  const gameByIgdbId = new Map(games.map((game) => [game.igdbId, game]));

  const knownKeys = new Set<string>();
  for (const game of games) {
    for (const row of await getSaveBackups(game.id)) knownKeys.add(row.r2Key);
  }

  let recovered = 0;
  let skippedNoGame = 0;
  let unreadableFolders = 0;

  for (const folder of folders.values()) {
    const zips = folder.objects.filter((object) => object.file !== MAPPING_FILE);
    // Nada que recuperar en esta carpeta: todas sus versiones ya están en el
    // índice. Se sale ANTES de bajar el mapping.yaml para no gastar lecturas
    // en lo que ya sabemos.
    if (zips.every((object) => knownKeys.has(object.key))) continue;

    const game = gameByIgdbId.get(folder.igdbId);
    if (!game) {
      // El juego no está en la biblioteca: sus backups siguen ahí y se
      // recuperarán en cuanto se añada. No se inventa un juego a partir de
      // un igdbId — eso es decisión del usuario, no de una recuperación.
      skippedNoGame += zips.filter((object) => !knownKeys.has(object.key)).length;
      continue;
    }

    const prefix = r2.gamePrefix(folder.igdbId, folder.machineId);
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

      await createSaveBackup({
        gameId: game.id,
        createdAt: version.when ? new Date(version.when) : new Date(),
        backupName: version.name,
        r2Key: key,
        // Tamaño REAL del objeto en el bucket, no el del mapping: es lo que
        // se está pagando.
        sizeBytes: sizeByName.get(version.name) ?? 0,
        ludusaviName,
        differential: version.differential,
        parentBackupName: version.differential ? version.chain[0] : null,
        machineId: folder.machineId,
        machineName: manifest?.machineName ?? 'Unknown PC',
        machineHome: manifest?.home ?? guessHome(version.files),
        locations: deriveLocations(version.files),
        hasRegistry: version.hasRegistry,
      });
      knownKeys.add(key);
      recovered++;
    }
  }

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
  if (machineId === getMachineId()) {
    throw new Error("That's this PC — deleting its folder would wipe your own backups.");
  }

  const objects = await r2.listKeys(SAVES_PREFIX);
  const doomed = objects.filter((object) => parseKey(object.key)?.machineId === machineId);
  await r2.deleteKeys(doomed.map((object) => object.key));
  // Y su manifiesto: sin él la máquina deja de existir también para la
  // reconciliación de identidad.
  await r2.deleteKeys([r2.machineKey(machineId)]);

  const games = await getSaveGames();
  const doomedRowIds: number[] = [];
  for (const game of games) {
    for (const row of await getSaveBackups(game.id)) {
      if (row.machineId === machineId) doomedRowIds.push(row.id);
    }
  }
  await deleteSaveBackups(doomedRowIds);

  return doomed.length;
};
