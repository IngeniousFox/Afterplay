import { app, ipcMain } from 'electron';
import {
  exportCredentialsTo,
  getCredentials,
  importCredentialsFromFile,
  setCredentials,
  takeStartupKeysImport,
} from '../config/credentials';
import { getConfigValue, setConfigValue } from '../config/store';
import { getDb, getLastSyncFailure, runSyncCycle, withDbAccess } from '../db';
import { saveBackupsTable } from '../db/schema';
import { invalidateToken } from '../igdb/auth';
import { HIDDEN_LAUNCH_ARG } from '../lib/loginItem';
import { isE2E } from '../lib/e2e';
import { openPathResult } from '../lib/openPath';
import { getOverlayShortcutStatus, refreshOverlaySettings } from '../overlay';
import { beginStorageMigration, resetR2Client } from '../saves/r2';
import { migrateStorageObjects } from '../saves/migrateStorage';
import { verifyMigratedRestore } from '../saves/verifyStorageRestore';
import { storageTargetFrom, destinationChanged } from '../saves/storageConfig';
import { markIdentityReconciled } from '../saves/machine';
import { resetSgdbClient } from '../sgdb/client';
import type { CredentialsValues, SaveStorageProvider, TimeFormat } from '../../shared/types';

// SPEC 3E — "iniciar con Windows" como opción activable desde el modal de
// ajustes, no forzada al primer arranque. app.setLoginItemSettings es la API
// nativa de Electron: persiste a nivel de sistema operativo (registro de
// Windows), no en la DB de la app.
//
// En Windows se registra con el argumento marcador (HIDDEN_LAUNCH_ARG) para
// que loginItem.ts pueda reconocer luego "esto lo arrancó Windows solo" en
// process.argv — ver ese archivo para el porqué. getLoginItemSettings()
// tiene que consultarse con los MISMOS args que se usaron al registrar, o
// `openAtLogin` viene mal (así lo dice la propia documentación de Electron).
const loginItemQueryOptions =
  process.platform === 'win32' ? { args: [HIDDEN_LAUNCH_ARG] } : undefined;

// Lo que hay que despertar cada vez que CAMBIAN las credenciales, vengan de
// teclearlas o de importar un fichero: los clientes cacheados capturaron la
// clave vieja al construirse y seguirían usándola hasta reiniciar la app.
const applyCredentialsChange = (): void => {
  invalidateToken();
  resetSgdbClient();
  // Lo mismo con el cliente de R2: se construyó con las claves viejas y
  // seguiría firmando con ellas (PARTIDAS-GUARDADAS.md §9).
  resetR2Client();
  // Si acaban de aparecer credenciales de Turso, esto enciende el sync ya
  // mismo (attemptSyncUpgrade relee process.env) en vez de esperar al
  // siguiente ciclo de 60s. Fire-and-forget: nunca lanza.
  void runSyncCycle();
};

const hasIndexedBackups = async (): Promise<boolean> =>
  withDbAccess(async () => {
    const rows = await getDb().select({ id: saveBackupsTable.id }).from(saveBackupsTable).limit(1);
    return rows.length > 0;
  });

export const registerSettingsHandlers = (): void => {
  ipcMain.handle(
    'settings:getOpenAtLogin',
    () => app.getLoginItemSettings(loginItemQueryOptions).openAtLogin,
  );

  ipcMain.handle('settings:setOpenAtLogin', (_event, enabled: boolean) => {
    // Lo ÚNICO de la app que escribe fuera de la carpeta de datos (el
    // registro de Windows), así que es lo único que el sandbox de e2e.ts no
    // puede aislar por sí solo: aquí se corta. Un test puede pulsar el
    // interruptor y comprobar la UI; el sistema operativo no se entera.
    if (isE2E()) return;
    app.setLoginItemSettings(
      process.platform === 'win32'
        ? { openAtLogin: enabled, args: enabled ? [HIDDEN_LAUNCH_ARG] : [] }
        : { openAtLogin: enabled },
    );
  });

  // Formato de hora (12h/24h) — preferencia de la app, no del sistema
  // operativo: se persiste en config/store.ts, no en el registro.
  ipcMain.handle('settings:getTimeFormat', () => getConfigValue('timeFormat'));

  ipcMain.handle('settings:setTimeFormat', (_event, format: TimeFormat) => {
    setConfigValue('timeFormat', format);
  });

  // Modo ambiente: minutos sin tocar la app antes de que entre, 0 = apagado.
  ipcMain.handle('settings:getAmbientIdleMinutes', () => getConfigValue('ambientIdleMinutes'));

  ipcMain.handle('settings:setAmbientIdleMinutes', (_event, minutes: number) => {
    setConfigValue('ambientIdleMinutes', minutes);
  });

  // Overlay in-game (OVERLAY.md §12): toggle maestro + atajo. Los setters
  // avisan al módulo del overlay para que registre/suelte el atajo EN
  // CALIENTE — con un juego corriendo, cambiar el ajuste debe notarse ya,
  // no en la próxima sesión.
  ipcMain.handle('settings:getOverlayEnabled', () => getConfigValue('overlayEnabled'));

  ipcMain.handle('settings:setOverlayEnabled', (_event, enabled: boolean) => {
    setConfigValue('overlayEnabled', enabled);
    refreshOverlaySettings();
  });

  ipcMain.handle('settings:getOverlayShortcut', () => getConfigValue('overlayShortcut'));

  ipcMain.handle('settings:setOverlayShortcut', (_event, accelerator: string) => {
    if (accelerator.trim() !== '') setConfigValue('overlayShortcut', accelerator.trim());
    refreshOverlaySettings();
  });

  ipcMain.handle('settings:getOverlayShortcutStatus', () => getOverlayShortcutStatus());

  // Cadencia y retención de la copia local automática (db/dailyBackup.ts).
  // Sin efecto en caliente que avisar: la próxima comprobación es en el
  // próximo arranque, no hay temporizador de fondo que despertar aquí.
  ipcMain.handle('settings:getBackupIntervalHours', () => getConfigValue('backupIntervalHours'));

  ipcMain.handle('settings:setBackupIntervalHours', (_event, hours: number) => {
    setConfigValue('backupIntervalHours', Math.max(1, Math.round(hours)));
  });

  ipcMain.handle('settings:getBackupCount', () => getConfigValue('backupCount'));

  ipcMain.handle('settings:setBackupCount', (_event, count: number) => {
    setConfigValue('backupCount', Math.max(0, Math.round(count)));
  });

  // Estado del sync con Turso — para que un fallo persistente (sobre todo un
  // desajuste de esquema, que NO se cura reintentando) se vea en Ajustes en
  // vez de morir en la consola.
  ipcMain.handle('settings:getSyncFailure', () => getLastSyncFailure());

  // Credenciales de servicios externos (ver config/credentials.ts). Los
  // valores viajan al renderer para poder editarlos en Ajustes — app
  // personal, preload propio, sin contenido remoto: mismo perímetro de
  // confianza que el .env que sustituyen.
  ipcMain.handle('settings:getCredentials', () => getCredentials());

  ipcMain.handle('settings:getSaveStorageProvider', () => getConfigValue('saveStorageProvider'));

  ipcMain.handle(
    'settings:setCredentials',
    async (event, input: CredentialsValues, requestedProvider?: SaveStorageProvider) => {
      const currentProvider = getConfigValue('saveStorageProvider');
      const provider = requestedProvider ?? currentProvider;
      if (provider !== 'cloudflare' && provider !== 's3') {
        throw new Error('Unknown cloud save provider.');
      }
      const currentCredentials = getCredentials();
      let source;
      try {
        source = storageTargetFrom(currentProvider, currentCredentials);
      } catch {
        // Un endpoint local antiguo mal escrito se puede corregir, pero no
        // se puede leer de él para migrar copias ya indexadas.
        source = null;
      }
      const destination = storageTargetFrom(provider, input);
      if (provider !== currentProvider && !destination) {
        throw new Error('Complete the new storage credentials before switching.');
      }
      if (!source && destination) {
        const oldAddress =
          currentProvider === 'cloudflare'
            ? `${currentCredentials.r2AccountId ?? ''}|${currentCredentials.r2Bucket ?? ''}`
            : `${currentCredentials.s3Endpoint ?? ''}|${currentCredentials.s3Bucket ?? ''}`;
        const newAddress =
          provider === 'cloudflare'
            ? `${input.r2AccountId ?? ''}|${input.r2Bucket ?? ''}`
            : `${input.s3Endpoint ?? ''}|${input.s3Bucket ?? ''}`;
        if (
          (provider !== currentProvider || (oldAddress !== '|' && oldAddress !== newAddress)) &&
          (await hasIndexedBackups())
        ) {
          throw new Error(
            'Existing backups are indexed, but the current bucket cannot be read. Restore its credentials before changing destination.',
          );
        }
      }
      let migrated = false;
      if (source && destination && destinationChanged(source, destination)) {
        const release = await beginStorageMigration();
        try {
          const result = await migrateStorageObjects(source, destination, (progress) => {
            try {
              if (!event.sender.isDestroyed())
                event.sender.send('settings:storageMigrationProgress', progress);
            } catch {
              // Cerrar Ajustes no interrumpe la copia ni cambia el destino.
            }
          });
          if (result.total === 0 && (await hasIndexedBackups())) {
            throw new Error(
              'Backups are indexed, but the current bucket is empty. Reconcile the old destination before switching.',
            );
          }
          migrated = result.total > 0;
          if (migrated) await verifyMigratedRestore(destination);
        } finally {
          release();
        }
      }
      setCredentials(input);
      if (provider !== currentProvider) setConfigValue('saveStorageProvider', provider);
      applyCredentialsChange();
      if (migrated && destination) markIdentityReconciled(destination.identity);
      return getCredentials();
    },
  );

  // Llevarse las claves a otro PC (config/credentials.ts). La carpeta de
  // destino y el fichero de origen los pide el renderer con los MISMOS
  // diálogos que ya usan Backups y Game saves (dialog:pickFolder y
  // dialog:pickFile), así que aquí no hay diálogo propio que mantener.
  ipcMain.handle('settings:exportCredentials', (_event, directory: string) =>
    exportCredentialsTo(directory),
  );

  ipcMain.handle('settings:importCredentials', (_event, filePath: string) => {
    const result = importCredentialsFromFile(filePath);
    applyCredentialsChange();
    return result;
  });

  // El fichero soltado en la carpeta de datos se importa en el arranque,
  // cuando todavía no hay ventana: el renderer pregunta al montarse si pasó
  // algo que contar. Se entrega una vez y se olvida.
  ipcMain.handle('settings:getStartupKeysImport', () => takeStartupKeysImport());

  // Para el camino automático hay que saber DÓNDE se suelta el fichero, y la
  // ruta de userData no se la sabe nadie de memoria — este botón la abre.
  ipcMain.handle('settings:openDataFolder', async (): Promise<void> => {
    const result = await openPathResult(app.getPath('userData'));
    if (!result.ok) {
      console.warn('[settings] no se pudo abrir la carpeta de datos:', result);
    }
  });
};
