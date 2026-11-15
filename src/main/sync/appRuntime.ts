import {
  clearSyncCredentials,
  getCredentials,
  readSyncCredentials,
  writeSyncCredentials,
} from '../config/credentials';
import { getConfigValue, setConfigValue } from '../config/store';
import { appLocalDb } from '../db/v2/appDb';
import { devProfileBlocksHub } from '../lib/devProfileRules';
import { isE2E } from '../lib/e2e';
import { getMachineName } from '../saves/machine';
import type { SyncChange, SyncLogger } from './engine';
import { setSyncRuntime } from './instance';
import { SyncRuntime } from './runtime';

// El sync de ESTA app: el `SyncRuntime` cableado con el almacén de
// credenciales cifrado, el nombre del PC, el perfil de desarrollo y el modo
// E2E. index.ts solo pasa los avisos a la ventana. Se llama una vez, con la
// base ya abierta.

const logger: SyncLogger = {
  info: (message, ...details) => console.log(`[sync] ${message}`, ...details),
  warn: (message, ...details) => console.warn(`[sync] ${message}`, ...details),
  error: (message, ...details) => console.error(`[sync] ${message}`, ...details),
};

export function createAppSyncRuntime(notify: {
  readonly changed: (change: SyncChange) => void;
  readonly status: () => void;
}): SyncRuntime {
  const runtime = new SyncRuntime({
    local: appLocalDb(),
    deviceName: getMachineName(),
    isE2E: isE2E(),
    isHubBlocked: devProfileBlocksHub,
    credentials: {
      read: readSyncCredentials,
      write: writeSyncCredentials,
      clear: clearSyncCredentials,
    },
    igdbKeys: {
      read: () => {
        const { twitchClientId, twitchClientSecret } = getCredentials();
        return twitchClientId && twitchClientSecret
          ? { clientId: twitchClientId, clientSecret: twitchClientSecret }
          : null;
      },
      readFingerprint: () => getConfigValue('igdbKeysFingerprint'),
      writeFingerprint: (fingerprint) => setConfigValue('igdbKeysFingerprint', fingerprint),
    },
    onChange: notify.changed,
    onStatus: notify.status,
    logger,
  });
  setSyncRuntime(runtime);
  return runtime;
}
