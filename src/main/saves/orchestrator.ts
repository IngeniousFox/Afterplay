import { basename, join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { parse, stringify } from 'yaml';
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
import { ensureIdentityBeforeUpload } from './identity';
import {
  backupTimestamp,
  listVersions,
  readMapping,
  MAPPING_FILE,
  type BackupVersion,
} from './mapping';
import {
  getMachineHome,
  getMachineId,
  getMachineName,
  getPruneFloor,
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
import type {
  BackupMapping,
  LudusaviCustomGame,
  LudusaviRedirect,
  MappingBackupNode,
} from './types';

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

// La nube de partidas indexa por igdbId (saves/<igdbId>/<machineId>/), que es
// lo que hace que la misma partida se reconozca desde otro PC. Un juego que
// solo está en Steam todavía no tiene esa identidad portable.
//
// En la práctica no es un caso que se dé: por ahí entran juegos RECIÉN
// ANUNCIADOS —muchos ni han salido— así que no hay partidas que respaldar. Y
// en cuanto IGDB los mete (cualquiera de los tres refrescos lo detecta, ver
// external/adoptIgdb.ts) ganan su id y la nube funciona sola.
//
// Así que esto no es una función que haya que evitar, es la red por si acaso:
// un mensaje claro en vez de una clave de R2 con "null" dentro, que sería un
// destino imposible de encontrar después.
const requireIgdbId = (game: SaveGame): number => {
  if (game.igdbId === null) {
    throw new Error(
      `"${game.title}" todavía no está en IGDB, así que aún no tiene un identificador que compartir entre PCs. En cuanto aparezca allí (lo comprueba cualquier refresco) sus partidas podrán ir a la nube.`,
    );
  }
  return game.igdbId;
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
  const localMapping = readMapping(dir);
  const versions = listVersions(localMapping);
  const localNames = new Set(versions.map((version) => version.name));

  // Solo se toca la carpeta de ESTA máquina. Lo que hayan subido otros PCs
  // vive en su propio prefijo y aquí no se lee, ni se sube, ni se borra.
  const machineId = getMachineId();
  const prefix = r2.gamePrefix(requireIgdbId(game), machineId);
  const remote = await r2.listKeys(prefix);

  // Qué versiones caducaron. Se decide UNA vez y lo consultan tanto el
  // mapping.yaml que se sube como la poda del bucket: si los dos no cuentan la
  // misma historia, arriba quedan zips que ningún nodo describe (o nodos que
  // apuntan a zips borrados). El paso 4 aplica el mismo suelo a las filas del
  // índice, con su propio respaldo para las que no se pueden fechar por el
  // nombre.
  //
  // El suelo de poda (pruneFloor) protege lo anterior a esta instalación: al
  // reclamar la carpeta de una reinstalación previa, la carpeta LOCAL está
  // vacía, así que sin este filtro el primer backup daría por caducadas todas
  // las versiones que había en la nube y las borraría — justo lo que la
  // adopción existe para salvar. Un nombre que no sepamos fechar tampoco se
  // toca: ante la duda, no borrar.
  const floor = getPruneFloor();
  const isStale = (name: string): boolean => {
    if (name === MAPPING_FILE || localNames.has(name)) return false;
    if (!floor) return true;
    const when = backupTimestamp(name);
    return when !== null && when.getTime() >= floor.getTime();
  };

  // 1. Subir los zips que falten, anotando el tamaño REAL de todo lo que hay
  // arriba: el del listado si ya estaba, el de la subida si es nuevo. Esta es
  // la única lista de "qué está de verdad en el bucket" y de ella dependen
  // tanto el mapping.yaml fusionado como las filas del índice — una versión
  // cuyo zip no llegó a subirse (Defender lo puso en cuarentena, un borrado a
  // medias) no puede aparecer en ninguno de los dos.
  const bytesInBucket = new Map<string, number>(
    remote.map((object) => [basename(object.key), object.size]),
  );
  for (const version of versions) {
    if (bytesInBucket.has(version.name)) continue;
    const filePath = join(dir, version.name);
    if (!existsSync(filePath)) continue;
    bytesInBucket.set(version.name, await r2.uploadFile(`${prefix}${version.name}`, filePath));
  }
  const survives = (name: string): boolean => bytesInBucket.has(name) && !isStale(name);

  // 2. El mapping.yaml: el índice sin el cual la carpeta materializada en otro
  // PC es un montón de zips que ludusavi no sabe interpretar. Cambia en cada
  // backup, así que se reescribe en cada uno — pero NO a pelo cuando arriba
  // quedan versiones que la carpeta local ya no tiene (ver mergeRemoteMapping),
  // y hay un camino en el que directamente no se sube: si esa fusión no se
  // puede hacer, arriba se queda el mapping viejo. Eso último se anota, porque
  // decide si el paso 4 puede indexar (una versión sin su nodo allí arriba no
  // se puede restaurar).
  const rescuable = [...bytesInBucket.keys()].some(
    (name) => name !== MAPPING_FILE && !localNames.has(name) && !isStale(name),
  );
  let mappingDescribesLocal = true;
  const mappingPath = join(dir, MAPPING_FILE);
  if (!rescuable) {
    // El fichero local ya describe todo lo que va a quedar en el bucket, así
    // que se sube tal cual. Es el caso normal —un PC con su historia local
    // continua— y así el índice de allí arriba es byte a byte el que mantiene
    // ludusavi, sin pasar por una reserialización.
    if (existsSync(mappingPath)) await r2.uploadFile(`${prefix}${MAPPING_FILE}`, mappingPath);
  } else {
    const remoteMapping = parseMapping(await r2.readText(`${prefix}${MAPPING_FILE}`));
    if (!localMapping || !remoteMapping) {
      // Falta un lado que fusionar y arriba hay versiones que dependen de ese
      // fichero: subirlo a pelo las dejaría ilegibles para siempre. Un "no"
      // —de la red, o de un mapping.yaml que no se deja leer— no borra lo que
      // ya había; el siguiente backup del juego lo reintenta y hasta entonces
      // el índice remoto sigue siendo el bueno (le faltará, como mucho, la
      // versión recién subida).
      mappingDescribesLocal = false;
      console.warn(
        `[saves] no se pudo fusionar el mapping.yaml de ${prefix}: se deja el remoto para no dejar ilegibles las versiones antiguas`,
      );
    } else {
      await r2.uploadText(
        `${prefix}${MAPPING_FILE}`,
        stringify(mergeRemoteMapping(localMapping, remoteMapping, survives)),
      );
    }
  }

  // 3. Retirar de la nube lo que la retención local ya no conserva. Al estar
  // dentro del prefijo de esta máquina, "lo que ya no está en local" es una
  // afirmación cierta: nadie más escribe aquí.
  const staleKeys = remote.map((object) => object.key).filter((key) => isStale(basename(key)));
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
  // Y el mismo suelo de poda que arriba: si el objeto sigue en el bucket por
  // ser anterior a esta instalación, borrar su fila lo dejaría invisible
  // —imposible de restaurar y de borrar— que es el otro modo de perderlo.
  const ownRows = (await getSaveBackups(game.id)).filter((row) => row.machineId === machineId);
  const staleRowIds = ownRows
    .filter((row) => {
      if (localNames.has(row.backupName)) return false;
      if (!floor) return true;
      const when = backupTimestamp(row.backupName) ?? row.createdAt;
      return when.getTime() >= floor.getTime();
    })
    .map((row) => row.id);
  await deleteSaveBackups(staleRowIds);

  // Y no se indexa NADA si el mapping.yaml de allí arriba no describe estas
  // versiones (la fusión imposible del paso 2). El zip nuevo SÍ está subido y
  // cuenta en bytesInBucket, pero su nodo no: materializeBackup baja el
  // mapping viejo, listLocalVersions no encuentra la versión —se cae a
  // row.locations y a skipRegistryKeys vacío— y restoreGame acaba invocando a
  // ludusavi con un --backup que su índice no conoce. Es la misma fila
  // no-restaurable que impide el filtro de bytesInBucket de abajo, entrando
  // por el otro lado. Se cura sola en el primer backup que consiga fusionar:
  // ahí entran de golpe todas las versiones que sigan en la carpeta.
  if (!mappingDescribesLocal) return [];

  const knownNames = new Set(
    ownRows.filter((row) => localNames.has(row.backupName)).map((row) => row.backupName),
  );

  const created: SaveBackupRow[] = [];
  for (const version of versions) {
    if (knownNames.has(version.name)) continue;
    // Una fila SOLO si su objeto está de verdad en el bucket, la misma regla
    // que recoverIndexFromCloud aplica al reconstruir el índice desde la nube:
    // el paso 1 se salta los zips que no están en disco, y crear su fila
    // igualmente dejaba en la ficha una versión fantasma de "0 B",
    // indistinguible de las buenas, que solo daba un error crudo de R2 al
    // intentar restaurarla.
    //
    // Ojo: esto solo impide CREARLAS. Una fila anterior a esta regla cuyo zip
    // nunca llegó al bucket sigue viva —staleRowIds mira la carpeta local y el
    // suelo de poda, no el bucket— y a día de hoy no se limpia desde aquí a
    // propósito: un listado vacío por apuntar a otro bucket borraría el índice
    // entero de esta máquina, y ese índice viaja por Turso al otro PC.
    if (!bytesInBucket.has(version.name)) continue;
    created.push(
      await createSaveBackup({
        gameId: game.id,
        createdAt: version.when ? new Date(version.when) : new Date(),
        backupName: version.name,
        r2Key: `${prefix}${version.name}`,
        // El tamaño del OBJETO, no el del fichero local: es lo que se está
        // pagando, y una versión que ya solo existe arriba no tiene fichero
        // que medir (statSync fallaba y la fila salía con 0 bytes).
        sizeBytes: bytesInBucket.get(version.name) ?? 0,
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

const parseMapping = (raw: string | null): BackupMapping | null => {
  if (!raw) return null;
  try {
    return (parse(raw) as BackupMapping | null) ?? null;
  } catch {
    return null;
  }
};

// Orden cronológico, que es como ludusavi mantiene la lista: el completo más
// antiguo primero. Un nodo sin fecha se va al principio — es lo más viejo que
// puede ser, y así nunca desplaza a uno que sí sabemos fechar.
const sortByWhen = <T extends { when?: string }>(nodes: T[]): T[] =>
  [...nodes].sort((a, b) => (a.when ?? '').localeCompare(b.when ?? ''));

// El mapping.yaml remoto no se puede PISAR con el local: hay que fusionarlo.
//
// Cada prefijo de máquina tiene UN solo mapping.yaml y el espejo lo reescribe
// en cada backup, pero el suelo de poda decide sobre los zips y sobre las
// filas del índice, no sobre este fichero. Con el suelo puesto (una adopción
// tras reinstalar, o una recuperación del índice desde la nube) el bucket
// conserva versiones que la carpeta local ya no tiene: sus zips siguen arriba
// y sus filas siguen en save_backups, pero el primer backup nuevo las dejaba
// sin nodo aquí dentro y con eso ilegibles — materializeBackup baja este
// fichero y, sin el nodo, ludusavi no reconoce ese --backup. Se salvaban los
// bytes y se destruía el índice que los hace restaurables: justo los backups
// que la adopción existe para salvar.
//
// Así que manda el mapping local (es el que mantiene ludusavi y el que
// describe la carpeta real) y del remoto se rescatan los nodos de las
// versiones que sigan en el bucket. Un completo que ya no está se lleva sus
// diferenciales por delante, misma regla que removeBackupsFromMapping: sin él
// no se pueden restaurar de todas formas.
// `remote` es no-nulo a propósito (y no `BackupMapping | null`, que es lo que
// devuelve parseMapping): con null esta función devolvería `local` tal cual y
// el llamante subiría un mapping que borra los nodos remotos — el bug que
// existe para arreglar. Que lo impida el compilador y no la disciplina.
const mergeRemoteMapping = (
  local: BackupMapping,
  remote: BackupMapping,
  survives: (backupName: string) => boolean,
): BackupMapping => {
  const remoteFulls = remote.backups ?? [];
  if (remoteFulls.length === 0) return local;

  const localFulls = new Set((local.backups ?? []).map((full) => full.name));

  // Diferenciales que el completo local ya no lista pero el bucket conserva:
  // la retención de ludusavi puede llevarse un hijo dejando vivo a su padre.
  const merged: MappingBackupNode[] = (local.backups ?? []).map((full) => {
    const twin = remoteFulls.find((candidate) => candidate.name === full.name);
    if (!twin) return full;
    const known = new Set((full.children ?? []).map((child) => child.name));
    const rescued = (twin.children ?? []).filter(
      (child) => !known.has(child.name) && survives(child.name),
    );
    if (rescued.length === 0) return full;
    return { ...full, children: sortByWhen([...(full.children ?? []), ...rescued]) };
  });

  // Y los completos que ya solo existen en el bucket.
  for (const full of remoteFulls) {
    if (localFulls.has(full.name) || !survives(full.name)) continue;
    merged.push({
      ...full,
      children: sortByWhen((full.children ?? []).filter((child) => survives(child.name))),
    });
  }

  // Se reescribe el objeto entero del mapping LOCAL cambiando solo lo justo:
  // así las claves que no conocemos (lo que añadan futuras versiones de
  // ludusavi) sobreviven, igual que en removeBackupsFromMapping.
  //
  // `drives` es la excepción que sí hay que fusionar: dentro del zip las rutas
  // van por clave de unidad y es esa tabla la que las devuelve a su letra al
  // restaurar, así que rescatar un nodo sin la unidad que usa lo dejaría igual
  // de ilegible. Si la misma clave está en los dos manda la local, que es la
  // del fichero vivo.
  const drives = remote.drives ? { ...remote.drives, ...(local.drives ?? {}) } : local.drives;
  return { ...local, drives, backups: sortByWhen(merged) };
};

// Serializa las copias a la nube POR JUEGO. syncGameToR2 hace un
// lee-modifica-escribe sobre save_backups (getSaveBackups -> createSaveBackup)
// fuera de la cola de ludusavi de run.ts, y withDbAccess es un contador, no un
// mutex: dos copias del MISMO juego a la vez (el backup automático del cierre
// de sesión y un "Backup now" a mano) leían el mismo snapshot, ninguna veía la
// fila de la otra, y las dos insertaban el mismo backupName -> filas
// duplicadas en la lista de versiones y una colgando tras la siguiente poda.
// Juegos DISTINTOS siguen en paralelo: no comparten prefijo de R2 ni filas.
const gameBackupChains = new Map<number, Promise<unknown>>();

const serializeGameBackup = <T>(gameId: number, task: () => Promise<T>): Promise<T> => {
  const prev = gameBackupChains.get(gameId) ?? Promise.resolve();
  const result = prev.then(task, task);
  // La cadena nunca se rompe por un fallo (mismo callback en los dos brazos).
  const settled = result.catch(() => undefined);
  gameBackupChains.set(gameId, settled);
  // Limpia la entrada cuando esta era la última de su juego: si no, el Map
  // acumularía una entrada por cada juego respaldado en toda la sesión.
  void settled.then(() => {
    if (gameBackupChains.get(gameId) === settled) gameBackupChains.delete(gameId);
  });
  return result;
};

export const backupGameToCloud = async (
  game: SaveGame,
  allGames: SaveGame[],
): Promise<SavesBackupResult | null> => {
  const ludusaviName = game.saveLudusaviName;
  if (!ludusaviName) return null;

  return serializeGameBackup(game.id, async () => {
    const result = await backupGame(ludusaviName, buildCustomGames(allGames));
    // Sin archivos no hay nada que subir. Pasa en dos situaciones MUY
    // distintas que hay que devolver distinguidas (ver foundFiles): un juego
    // detectado que todavía no ha generado partida, y una ruta que ya no
    // existe porque el juego se movió o se desinstaló.
    if (!result || (result.files.length === 0 && result.registryKeys.length === 0)) {
      return { uploaded: 0, ludusaviName, foundFiles: false };
    }

    // ANTES de escribir nada en el bucket: si esta instalación nunca lo ha
    // mirado, esta es la última ventana en la que reclamar la carpeta de una
    // instalación anterior sale gratis — en cuanto subamos un objeto bajo el
    // id actual, cambiarlo dejaría ese objeto huérfano (ver identity.ts).
    await ensureIdentityBeforeUpload();

    const created = await syncGameToR2(game, ludusaviName);
    return { uploaded: created.length, ludusaviName, foundFiles: true };
  });
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
  const workspace = await materializeBackup(requireIgdbId(game), ludusaviName, row.machineId, {
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
    // Material de un solo uso: se limpia SU workspace pase lo que pase,
    // también si el restore falló a mitad. Solo el suyo — otra restauración
    // en paralelo tiene el propio y no debe tocarse.
    clearRestoreWorkspace(workspace);
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
