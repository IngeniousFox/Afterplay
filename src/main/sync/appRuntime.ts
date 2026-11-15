import {
  applySyncedCredentials,
  clearSyncCredentials,
  getCredentials,
  getCredentialStamps,
  readSyncCredentials,
  writeSyncCredentials,
} from '../config/credentials';
import { invalidateCredentialClients } from '../config/credentialsInvalidate';
import { getConfigValue, setConfigValue } from '../config/store';
import { appLocalDb } from '../db/v2/appDb';
import { devProfileBlocksHub } from '../lib/devProfileRules';
import { isE2E } from '../lib/e2e';
import { getMachineName } from '../saves/machine';
import type { SyncChange, SyncLogger } from './engine';
import { setSyncRuntime } from './instance';
import {
  STORAGE_PROVIDER_KEY,
  SYNCED_CREDENTIAL_KEYS,
  isSyncableValue,
  type CredentialsBundle,
} from '../../shared/sync/credentialsBundle';
import type { CredentialsValues } from '../../shared/types';
import { SyncRuntime, type CredentialsSource } from './runtime';

// El sync de ESTA app: el `SyncRuntime` cableado con el almacén de
// credenciales cifrado, el nombre del PC, el perfil de desarrollo y el modo
// E2E. index.ts solo pasa los avisos a la ventana. Se llama una vez, con la
// base ya abierta.

const logger: SyncLogger = {
  info: (message, ...details) => console.log(`[sync] ${message}`, ...details),
  warn: (message, ...details) => console.warn(`[sync] ${message}`, ...details),
  error: (message, ...details) => console.error(`[sync] ${message}`, ...details),
};

/**
 * Las credenciales de ESTE PC para el sync: valores de credentials.json, sellos
 * de config.json y el destino de las partidas guardadas. Aplicar lo que llega
 * del hub NO lanza el flujo de migración de R2/S3: ese solo corre en el PC
 * donde la persona cambió el destino.
 */
function appCredentialsSource(): CredentialsSource {
  return {
    readBundle: () => {
      const values = getCredentials();
      const stamps = getCredentialStamps();
      const bundle: CredentialsBundle = {};
      for (const key of SYNCED_CREDENTIAL_KEYS) {
        const stamp = stamps[key];
        if (key === STORAGE_PROVIDER_KEY) {
          // Sin sello, 'cloudflare' es solo el valor por defecto: subirlo con
          // fecha 0 podría deshacer en otro PC un destino elegido antes de
          // que existieran los sellos.
          const provider = getConfigValue('saveStorageProvider');
          if (stamp !== undefined || provider === 's3') {
            bundle[key] = { value: provider, updatedAt: stamp ?? 0 };
          }
          continue;
        }
        const value = values[key];
        // Un valor que el hub no aceptaría (no ASCII…) no puede tumbar el
        // intercambio entero: se queda en este PC.
        if (value && !isSyncableValue(key, value)) continue;
        if (!value && stamp === undefined) continue;
        bundle[key] = { value: value ?? null, updatedAt: stamp ?? 0 };
      }
      return bundle;
    },
    apply: (changes) => {
      const values: Partial<Record<keyof CredentialsValues, string | null>> = {};
      const stamps: Record<string, number> = {};
      for (const key of SYNCED_CREDENTIAL_KEYS) {
        const entry = changes[key];
        if (!entry || key === STORAGE_PROVIDER_KEY) continue;
        values[key] = entry.value;
        stamps[key] = entry.updatedAt;
      }
      applySyncedCredentials(values, stamps);
      const provider = changes[STORAGE_PROVIDER_KEY];
      if (provider && (provider.value === 'cloudflare' || provider.value === 's3')) {
        setConfigValue(STORAGE_PROVIDER_KEY, provider.value);
        setConfigValue('credentialStamps', {
          ...getCredentialStamps(),
          [STORAGE_PROVIDER_KEY]: provider.updatedAt,
        });
      }
      invalidateCredentialClients();
      // Solo el NÚMERO de claves: jamás un nombre con su valor.
      logger.info(`${Object.keys(changes).length} claves recibidas del hub`);
    },
  };
}

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
    credentialsSource: appCredentialsSource(),
    onChange: notify.changed,
    onStatus: notify.status,
    logger,
  });
  setSyncRuntime(runtime);
  return runtime;
}
