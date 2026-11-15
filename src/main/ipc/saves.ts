import { app, ipcMain, shell } from 'electron';
import { handleDb } from './dbHandle';
import { appCtx } from '../db/v2/appDb';
import {
  addSaveFolder,
  clearSaveDetection,
  deletePlannedSaveBackups,
  getSaveBackup,
  getSaveBackupsUsage,
  getSaveGame,
  listSaveGames,
  pairDetectedSaveNameIfUnpaired,
  planSaveBackupDeletion,
  removeSaveFolder,
  setDetectedSaveName,
  setSaveBackupEnabled,
  setSaveRestoreTarget,
  type SaveGame,
} from '../db/v2/queries/saves';
import { getLudusaviLegalFiles, isLudusaviAvailable } from '../saves/binary';
import type {
  CloudInventory,
  DuplicateResolution,
  IdentityCheck,
  InstallIdentityStatus,
  RecoveryResult,
  RestoreRequestInput,
  RestoreResult,
  SavesBackupResult,
  SavesGameState,
  SavesQueuedEvent,
  SavesScanEntry,
  SavesStatus,
} from '../saves/contracts';
import { cleanLocalBackups, getLocalBackupsUsage } from '../saves/localUsage';
import {
  deleteMachineFromCloud,
  purgeSaveFolder,
  recoverIndexFromCloud,
  scanBucket,
} from '../saves/recovery';
import {
  adoptMachine,
  checkIdentity,
  checkLocalInstallIdentity,
  keepCurrentIdentity,
  needsIdentityCheck,
  resolveDuplicateKeepingThisPc,
  resolveDuplicateWithNewIdentity,
} from '../saves/identity';
import {
  backupGameToCloud,
  backupGameToCloudDetailed,
  buildCustomGames,
  getGameSavesState,
  runRestore,
} from '../saves/orchestrator';
import { extraSaveFiles, removeSaveFiles } from '../saves/exactRestore';
import {
  expandPath,
  forbiddenTargetReason,
  hasSteamIdPattern,
  tokenizePath,
  toSlashes,
} from '../saves/paths';
import { isR2Configured, deleteKeys } from '../saves/r2';
import { peekLudusaviQueueLabel } from '../saves/run';
import {
  clearAllRestoreWorkspaces,
  deleteLocalBackups,
  findLudusaviName,
  isDirectoryNonEmpty,
  previewGame,
  scanLibrary,
} from '../saves/service';
import { normalizeTitle } from '../lib/titleMatch';
import { isGameRunning } from '../watcher/runningGames';
import type { GameId, SaveBackupId } from '../../shared/entityIds';

// Partidas guardadas (PARTIDAS-GUARDADAS.md). Aquí viven las reglas que no
// son de ninguna capa por separado — sobre todo las de seguridad del
// restore, que es la operación destructiva de las dos.

export const registerSavesHandlers = (): void => {
  // Limpieza de arranque: si la app murió a mitad de una restauración, la
  // carpeta temporal con lo bajado de R2 se queda huérfana (el finally que
  // la borra nunca corrió). Es pequeña, pero es basura que nadie más va a
  // recoger — el propio flujo la recrea desde cero en cada restore.
  clearAllRestoreWorkspaces();

  ipcMain.handle('saves:getStatus', (): SavesStatus => {
    const binaryAvailable = isLudusaviAvailable();
    const r2Configured = isR2Configured();
    // Las dos puertas de §9.2: la sección se ENSEÑA siempre, pero
    // deshabilitada y con el motivo. Ocultarla dejaría al usuario sin
    // saber que la función existe.
    return { binaryAvailable, r2Configured, ready: binaryAvailable && r2Configured };
  });

  ipcMain.handle('saves:getLegalFiles', () => getLudusaviLegalFiles());

  // Espacio ocupado en R2, para Ajustes (API & Sync) — SUM local sobre
  // save_backups, cero llamadas al bucket (ver getSaveBackupsUsage).
  handleDb('saves:getUsage', async () => getSaveBackupsUsage(appCtx()));

  // Espacio ocupado en DISCO por save-backups/, y cuánto de eso es
  // prescindible (ya en R2, o huérfano) — ver saves/localUsage.ts.
  handleDb('saves:getLocalUsage', async () => getLocalBackupsUsage());
  handleDb('saves:cleanLocalBackups', async () => cleanLocalBackups());

  // ── Identidad de esta máquina frente al bucket (saves/identity.ts) ──
  // La puerta es local y GRATIS: solo compara el bucket configurado con el
  // que ya se reconcilió. Sin esto, mirar la nube en cada arranque gastaría
  // operaciones Clase A por nada y rompería §10bis.4 (nada de fondo).
  ipcMain.handle('saves:needsIdentityCheck', (): boolean => needsIdentityCheck());

  // Esta sí va a la red — solo desde un clic explícito en Ajustes.
  ipcMain.handle('saves:checkIdentity', async (): Promise<IdentityCheck | null> => checkIdentity());

  ipcMain.handle('saves:adoptMachine', async (_event, machineId: string) => {
    await adoptMachine(machineId);
  });

  ipcMain.handle('saves:keepIdentity', async () => {
    await keepCurrentIdentity();
  });

  // ── Id duplicado (§12.6, F-24) ──
  // Local y barato: compara el valor publicado en `devices` con el de esta
  // instalación. Ajustes lo pide al abrirse para avisar del bloqueo.
  handleDb('saves:getInstallIdentity', async (): Promise<InstallIdentityStatus> =>
    checkLocalInstallIdentity(),
  );

  // Siempre desde un clic explícito: es el usuario quien sabe cuál de los dos
  // PCs es el original. "new-identity" reinicia la app: la base se abre con el
  // id nuevo en el siguiente arranque.
  handleDb('saves:resolveDuplicate', async (_event, resolution: DuplicateResolution) => {
    if (resolution === 'keep-this-pc') {
      await resolveDuplicateKeepingThisPc();
      return;
    }
    if (resolution === 'new-identity') {
      resolveDuplicateWithNewIdentity();
      app.relaunch();
      app.quit();
      return;
    }
    throw new Error('Unknown resolution.');
  });

  // ── Inventario y recuperación (saves/recovery.ts) ──
  // Las tres van a la red y salen SIEMPRE de un clic explícito. Van por
  // handleDb porque cruzan el bucket con el índice y la biblioteca.
  handleDb('saves:scanBucket', async (): Promise<CloudInventory> => scanBucket());

  handleDb('saves:recoverFromCloud', async (): Promise<RecoveryResult> => {
    const result = await recoverIndexFromCloud();
    console.log(
      `[saves] recuperacion desde la nube: ${result.recovered} versiones recuperadas, ${result.skippedNoGame} sin juego en la biblioteca, ${result.unreadableFolders} carpetas ilegibles`,
    );
    return result;
  });

  // Limpiar a mano la carpeta del bucket de un juego que ya no está en la
  // biblioteca (§12.7): borrar un juego deja sus copias, y esta es la forma de
  // quitarlas. Se niega si algún juego vivo usa ese prefijo.
  handleDb('saves:purgeFolder', async (_event, saveKey: string): Promise<number> => {
    const deleted = await purgeSaveFolder(saveKey);
    console.log(`[saves] borrados ${deleted} objetos de la carpeta ${saveKey}`);
    return deleted;
  });

  handleDb('saves:deleteMachine', async (_event, machineId: string): Promise<number> => {
    const deleted = await deleteMachineFromCloud(machineId);
    console.log(`[saves] borrados ${deleted} objetos de la maquina ${machineId}`);
    return deleted;
  });

  ipcMain.handle('saves:openPath', async (_event, path: string) => {
    await shell.openPath(path);
  });

  // Escaneo completo: bajo demanda y con un botón, nunca al arrancar (§10.1).
  // Es una sola invocación que compara todo lo instalado contra el manifest.
  handleDb('saves:scanLibrary', async (): Promise<SavesScanEntry[]> => {
    const games = listSaveGames(appCtx());
    const scanned = await scanLibrary(buildCustomGames(games));

    // El emparejamiento se hace por el nombre que ya guardamos y, si no lo
    // hay, por título normalizado — la misma normalización que usa el resto
    // de la app para casar títulos.
    const byLudusaviName = new Map(
      games.filter((game) => game.saveLudusaviName).map((game) => [game.saveLudusaviName, game]),
    );
    const byTitle = new Map(games.map((game) => [normalizeTitle(game.title), game]));

    const results: SavesScanEntry[] = [];
    for (const entry of scanned) {
      const match =
        byLudusaviName.get(entry.ludusaviName) ?? byTitle.get(normalizeTitle(entry.ludusaviName));

      // El escaneo ES la detección: si ha casado con un juego que todavía no
      // tenía emparejamiento, se guarda aquí mismo. Obligar a pulsar
      // "Detect" juego por juego DESPUÉS de un escaneo global que ya sabe la
      // respuesta no tiene ningún sentido — y sin esto, un juego activado
      // desde esta pantalla quedaba marcado pero sin nombre de ludusavi, así
      // que su ficha seguía diciendo "no sé dónde guarda este juego".
      //
      // Guardar el nombre NO sube nada: subir exige `saveBackupEnabled`, que
      // sigue siendo una decisión aparte y explícita (§10.5).
      if (match && !match.saveLudusaviName) {
        pairDetectedSaveNameIfUnpaired(appCtx(), match.id, entry.ludusaviName);
      }

      results.push({
        ludusaviName: entry.ludusaviName,
        fileCount: entry.files.length,
        bytes: entry.totalBytes,
        registryKeys: entry.registryKeys,
        steamIdInPath: entry.steamIdInPath,
        gameId: match?.id ?? null,
        gameTitle: match?.title ?? null,
        enabled: match?.saveBackupEnabled ?? false,
      });
    }
    return results;
  });

  handleDb('saves:getGameState', async (event, gameId: GameId): Promise<SavesGameState | null> => {
    const games = listSaveGames(appCtx());
    const game = games.find((candidate) => candidate.id === gameId);
    if (!game) return null;

    // Leído JUSTO ANTES de pedir el estado (que encola su propio --preview):
    // lo que esté corriendo en este instante es, por construcción, SIEMPRE
    // una operación AJENA — la nuestra todavía no existe como tarea encolada,
    // así que nunca puede verse a sí misma aquí. Sin este orden (peek DESPUÉS
    // de encolar, o por sondeo desde el renderer) el label podía llegar a ser
    // el de la propia petición ya en marcha — "esperando detrás de mí mismo".
    const waitingBehind = peekLudusaviQueueLabel();
    if (waitingBehind) {
      const queuedEvent: SavesQueuedEvent = { gameId, label: waitingBehind };
      event.sender.send('saves:queued', queuedEvent);
    }

    return getGameSavesState(game, games);
  });

  // Activación por juego (§10.5). Nada se sube salvo que esté marcado: subir
  // partidas a un bucket es mover datos personales a un servicio externo, y
  // eso no se hace por defecto.
  //
  // `ludusaviName` llega desde los resultados del escaneo, y guardarlo ahí
  // NO es un extra: sin él, activar un juego desde Ajustes no servía de nada.
  // El juego quedaba marcado pero sin emparejar, así que la ficha seguía
  // diciendo "no sé dónde guarda este juego" y el backup automático se lo
  // saltaba (exige saveLudusaviName). Marcar algo tiene que dejarlo listo
  // para funcionar, no a medias.
  handleDb(
    'saves:setEnabled',
    async (_event, gameId: GameId, enabled: boolean, ludusaviName?: string) =>
      // Solo empareja si el juego no lo estaba: una carpeta elegida a mano
      // manda sobre lo que diga el manifest.
      setSaveBackupEnabled(appCtx(), gameId, enabled, ludusaviName),
  );

  // Detección automática: emparejar el título con el nombre que usa ludusavi.
  handleDb('saves:detect', async (_event, gameId: GameId): Promise<string | null> => {
    const game = getSaveGame(appCtx(), gameId);
    if (!game) return null;

    const ludusaviName = await findLudusaviName(game.title);
    if (!ludusaviName) return null;

    // En modo auto NO se guarda ninguna ruta detectada: ludusavi las resuelve
    // en cada máquina desde el manifest, y guardar la ya resuelta es justo el
    // error que crea el problema entre PCs (§7.1). Las carpetas que el
    // usuario haya añadido a mano SÍ se conservan: son suyas, no detectadas.
    return setDetectedSaveName(appCtx(), gameId, ludusaviName) ? ludusaviName : null;
  });

  // Deshacer un emparejado AUTOMÁTICO. Hacía falta y no existía: ludusavi
  // empareja por título normalizado contra un manifest enorme, y a veces casa
  // con el juego EQUIVOCADO (verificado en la biblioteca real: "Nuts",
  // "Nidhogg", "Spacewar" y "Stick Fight" salían como detectados sin estarlo
  // — PARTIDAS-GUARDADAS.md §4). Antes de esto no había ninguna forma de
  // quitarse ese emparejamiento de encima: las filas AUTO de FoldersBlock no
  // llevan botón de borrar (a diferencia de las tuyas, que sí — no tiene
  // sentido "borrar" una carpeta que ludusavi deriva sola en cada máquina, lo
  // que hay que poder borrar es la DECISIÓN de emparejar), y un match sin un
  // solo archivo local dejaba la tarjeta en la vista "Detected" vacía sin
  // camino de vuelta a "Detect automatically" / "Choose the folder myself".
  //
  // Solo toca el emparejamiento — NUNCA las carpetas propias (§10.3, "no son
  // dos modos excluyentes": conviven, y deshacer uno no debe llevarse el
  // otro) ni nada ya subido (el índice de save_backups sigue la partida por
  // gameId, no por ludusaviName — ver getSaveBackups). Solo tiene sentido
  // sobre un emparejamiento 'auto': uno 'manual' ya se deshace solo al
  // quitar su última carpeta (ver saves:removeFolder, unas líneas más abajo).
  handleDb('saves:clearDetection', async (_event, gameId: GameId): Promise<boolean> =>
    clearSaveDetection(appCtx(), gameId),
  );

  // Añadir una carpeta a mano (§10.3). Dos casos en la misma operación:
  //
  //  · El juego NO está en el manifest: la carpeta es lo único que hay, y se
  //    registra como juego propio de ludusavi con el título como nombre
  //    (estable entre PCs; el id no serviría, es local a esta base de datos).
  //  · El juego SÍ está en el manifest: la carpeta se SUMA a lo que ludusavi
  //    ya detecta —rutas y registro incluidos— gracias a `integration:
  //    extend` (ver buildCustomGames). El emparejamiento automático NO se
  //    toca: sustituirlo dejaría al juego sin su registro.
  //
  // La ruta se guarda tokenizada (<winAppData>/...) para que la misma fila
  // valga en un PC donde el usuario de Windows se llame distinto.
  handleDb('saves:addFolder', async (_event, gameId: GameId, folder: string) =>
    // Sin duplicados: elegir dos veces la misma carpeta la respaldaría dos
    // veces y solo serviría para inflar el zip.
    addSaveFolder(appCtx(), gameId, tokenizePath(folder)),
  );

  handleDb('saves:removeFolder', async (_event, gameId: GameId, folder: string) =>
    // Llega expandida (es la que se enseña), así que se compara expandiendo
    // las guardadas en vez de tokenizar la de entrada — así da igual si la
    // carpeta dejó de encajar con algún marcador desde que se guardó. Un juego
    // que SOLO existía por su carpeta vuelve a "sin detectar".
    removeSaveFolder(
      appCtx(),
      gameId,
      (stored) => expandPath(stored).toLowerCase() === toSlashes(folder).toLowerCase(),
    ),
  );

  handleDb('saves:backupNow', async (_event, gameId: GameId): Promise<SavesBackupResult | null> => {
    const games = listSaveGames(appCtx());
    const game = games.find((candidate) => candidate.id === gameId);
    if (!game) return null;
    return backupGameToCloud(game, games);
  });

  // ── Restaurar ───────────────────────────────────────────────────────────
  // NADA se restaura automáticamente, nunca (§10bis.0). Este handler solo se
  // llama desde un clic explícito en la sección Saves de la ficha.
  handleDb(
    'saves:restore',
    async (_event, request: RestoreRequestInput): Promise<RestoreResult> => {
      const games = listSaveGames(appCtx());
      const game = games.find((candidate) => candidate.id === request.gameId);
      if (!game) throw new Error('That game no longer exists.');

      // Regla 2 de §10bis.3, y se aplica TAMBIÉN al exportar: copiar archivos
      // que el juego está escribiendo da una copia rota, y una copia rota que
      // parece buena es peor que no tener ninguna.
      if (isGameRunning(game.id)) {
        throw new Error('The game is running right now. Close it before restoring.');
      }

      const row = getSaveBackup(appCtx(), request.backupId, game.id);
      if (!row) throw new Error("That version isn't in the cloud any more.");

      const target = request.target ? toSlashes(request.target) : null;
      if (request.mode !== 'in-place') {
        if (!target) throw new Error('Pick a destination folder first.');
        const forbidden = forbiddenTargetReason(target);
        if (forbidden) throw new Error(forbidden);
      }

      // Regla 1 de §10bis.3, la que convierte una operación destructiva en
      // reversible: ANTES de pisar la partida en curso, copia de lo que hay
      // ahora. Solo en 'in-place' — exportar y restaurar a otra ruta no
      // tocan la partida viva, y ahí un backup previo sería un peaje sin
      // motivo (§10bis.5). Si ludusavi revienta, el restore no sigue (la
      // excepción sale por este handler); y si termina sin copiar nada, se
      // aborta cuando ese "nada" no se puede interpretar — el porqué de esa
      // asimetría está en el bloque de abajo, es lo delicado de todo esto. Y
      // es barata: si la partida no cambió desde la última copia, ludusavi no
      // genera nada.
      //
      // Se hace SIEMPRE, incluso con "Cloud backup: OFF" para este juego —
      // apagarlo lo desactivaba de los disparadores normales (el botón, el
      // cierre de sesión), pero aquí es la única red de seguridad de una
      // operación destructiva, y saltársela dejaría el restore SIN vuelta
      // atrás para justo esos juegos. Lo que sí cambia es que se avisa: el
      // warning de más abajo (calculado también en el preview, así que se ve
      // ANTES de confirmar) dice explícitamente que esta subida rompe por
      // esta vez el "nada sale de este PC" — nunca en silencio.
      // Restauración exacta (§12.7, F-22): solo en su sitio, que es donde hay
      // copia previa que la deshaga.
      const exact = request.exact === true && request.mode === 'in-place';
      // Los archivos de partida que ludusavi ve AHORA: en la pasada real, los
      // que la copia previa acaba de guardar; en el preview, los del escaneo.
      // La restauración exacta solo puede borrar archivos de esta lista.
      let currentFiles: string[] = [];

      if (!request.preview && request.mode === 'in-place') {
        // El emparejamiento del JUEGO puede haber desaparecido desde que se
        // subió esta versión, y las versiones siguen ahí porque el índice
        // cuelga del gameId: "Reset detection" pone saveLudusaviName a null
        // (saves:clearDetection) y quitar la última carpeta de un emparejado
        // 'manual' hace lo mismo (saves:removeFolder). Con el nombre a null
        // backupGameToCloud se iba en su primera línea devolviendo null, ese
        // null no lo miraba nadie y el restore seguía adelante: ludusavi
        // pisaba la partida en disco usando row.ludusaviName mientras el
        // aviso de abajo prometía una copia que no existía. El índice SÍ
        // conserva el nombre, así que se tira de él — solo para esta copia y
        // solo en memoria: nada de re-emparejar por la puerta de atrás un
        // juego que el usuario desemparejó a propósito.
        const paired = Boolean(game.saveLudusaviName);
        const safetySource: SaveGame = paired
          ? game
          : {
              ...game,
              saveLudusaviName: row.ludusaviName,
              // 'auto' porque buildCustomGames lo traduce a `integration:
              // extend`. Con cualquier otro valor sale 'override', que
              // SUSTITUYE la entrada del manifest en vez de sumarse a ella: la
              // copia se dejaría fuera justo las rutas que el restore va a
              // pisar (el caso de clearDetection, que conserva las carpetas
              // propias pero no el nombre). Si el nombre no está en el
              // manifest no hay nada que extender y se comporta igual que
              // override; el precio es que un título que coincida por
              // casualidad con uno del manifest copiaría de más, y en una red
              // de seguridad ese es el lado bueno del error.
              saveDetectionSource: 'auto',
            };
        // Y la LISTA también parcheada, no solo el primer argumento: los
        // customGames que ludusavi va a recibir los construye buildCustomGames
        // recorriendo `allGames` (orchestrator.ts), así que pasándole la lista
        // sin tocar el juego reconstruido no llegaba a definirse. Con eso, un
        // emparejado 'manual' se respaldaba con un nombre que ludusavi no
        // conocía (cero archivos) y uno 'auto' perdía las carpetas añadidas a
        // mano, que son las que el restore SÍ va a sobrescribir.
        const safetyGames = paired
          ? games
          : games.map((candidate) => (candidate.id === game.id ? safetySource : candidate));
        const detailed = await backupGameToCloudDetailed(safetySource, safetyGames);
        const safety = detailed?.result ?? null;
        currentFiles = detailed?.files ?? [];

        // Y AQUÍ SE ABORTA SI NO HAY COPIA DE VERDAD. Mirar el null no sirve:
        // con el nombre del índice detrás ya no puede darse (ludusaviName es
        // notNull en save_backups), y sobre todo un resultado truthy no
        // significa que haya copia — `{ uploaded: 0, foundFiles: false }`
        // significa exactamente que ludusavi no encontró nada que copiar.
        //
        // Se aborta SOLO cuando la copia previa corrió A CIEGAS, y los dos
        // caminos que dejan el nombre a null NO son iguales en eso:
        //
        //  · saves:clearDetection ("Reset detection") borra el nombre pero
        //    CONSERVA las carpetas propias. La reconstrucción le devuelve a
        //    ludusavi exactamente lo que tendría el juego emparejado (nombre
        //    del índice + esas carpetas, en extend), así que mira las MISMAS
        //    rutas que el restore va a pisar: cero archivos es cero archivos,
        //    y ese es el caso normal de restaurar en un PC recién instalado —
        //    abortarlo sería bloquear justo para lo que existe la nube.
        //  · saves:removeFolder (quitar la última carpeta de un 'manual') se
        //    lleva las carpetas Y el nombre: no queda ni una ruta que darle, y
        //    un nombre 'manual' tampoco está en el manifest. Ahí "no encontró
        //    nada" no prueba que no haya nada, y se aborta.
        //
        // Con el juego bien emparejado nunca se aborta, por lo mismo que en
        // el primer punto: ludusavi miró donde el restore va a escribir.
        const safetyRanBlind = !paired && (game.saveCustomPaths?.length ?? 0) === 0;
        if (safetyRanBlind && safety?.foundFiles !== true) {
          throw new Error(
            "Afterplay doesn't know where this game's save lives any more, so it couldn't take a safety copy first — nothing was restored. Point it at the folder again from Saves, or restore into a folder you pick.",
          );
        }
      }

      if (request.preview && exact) {
        // Mismo juego reconstruido que usaría la copia previa (ver arriba), para
        // que el preview enseñe lo que de verdad se borraría.
        const name = game.saveLudusaviName ?? row.ludusaviName;
        const previewSource: SaveGame = game.saveLudusaviName
          ? game
          : { ...game, saveLudusaviName: name, saveDetectionSource: 'auto' };
        const previewGames = games.map((candidate) =>
          candidate.id === game.id ? previewSource : candidate,
        );
        const scanned = await previewGame(name, buildCustomGames(previewGames));
        currentFiles = scanned.game?.files.map((file) => file.path) ?? [];
      }

      const restored = await runRestore(row, { ...request, target: target ?? undefined });
      const extras = exact
        ? extraSaveFiles(
            currentFiles,
            restored.files.map((file) => file.target),
          )
        : [];
      const removal =
        exact && !request.preview ? removeSaveFiles(extras) : { removed: extras, failed: [] };
      const outcome = { ...restored, removedFiles: removal.removed };

      // Los avisos se calculan aquí y no en la UI: son consecuencia de lo que
      // ludusavi va a hacer de verdad, que es justo lo que acaba de devolver.
      const warnings: string[] = [];
      // Regla 4: aviso reforzado si el backup viene de otra máquina — la
      // fecha de "su" partida y la de la tuya no son comparables a ojo.
      if (row.machineId !== appCtx().deviceId) {
        warnings.push(
          `This backup was made on another PC (${row.machineName}) — make sure it's the save you expect before overwriting anything.`,
        );
      }
      if (request.mode !== 'in-place' && target && isDirectoryNonEmpty(target)) {
        warnings.push(
          'The destination folder already has files in it. Anything with a matching name gets overwritten — everything else is left alone.',
        );
      }
      if (exact) {
        warnings.push(
          outcome.removedFiles.length > 0
            ? `${request.preview ? 'Will also delete' : 'Also deleted'} ${outcome.removedFiles.length} save file(s) that this version doesn't have. They are in the safety copy taken first.`
            : "Exact restore: there are no extra save files to delete — the folder already matches this version's file list.",
        );
      }
      if (removal.failed.length > 0) {
        warnings.push(
          `${removal.failed.length} extra save file(s) couldn't be deleted (in use or protected): ${removal.failed.join(', ')}`,
        );
      }
      if (outcome.files.some((file) => hasSteamIdPattern(file.target))) {
        warnings.push(
          'This save has a Steam account ID inside its path: it only works on a PC signed into the same account.',
        );
      }
      if (outcome.registrySkipped) {
        warnings.push(
          "Part of this save lives in the Windows registry and is NOT included in the copy — a folder can't hold it.",
        );
      } else if (outcome.registryKeys.length > 0 && request.mode !== 'in-place') {
        warnings.push(
          "This save also touches the Windows registry, which can't be redirected: that part will be written to its real location.",
        );
      }
      if (request.mode === 'in-place') {
        // Los avisos se calculan igual en el preview y en la pasada real (una
        // sola rama), así que lo que se lee ANTES de confirmar es lo que va a
        // pasar. Por eso la promesa lleva su condición pegada en vez de
        // afirmar la copia a secas: cuando no se puede hacer, esto no se
        // restaura (ver el bloque de la copia previa, arriba).
        warnings.push(
          "This overwrites the save currently on disk. A backup of it is taken first, so you can undo this from the version list — and if that copy can't be made, nothing is restored.",
        );
        // Este juego tiene "Cloud backup: OFF" — pero la copia de seguridad
        // de arriba se hace de todas formas, porque sin ella este restore no
        // se podría deshacer. Se avisa a las claras de la excepción, en vez
        // de dejar que la partida actual suba a la nube sin que el mensaje
        // de la propia tarjeta ("nada sale de este PC") lo contradiga
        // calladamente.
        if (!game.saveBackupEnabled) {
          warnings.push(
            'Cloud backup is off for this game, but restoring still uploads one safety copy of your current save first — the only way to make this undoable.',
          );
        }
      }

      // Recordar el destino elegido, pero SOLO en el modo que es una decisión
      // sobre esta máquina. Exportar es de un solo uso y no deja rastro.
      if (!request.preview && request.mode === 'custom-path' && target) {
        setSaveRestoreTarget(appCtx(), game.id, target);
      }

      return { ...outcome, warnings };
    },
  );

  ipcMain.handle('saves:setRestoreTarget', (_event, gameId: GameId, target: string | null) => {
    setSaveRestoreTarget(appCtx(), gameId, target ? toSlashes(target) : null);
  });

  // Borrar una versión concreta: primero del bucket, luego del índice. En ese
  // orden a propósito — al revés, un fallo a medias dejaría un objeto
  // huérfano pagando espacio sin que nada lo liste.
  handleDb('saves:deleteBackup', async (_event, backupId: SaveBackupId, gameId: GameId) => {
    // Un completo del que cuelgan diferenciales no se puede borrar solo: se
    // llevaría por delante los que dependen de él (§9.1). Y "dependen de él"
    // incluye la máquina, no solo el nombre: cada máquina tiene su propio
    // prefijo en el bucket, así que un diferencial de otra nunca cuelga de un
    // completo de esta por mucho que el nombre coincida (y coincide de verdad
    // tras recuperar el índice y conservar la identidad actual). El plan lo
    // decide planSaveBackupDeletion.
    const plan = planSaveBackupDeletion(appCtx(), backupId, gameId);
    if (!plan) return false;
    const [row] = plan.doomed;
    const doomed = plan.doomed;

    await deleteKeys(doomed.map((candidate) => candidate.r2Key));
    // Una copia de otro PC es el borrado cruzado de R-13 (ruta de
    // mantenimiento); las propias van por la regla normal del dueño.
    deletePlannedSaveBackups(appCtx(), plan);

    // Y de la carpeta LOCAL, si la copia se hizo en este PC. Sin este paso
    // el borrado no servía de nada: el zip seguía en disco y el siguiente
    // backup lo volvía a subir al reconciliar el espejo, con un diferencial
    // nuevo colgado de él. Una versión borrada tiene que quedarse borrada.
    //
    // En su try/catch PROPIO: lo que de verdad importa (el objeto de R2 y su
    // fila) ya se borró arriba con éxito — si esta limpieza local revienta
    // (un antivirus con el zip agarrado, el indexador de Windows) no puede
    // deshacer eso ni mentir diciendo que el borrado entero falló cuando la
    // parte que importa ya está hecha. El zip huérfano que pueda quedar lo
    // recoge el barrido de save-backups/ de Ajustes (localUsage.ts) la
    // próxima vez que se limpie.
    if (plan.isOwn) {
      try {
        deleteLocalBackups(
          row.ludusaviName,
          doomed.map((candidate) => candidate.backupName),
        );
      } catch (error) {
        console.warn(`[saves] no se pudo limpiar la copia local de "${row.backupName}":`, error);
      }
    }
    return true;
  });
};
