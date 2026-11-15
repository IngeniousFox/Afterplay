// Las credenciales de servicios de UN inquilino, guardadas cifradas y
// fusionadas entre los PCs emparejados (ver shared/sync/credentialsBundle.ts).
//
// Mismo esquema que `igdbCredentials.ts`: el paquete entero se cifra con
// `HUB_SECRETS_KEY` (hub/core/secretBox.ts) y solo el sobre llega al
// almacenamiento. Nunca se guarda ni se registra nada en claro. A diferencia
// de aquella, esta SÍ devuelve el contenido: a los PCs del propio dueño,
// autenticados con su token, para que las claves lleguen a todos.

import { HubError } from '../../core/hub';
import { SecretBoxError, openSecret, sealSecret } from '../../core/secretBox';
import type { SqlStorage } from '../../core/storage';
import {
  mergeCredentialBundles,
  parseCredentialsBundle,
  type CredentialsBundle,
} from '../../../src/shared/sync/credentialsBundle';
import type { CredentialsExchangeResponse } from '../../../src/shared/sync/protocol';

/** Finalidad de la clave derivada: otro tipo de secreto usaría otra. */
export const CREDENTIALS_BUNDLE_PURPOSE = 'credentials-bundle';

export class CredentialBundleStore {
  constructor(
    private readonly storage: SqlStorage,
    private readonly tenantId: string,
    /** El secret `HUB_SECRETS_KEY` del Worker; undefined si no está configurado. */
    private readonly masterKey: string | undefined,
    private readonly now: () => number,
  ) {
    storage.execScript(`CREATE TABLE IF NOT EXISTS worker_credentials (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  envelope TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);`);
  }

  /**
   * Valida lo que sube el PC, lo fusiona con lo guardado y devuelve el
   * resultado. Solo escribe si algo cambió. Sin `HUB_SECRETS_KEY` falla SIN
   * guardar nada.
   */
  async exchange(input: unknown): Promise<CredentialsExchangeResponse> {
    let incoming: CredentialsBundle;
    try {
      const entries = (input as { entries?: unknown } | null)?.entries;
      incoming = parseCredentialsBundle(entries);
    } catch (error) {
      throw new HubError('invalid_request', error instanceof Error ? error.message : 'no válido');
    }
    const masterKey = this.requireMasterKey();
    const current = await this.load();
    const merged = mergeCredentialBundles(current, incoming);
    if (JSON.stringify(sorted(merged)) !== JSON.stringify(sorted(current))) {
      await this.save(masterKey, merged);
    }
    return { entries: merged };
  }

  /** El paquete descifrado, o `{}` si no hay (o no se puede abrir: el secret cambió). */
  async load(): Promise<CredentialsBundle> {
    const row = this.storage.exec(`SELECT envelope FROM worker_credentials WHERE id = 1`)[0];
    if (!row || !this.masterKey) return {};
    try {
      const plain = await openSecret(
        this.masterKey,
        CREDENTIALS_BUNDLE_PURPOSE,
        this.tenantId,
        String(row.envelope),
      );
      return parseCredentialsBundle(JSON.parse(plain));
    } catch {
      return {};
    }
  }

  private requireMasterKey(): string {
    if (!this.masterKey) {
      throw new HubError(
        'internal',
        'el hub no tiene configurado HUB_SECRETS_KEY: no puede guardar las credenciales',
      );
    }
    return this.masterKey;
  }

  private async save(masterKey: string, bundle: CredentialsBundle): Promise<void> {
    let envelope: string;
    try {
      envelope = await sealSecret(
        masterKey,
        CREDENTIALS_BUNDLE_PURPOSE,
        this.tenantId,
        JSON.stringify(bundle),
      );
    } catch (error) {
      if (error instanceof SecretBoxError) {
        throw new HubError('internal', `HUB_SECRETS_KEY no es válida: ${error.message}`);
      }
      throw error;
    }
    this.storage.exec(
      `INSERT INTO worker_credentials (id, envelope, updatedAt) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET envelope = excluded.envelope, updatedAt = excluded.updatedAt`,
      envelope,
      this.now(),
    );
  }

  /** ¿Hay un sobre guardado? No lo abre. */
  has(): boolean {
    return this.storage.exec(`SELECT 1 AS found FROM worker_credentials WHERE id = 1`).length > 0;
  }
}

/** Orden estable de claves, para comparar dos paquetes por su JSON. */
function sorted(bundle: CredentialsBundle): [string, unknown][] {
  return Object.entries(bundle).sort(([a], [b]) => (a < b ? -1 : 1));
}
