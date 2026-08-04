import { ipcMain, shell } from 'electron';
import { handleDb } from './dbHandle';
import { getSaveGames } from '../db/queries/saves/getSaveGames';
import { updateGame } from '../db/queries/games/updateGame';
import { getSaveBackups } from '../db/queries/saves/getSaveBackups';
import { deleteSaveBackups } from '../db/queries/saves/deleteSaveBackups';
import { getSaveBackupsUsage } from '../db/queries/saves/getSaveBackupsUsage';
import { getLudusaviLegalFiles, isLudusaviAvailable } from '../saves/binary';
import type {
  CloudInventory,
  IdentityCheck,
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
import { deleteMachineFromCloud, recoverIndexFromCloud, scanBucket } from '../saves/recovery';
import {
  adoptMachine,
  checkIdentity,
  keepCurrentIdentity,
  needsIdentityCheck,
} from '../saves/identity';
import { getMachineId, setSaveLocationOverride } from '../saves/machine';
import {
  backupGameToCloud,
  buildCustomGames,
  getGameSavesState,
  runRestore,
} from '../saves/orchestrator';
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
  scanLibrary,
} from '../saves/service';
import { normalizeTitle } from '../lib/titleMatch';
import { isGameRunning } from '../watcher/runningGames';

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
  handleDb('saves:getUsage', async () => getSaveBackupsUsage());

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
    const games = await getSaveGames();
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
        await updateGame(match.id, {
          saveLudusaviName: entry.ludusaviName,
          saveDetectionSource: 'auto',
        });
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

  handleDb('saves:getGameState', async (event, gameId: number): Promise<SavesGameState | null> => {
    const games = await getSaveGames();
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
    async (_event, gameId: number, enabled: boolean, ludusaviName?: string) => {
      const games = await getSaveGames();
      const game = games.find((candidate) => candidate.id === gameId);

      // Solo se rellena si el juego no tenía emparejamiento. Uno con carpeta
      // elegida a mano manda sobre lo que diga el manifest: para eso se
      // molestó el usuario en elegirla.
      const pairing =
        ludusaviName && !game?.saveLudusaviName
          ? { saveLudusaviName: ludusaviName, saveDetectionSource: 'auto' as const }
          : {};

      await updateGame(gameId, { saveBackupEnabled: enabled, ...pairing });
      return true;
    },
  );

  // Detección automática: emparejar el título con el nombre que usa ludusavi.
  handleDb('saves:detect', async (_event, gameId: number): Promise<string | null> => {
    const games = await getSaveGames();
    const game = games.find((candidate) => candidate.id === gameId);
    if (!game) return null;

    const ludusaviName = await findLudusaviName(game.title);
    if (!ludusaviName) return null;

    // En modo auto NO se guarda ninguna ruta detectada: ludusavi las resuelve
    // en cada máquina desde el manifest, y guardar la ya resuelta es justo el
    // error que crea el problema entre PCs (§7.1). Las carpetas que el
    // usuario haya añadido a mano SÍ se conservan: son suyas, no detectadas.
    await updateGame(gameId, { saveLudusaviName: ludusaviName, saveDetectionSource: 'auto' });
    return ludusaviName;
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
  handleDb('saves:clearDetection', async (_event, gameId: number): Promise<boolean> => {
    const games = await getSaveGames();
    const game = games.find((candidate) => candidate.id === gameId);
    if (!game || game.saveDetectionSource !== 'auto') return false;

    await updateGame(gameId, { saveLudusaviName: null, saveDetectionSource: null });
    return true;
  });

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
  handleDb('saves:addFolder', async (_event, gameId: number, folder: string) => {
    const games = await getSaveGames();
    const game = games.find((candidate) => candidate.id === gameId);
    if (!game) return null;

    const tokenized = tokenizePath(folder);
    const current = game.saveCustomPaths ?? [];
    // Sin duplicados: elegir dos veces la misma carpeta la respaldaría dos
    // veces y solo serviría para inflar el zip.
    const next = current.includes(tokenized) ? current : [...current, tokenized];

    await updateGame(gameId, {
      saveCustomPaths: next,
      ...(game.saveLudusaviName
        ? {}
        : { saveLudusaviName: game.title, saveDetectionSource: 'manual' as const }),
    });
    return game.saveLudusaviName ?? game.title;
  });

  handleDb('saves:removeFolder', async (_event, gameId: number, folder: string) => {
    const games = await getSaveGames();
    const game = games.find((candidate) => candidate.id === gameId);
    if (!game) return false;

    // Llega expandida (es la que se enseña), así que se compara expandiendo
    // las guardadas en vez de tokenizar la de entrada — así da igual si la
    // carpeta dejó de encajar con algún marcador desde que se guardó.
    const next = (game.saveCustomPaths ?? []).filter(
      (candidate) => expandPath(candidate).toLowerCase() !== toSlashes(folder).toLowerCase(),
    );

    await updateGame(gameId, {
      saveCustomPaths: next.length > 0 ? next : null,
      // Un juego que SOLO existía por su carpeta se queda sin nada que
      // respaldar: se devuelve a "sin detectar" en vez de dejar un
      // emparejamiento que ya no apunta a ningún sitio.
      ...(next.length === 0 && game.saveDetectionSource === 'manual'
        ? { saveLudusaviName: null, saveDetectionSource: null }
        : {}),
    });
    return true;
  });

  handleDb('saves:backupNow', async (_event, gameId: number): Promise<SavesBackupResult | null> => {
    const games = await getSaveGames();
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
      const games = await getSaveGames();
      const game = games.find((candidate) => candidate.id === request.gameId);
      if (!game) throw new Error('That game no longer exists.');

      // Regla 2 de §10bis.3, y se aplica TAMBIÉN al exportar: copiar archivos
      // que el juego está escribiendo da una copia rota, y una copia rota que
      // parece buena es peor que no tener ninguna.
      if (isGameRunning(game.id)) {
        throw new Error('The game is running right now. Close it before restoring.');
      }

      const rows = await getSaveBackups(game.id);
      const row = rows.find((candidate) => candidate.id === request.backupId);
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
      // motivo (§10bis.5). Si esta copia falla, el restore NO sigue: mejor
      // no restaurar que restaurar sin salida de emergencia. Y es barata: si
      // la partida no cambió desde la última copia, ludusavi no genera nada.
      //
      // Se hace SIEMPRE, incluso con "Cloud backup: OFF" para este juego —
      // apagarlo lo desactivaba de los disparadores normales (el botón, el
      // cierre de sesión), pero aquí es la única red de seguridad de una
      // operación destructiva, y saltársela dejaría el restore SIN vuelta
      // atrás para justo esos juegos. Lo que sí cambia es que se avisa: el
      // warning de más abajo (calculado también en el preview, así que se ve
      // ANTES de confirmar) dice explícitamente que esta subida rompe por
      // esta vez el "nada sale de este PC" — nunca en silencio.
      if (!request.preview && request.mode === 'in-place') {
        await backupGameToCloud(game, games);
      }

      const outcome = await runRestore(game, row, { ...request, target: target ?? undefined });

      // Los avisos se calculan aquí y no en la UI: son consecuencia de lo que
      // ludusavi va a hacer de verdad, que es justo lo que acaba de devolver.
      const warnings: string[] = [];
      // Regla 4: aviso reforzado si el backup viene de otra máquina — la
      // fecha de "su" partida y la de la tuya no son comparables a ojo.
      if (row.machineId !== getMachineId()) {
        warnings.push(
          `This backup was made on another PC (${row.machineName}) — make sure it's the save you expect before overwriting anything.`,
        );
      }
      if (request.mode !== 'in-place' && target && isDirectoryNonEmpty(target)) {
        warnings.push(
          'The destination folder already has files in it. Anything with a matching name gets overwritten — everything else is left alone.',
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
        warnings.push(
          'This overwrites the save currently on disk. A backup of it is taken first, so you can undo this from the version list.',
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
        setSaveLocationOverride(game.id, target);
      }

      return { ...outcome, warnings };
    },
  );

  ipcMain.handle('saves:setRestoreTarget', (_event, gameId: number, target: string | null) => {
    setSaveLocationOverride(gameId, target ? toSlashes(target) : null);
  });

  // Borrar una versión concreta: primero del bucket, luego del índice. En ese
  // orden a propósito — al revés, un fallo a medias dejaría un objeto
  // huérfano pagando espacio sin que nada lo liste.
  handleDb('saves:deleteBackup', async (_event, backupId: number, gameId: number) => {
    const rows = await getSaveBackups(gameId);
    const row = rows.find((candidate) => candidate.id === backupId);
    if (!row) return false;

    // Un completo del que cuelgan diferenciales no se puede borrar solo: se
    // llevaría por delante los que dependen de él (§9.1).
    const dependents = rows.filter((candidate) => candidate.parentBackupName === row.backupName);
    const doomed = [row, ...dependents];

    await deleteKeys(doomed.map((candidate) => candidate.r2Key));
    await deleteSaveBackups(doomed.map((candidate) => candidate.id));

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
    if (row.machineId === getMachineId()) {
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
