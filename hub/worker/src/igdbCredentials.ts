// Las claves de Twitch/IGDB de UN inquilino, guardadas cifradas (F-29, §9.3).
//
// El escritorio las sube con `POST /sync/v1/igdb-credentials`; aquí se cifran
// con `HUB_SECRETS_KEY` (hub/core/secretBox.ts) y solo el sobre llega al
// almacenamiento. Nunca se guardan, devuelven ni registran en claro: `save`
// no devuelve nada y `load` solo lo usa el cliente de IGDB, en memoria.

import { HubError } from '../../core/hub';
import { SecretBoxError, openSecret, sealSecret } from '../../core/secretBox';
import type { SqlStorage } from '../../core/storage';
import { IGDB_KEY_MAX_LENGTH } from '../../../src/shared/sync/protocol';
import type { IgdbKeys } from './web/igdbClient';

/** Finalidad de la clave derivada: otro tipo de secreto usaría otra. */
export const IGDB_SECRET_PURPOSE = 'igdb-credentials';

export class IgdbCredentialStore {
  constructor(
    private readonly storage: SqlStorage,
    private readonly tenantId: string,
    /** El secret `HUB_SECRETS_KEY` del Worker; undefined si no está configurado. */
    private readonly masterKey: string | undefined,
    private readonly now: () => number,
  ) {
    storage.execScript(`CREATE TABLE IF NOT EXISTS worker_igdb_credentials (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  envelope TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);`);
  }

  /** Valida, cifra y guarda. Sin `HUB_SECRETS_KEY` falla SIN guardar nada. */
  async save(input: unknown): Promise<void> {
    const keys = parseKeys(input);
    if (!this.masterKey) {
      throw new HubError(
        'internal',
        'el hub no tiene configurado HUB_SECRETS_KEY: no puede guardar las claves de IGDB',
      );
    }
    let envelope: string;
    try {
      envelope = await sealSecret(
        this.masterKey,
        IGDB_SECRET_PURPOSE,
        this.tenantId,
        JSON.stringify(keys),
      );
    } catch (error) {
      if (error instanceof SecretBoxError) {
        throw new HubError('internal', `HUB_SECRETS_KEY no es válida: ${error.message}`);
      }
      throw error;
    }
    this.storage.exec(
      `INSERT INTO worker_igdb_credentials (id, envelope, updatedAt) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET envelope = excluded.envelope, updatedAt = excluded.updatedAt`,
      envelope,
      this.now(),
    );
  }

  /**
   * Las claves, descifradas, o null si no hay (o no se pueden abrir: el secret
   * cambió). En ese caso la PWA dice que hay que abrir el PC otra vez.
   */
  async load(): Promise<IgdbKeys | null> {
    const row = this.storage.exec(`SELECT envelope FROM worker_igdb_credentials WHERE id = 1`)[0];
    if (!row || !this.masterKey) return null;
    try {
      const plain = await openSecret(
        this.masterKey,
        IGDB_SECRET_PURPOSE,
        this.tenantId,
        String(row.envelope),
      );
      return parseKeys(JSON.parse(plain));
    } catch {
      return null;
    }
  }

  /** ¿Hay un sobre guardado? No lo abre. */
  has(): boolean {
    return (
      this.storage.exec(`SELECT 1 AS found FROM worker_igdb_credentials WHERE id = 1`).length > 0
    );
  }
}

function parseKeys(input: unknown): IgdbKeys {
  const { clientId, clientSecret } = (input ?? {}) as Record<string, unknown>;
  const valid = (value: unknown): value is string =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= IGDB_KEY_MAX_LENGTH &&
    // Las claves de Twitch son alfanuméricas; esto corta saltos de línea y basura.
    /^[\x21-\x7e]+$/.test(value);
  if (!valid(clientId) || !valid(clientSecret)) {
    throw new HubError('invalid_request', 'clientId y clientSecret deben ser texto no vacío');
  }
  return { clientId, clientSecret };
}
