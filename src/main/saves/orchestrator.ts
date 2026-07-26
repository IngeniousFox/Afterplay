import { basename, join } from 'node:path';
import { existsSync, rmSync, statSync } from 'node:fs';
import type { SaveBackupRow } from '../db/schema';
import type { SaveGame } from '../db/queries/saves/getSaveGames';
import { createSaveBackup } from '../db/queries/saves/createSaveBackup';
import { deleteSaveBackups } from '../db/queries/saves/deleteSaveBackups';
import { getSaveBackups } from '../db/queries/saves/getSaveBackups';
import { isGameRunning } from '../watcher/runningGames';
import { isLudusaviAvailable } from './binary';
import type {
  RestoreMode,
  RestoreRequestInput,
  RestoreResult,
  SavesBackupResult,
  SavesGameState,
} from './contracts';
import { listVersions, readMapping, MAPPING_FILE, type BackupVersion } from './mapping';
import {
  getMachineHome,
  getMachineId,
  getMachineName,
  getSaveLocationOverride,
  setSaveLocationOverride,
} from './machine';
import { deriveLocations, expandPath, toSlashes } from './paths';
import * as r2 from './r2';
import {
  backupGame,
  clearRestoreWorkspace,
  createRestoreWorkspace,
  findGameBackupDir,
  listLocalVersions,
  sanitizeLudusaviFolder,
  previewGame,
  restoreGame,
} from './service';
import type { LudusaviCustomGame, LudusaviRedirect } from './types';

// Orquestación: ludusavi (local) + R2 (nube) + la tabla save_backups
// (índice). Aquí es donde se cumplen las reglas de PARTIDAS-GUARDADAS.md que
// no son de ninguna de las tres capas por separado.

// ── Modo manual: los juegos que el manifest no conoce ─────────────────────
// Se registran como customGames en cada invocación. Las rutas viven
// TOKENIZADAS en la BD (<winAppData>/...) y se expanden aquí, así que la
// misma fila vale en un PC donde el usuario se llame distinto.
export const buildCustomGames = (games: SaveGame[]): LudusaviCustomGame[] =>
  games
    .filter(
      (game) =>
        game.saveLudusaviName &&
        ((game.saveCustomPaths?.length ?? 0) > 0 || getSaveLocationOverride(game.id) !== null),
    )
    .map((game) => ({
      name: game.saveLudusaviName as string,
      // El destino de restauración de ESTA máquina también se LEE al hacer
      // backup ("una sola respuesta resuelve las dos direcciones", §10bis.5):
      // si el usuario dijo que aquí el juego vive en la D, la partida nueva
      // se escribe ahí, y un backup que solo mirase las rutas del manifest
      // subiría datos rancios de la ruta vieja.
      files: dedupePaths([
        ...(game.saveCustomPaths ?? []).map(expandPath),
        ...(getSaveLocationOverride(game.id) ? [getSaveLocationOverride(game.id)!.target] : []),
      ]),
      // Aquí está la diferencia entre añadir y pisar. Un juego que SÍ está en
      // el manifest (detección automática) se EXTIENDE: nuestra carpeta se
      // suma a las rutas y a las claves de registro que ludusavi ya conoce.
      // Sobrescribirlo dejaría el juego solo con la carpeta elegida y sin su
      // registro, que es justo lo que hace inservible la copia de los juegos
      // que guardan ajustes o partidas ahí.
      //
      // Uno que no está en el manifest se queda en 'override' (el defecto):
      // no hay nada que extender, y así un título que por casualidad coincida
      // con otro del manifest no arrastra rutas de un juego distinto.
      integration: game.saveDetectionSource === 'auto' ? 'extend' : 'override',
    }));

// Elegir dos veces la misma carpeta (o que el override coincida con una ya
// añadida) no debe respaldarla dos veces.
const dedupePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  return paths.filter((path) => {
    const key = toSlashes(path).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ── Espejo local -> R2 ────────────────────────────────────────────────────
// El bucket refleja la carpeta local del juego. Es idempotente por diseño:
// si una subida falló a medias, la siguiente la completa sin duplicar nada,
// y si la retención de ludusavi se llevó una versión en local, aquí se
// retira también de la nube y del índice.
const syncGameToR2 = async (game: SaveGame, ludusaviName: string): Promise<SaveBackupRow[]> => {
  // findGameBackupDir y no una join a pelo: la carpeta real lleva los
  // caracteres ilegales sustituidos por "_" (bug real con "Motor Town:
  // Behind The Wheel" — el zip se creaba y el espejo no lo encontraba).
  const dir = findGameBackupDir(ludusaviName);
  const versions = listVersions(readMapping(dir));
  const localNames = new Set(versions.map((version) => version.name));

  // Solo se toca la carpeta de ESTA máquina. Lo que hayan subido otros PCs
  // vive en su propio prefijo y aquí no se lee, ni se sube, ni se borra.
  const machineId = getMachineId();
  const prefix = r2.gamePrefix(game.igdbId, machineId);
  const remote = await r2.listKeys(prefix);
  const remoteNames = new Set(remote.map((object) => basename(object.key)));

  // 1. Subir los zips que falten.
  for (const version of versions) {
    if (remoteNames.has(version.name)) continue;
    const filePath = join(dir, version.name);
    if (!existsSync(filePath)) continue;
    await r2.uploadFile(`${prefix}${version.name}`, filePath);
  }

  // 2. El mapping.yaml se sube SIEMPRE: es el índice y cambia en cada
  // backup. Sin él, la carpeta materializada en otro PC es un montón de
  // zips que ludusavi no sabe interpretar.
  const mappingPath = join(dir, MAPPING_FILE);
  if (existsSync(mappingPath)) await r2.uploadFile(`${prefix}${MAPPING_FILE}`, mappingPath);

  // 3. Retirar de la nube lo que la retención local ya no conserva. Al estar
  // dentro del prefijo de esta máquina, "lo que ya no está en local" es una
  // afirmación cierta: nadie más escribe aquí.
  const staleKeys = remote
    .map((object) => object.key)
    .filter((key) => {
      const name = basename(key);
      return name !== MAPPING_FILE && !localNames.has(name);
    });
  await r2.deleteKeys(staleKeys);

  // 4. Reconciliar el índice con lo que ha quedado en el bucket. Se hace
  // DESPUÉS de tocar el bucket, y en ese orden a propósito: si algo falla a
  // medias, como mucho queda una fila apuntando a un objeto que ya no está
  // (visible y arreglable en la siguiente pasada) y nunca un objeto huérfano
  // ocupando espacio sin que nada lo liste.
  // Ojo con el filtro por machineId: la tabla SÍ sincroniza entre PCs, así
  // que aquí dentro hay también las versiones que subió el otro ordenador.
  // Sin ese filtro, el primer backup hecho en este PC daría por "caducadas"
  // todas las suyas —no están en nuestra carpeta local— y las borraría del
  // índice de los dos.
  const ownRows = (await getSaveBackups(game.id)).filter((row) => row.machineId === machineId);
  const staleRowIds = ownRows.filter((row) => !localNames.has(row.backupName)).map((row) => row.id);
  await deleteSaveBackups(staleRowIds);

  const knownNames = new Set(
    ownRows.filter((row) => localNames.has(row.backupName)).map((row) => row.backupName),
  );

  const created: SaveBackupRow[] = [];
  for (const version of versions) {
    if (knownNames.has(version.name)) continue;
    created.push(
      await createSaveBackup({
        gameId: game.id,
        createdAt: version.when ? new Date(version.when) : new Date(),
        backupName: version.name,
        r2Key: `${prefix}${version.name}`,
        sizeBytes: fileSize(join(dir, version.name)),
        ludusaviName,
        differential: version.differential,
        parentBackupName: version.differential ? version.chain[0] : null,
        machineId,
        machineName: getMachineName(),
        machineHome: getMachineHome(),
        locations: deriveLocations(version.files),
        hasRegistry: version.hasRegistry,
      }),
    );
  }
  return created;
};

const fileSize = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

export const backupGameToCloud = async (
  game: SaveGame,
  allGames: SaveGame[],
): Promise<SavesBackupResult | null> => {
  const ludusaviName = game.saveLudusaviName;
  if (!ludusaviName) return null;

  const result = await backupGame(ludusaviName, buildCustomGames(allGames));
  // Sin archivos no hay nada que subir. Pasa en dos situaciones MUY
  // distintas que hay que devolver distinguidas (ver foundFiles): un juego
  // detectado que todavía no ha generado partida, y una ruta que ya no
  // existe porque el juego se movió o se desinstaló.
  if (!result || (result.files.length === 0 && result.registryKeys.length === 0)) {
    return { uploaded: 0, ludusaviName, foundFiles: false };
  }

  const created = await syncGameToR2(game, ludusaviName);
  return { uploaded: created.length, ludusaviName, foundFiles: true };
};

// Todo lo que un juego tenga de partidas guardadas, fuera: los objetos de su
// prefijo en R2 y su carpeta local de backups. Se llama al BORRAR el juego.
//
// El índice (save_backups) no hace falta tocarlo: cuelga de games con ON
// DELETE CASCADE. Lo que no se limpiaba solo era justo lo de fuera de la base
// de datos, que es lo que ocupa espacio de verdad.
//
// Nunca lanza: si la nube no responde, el juego se borra igual. Como mucho
// quedan objetos huérfanos, que es exactamente lo que había antes.
export const purgeGameSaves = async (gameId: number): Promise<void> => {
  try {
    const rows = await getSaveBackups(gameId);
    if (rows.length === 0) return;

    // Se borra el prefijo de CADA máquina que haya subido algo, no solo el de
    // esta: el juego deja de existir para todas.
    const prefixes = new Set(rows.map((row) => r2.gamePrefix(igdbIdOf(row), row.machineId)));
    for (const prefix of prefixes) {
      const objects = await r2.listKeys(prefix);
      await r2.deleteKeys(objects.map((object) => object.key));
    }

    const localNames = new Set(rows.map((row) => row.ludusaviName));
    for (const name of localNames) {
      rmSync(findGameBackupDir(name), { recursive: true, force: true });
    }

    // Y el destino de restauración recordado en esta máquina: sin juego, un
    // override apuntando a su carpeta es basura en machine-saves.json.
    setSaveLocationOverride(gameId, null);
  } catch (error) {
    console.warn(`[saves] no se pudieron limpiar las partidas del juego ${gameId}:`, error);
  }
};

// El igdbId no está en la fila del backup, pero sí dentro de su clave de R2
// ("saves/<igdbId>/<machineId>/..."), que es justo lo que hay que reconstruir.
const igdbIdOf = (row: SaveBackupRow): number => Number(row.r2Key.split('/')[1]);

// ── Estado de la sección Saves de la ficha ────────────────────────────────
// Se calcula al ABRIR la sección y de dos fuentes baratas: la nube sale del
// índice ya sincronizado (cero red) y lo local de un --preview que no
// escribe nada. No hay comprobación de fondo ni al arrancar la app (§10bis.4).
export const getGameSavesState = async (
  game: SaveGame,
  allGames: SaveGame[],
): Promise<SavesGameState> => {
  const cloud = await getSaveBackups(game.id);
  const override = getSaveLocationOverride(game.id);

  let local: SavesGameState['local'] = null;
  if (game.saveLudusaviName && isLudusaviAvailable()) {
    try {
      const preview = await previewGame(game.saveLudusaviName, buildCustomGames(allGames));
      if (preview.game) {
        local = {
          files: preview.game.files.length,
          bytes: preview.game.totalBytes,
          registryKeys: preview.game.registryKeys,
          locations: deriveLocations(preview.game.files.map((file) => file.path)),
          steamIdInPath: preview.game.steamIdInPath,
          change: preview.change,
        };
      }
    } catch (error) {
      // Que no se pueda leer el estado local no debe romper la sección: la
      // parte de nube sigue siendo válida y accionable.
      console.warn('[saves] no se pudo leer el estado local del juego:', error);
    }
  }

  return {
    ludusaviName: game.saveLudusaviName,
    detectionSource: game.saveDetectionSource,
    enabled: game.saveBackupEnabled,
    customPaths: (game.saveCustomPaths ?? []).map(expandPath),
    local,
    cloud,
    restoreTarget: override?.target ?? null,
    running: isGameRunning(game.id),
  };
};

// ── Restauración ──────────────────────────────────────────────────────────
// NADA se restaura automáticamente, nunca (§10bis.0): todo lo de aquí abajo
// sale de un clic explícito en la ficha del juego.

// Nombre de carpeta legible para una ubicación dentro de la carpeta de
// exportación. Varias ubicaciones no pueden aterrizar todas en la raíz
// elegida o se mezclarían entre ellas.
const exportSubfolder = (location: string, used: Set<string>): string => {
  const base = basename(location) || 'saves';
  let name = base;
  let index = 2;
  while (used.has(name.toLowerCase())) name = `${base}-${index++}`;
  used.add(name.toLowerCase());
  return name;
};

export const buildRedirects = (
  row: SaveBackupRow,
  mode: RestoreMode,
  target: string | null,
  locations: string[],
): LudusaviRedirect[] => {
  const redirects: LudusaviRedirect[] = [];

  if (mode !== 'in-place' && target) {
    const normalizedTarget = toSlashes(target);
    if (mode === 'export') {
      const used = new Set<string>();
      for (const location of locations) {
        redirects.push({
          kind: 'restore',
          source: location,
          target: `${normalizedTarget}/${exportSubfolder(location, used)}`,
        });
      }
    } else if (locations.length === 1) {
      redirects.push({ kind: 'restore', source: locations[0], target: normalizedTarget });
    } else {
      // Con varias ubicaciones, "una carpeta" no basta: cada una necesita su
      // sitio o se mezclarían. Se reproduce su nombre bajo la carpeta
      // elegida — redirigir solo una dejaría la partida a medias (§4.9-3).
      const used = new Set<string>();
      for (const location of locations) {
        redirects.push({
          kind: 'restore',
          source: location,
          target: `${normalizedTarget}/${exportSubfolder(location, used)}`,
        });
      }
    }
  }

  // El redirect de nombre de usuario va SIEMPRE al final: cubre lo que no
  // haya redirigido una ubicación concreta. Se genera solo comparando el
  // home de la máquina que hizo el backup con el de esta (§8.2), sin que el
  // usuario configure nada.
  const currentHome = getMachineHome();
  if (row.machineHome && toSlashes(row.machineHome).toLowerCase() !== currentHome.toLowerCase()) {
    redirects.push({ kind: 'restore', source: toSlashes(row.machineHome), target: currentHome });
  }

  return redirects;
};

// Materializa desde R2 SOLO lo que hace falta para esa versión: su zip, el
// completo del que cuelga si es diferencial, y el mapping.yaml. Nada de
// descargar la biblioteca entera ni el histórico completo del juego.
const materializeBackup = async (
  igdbId: number,
  ludusaviName: string,
  // La máquina que HIZO el backup, que no tiene por qué ser esta: cada una
  // tiene su propio prefijo con su propio mapping.yaml, y el de la nuestra no
  // sabría nada de sus zips.
  machineId: string,
  version: { name: string; chain: string[] },
): Promise<string> => {
  const workspace = createRestoreWorkspace(ludusaviName);
  // Mismo saneado que la carpeta que creó el workspace: con ":" en el nombre
  // la join literal apuntaba a una ruta imposible en Windows.
  const gameDir = join(workspace, sanitizeLudusaviFolder(ludusaviName));
  const prefix = r2.gamePrefix(igdbId, machineId);

  await r2.downloadFile(`${prefix}${MAPPING_FILE}`, join(gameDir, MAPPING_FILE));
  for (const name of version.chain) {
    await r2.downloadFile(`${prefix}${name}`, join(gameDir, name));
  }
  return workspace;
};

export const runRestore = async (
  game: SaveGame,
  row: SaveBackupRow,
  request: RestoreRequestInput,
): Promise<Omit<RestoreResult, 'warnings'>> => {
  const ludusaviName = row.ludusaviName;
  const workspace = await materializeBackup(game.igdbId, ludusaviName, row.machineId, {
    name: row.backupName,
    chain: row.parentBackupName ? [row.parentBackupName, row.backupName] : [row.backupName],
  });

  try {
    // Las ubicaciones del índice pueden faltar en filas antiguas: el
    // mapping.yaml recién bajado es la fuente definitiva.
    const version = listLocalVersions(ludusaviName, workspace).find(
      (candidate) => candidate.name === row.backupName,
    );
    const locations = version ? deriveLocations(version.files) : (row.locations ?? []);

    const redirects = buildRedirects(row, request.mode, request.target ?? null, locations);
    // El registro no se puede redirigir a ninguna parte (§11.6): al exportar
    // se excluye —volcar una copia en una carpeta no es tocar HKCU— y en los
    // otros modos se escribe en su sitio real, que es lo correcto para que
    // la partida restaurada funcione.
    const skipRegistryKeys = request.mode === 'export' ? registryKeysOf(version) : [];

    const plan = await restoreGame({
      ludusaviName,
      restoreRoot: workspace,
      backupName: row.backupName,
      redirects,
      skipRegistryKeys,
      preview: request.preview,
    });

    return {
      ...plan,
      mode: request.mode,
      locations,
      registrySkipped: skipRegistryKeys.length > 0,
    };
  } finally {
    // Material de un solo uso: se limpia pase lo que pase, también si el
    // restore falló a mitad.
    clearRestoreWorkspace();
  }
};

// Qué claves silenciar para que un export no escriba en el registro. El
// mapping.yaml solo guarda el HASH del registro, no la lista de claves, así
// que en vez de adivinarlas se apagan las dos ramas enteras: los toggles de
// ludusavi heredan de padre a hijo ("settings on child paths override
// settings on parent paths"), y está VERIFICADO — con
// `toggledRegistry: { juego: { HKEY_CURRENT_USER: false } }` la clave salió
// marcada `ignored: true` y su valor, modificado a mano antes del restore,
// seguía intacto después.
const registryKeysOf = (version: BackupVersion | undefined): string[] =>
  version?.hasRegistry ? ['HKEY_CURRENT_USER', 'HKEY_LOCAL_MACHINE'] : [];
