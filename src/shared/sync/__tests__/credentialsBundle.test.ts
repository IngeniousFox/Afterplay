import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SYNCED_CREDENTIAL_KEYS,
  mergeCredentialBundles,
  type CredentialEntry,
  parseCredentialsBundle,
  type CredentialsBundle,
} from '../credentialsBundle';

// El paquete de credenciales: qué claves viajan, qué forma tiene lo válido y
// cómo se fusiona. Valores inventados.

describe('SYNCED_CREDENTIAL_KEYS', () => {
  it('no incluye Turso ni el emparejado del hub, y sí el destino de las partidas', () => {
    const keys: readonly string[] = SYNCED_CREDENTIAL_KEYS;
    assert.ok(!keys.includes('databaseUrl'));
    assert.ok(!keys.includes('databaseAuthToken'));
    assert.ok(!keys.includes('syncHubUrl'));
    assert.ok(!keys.includes('syncHubToken'));
    assert.ok(keys.includes('saveStorageProvider'));
    assert.ok(keys.includes('twitchClientSecret'));
    assert.ok(keys.includes('s3SecretAccessKey'));
  });
});

describe('parseCredentialsBundle', () => {
  it('acepta valores, borrados y el destino de las partidas', () => {
    const bundle = {
      steamApiKey: { value: 'a b-c', updatedAt: 0 },
      raApiKey: { value: null, updatedAt: 5 },
      saveStorageProvider: { value: 's3', updatedAt: 9 },
    };
    assert.deepEqual(parseCredentialsBundle(bundle), bundle);
  });

  it('rechaza lo que no encaja, sin repetir el valor en el mensaje', () => {
    const bad: unknown[] = [
      null,
      [],
      { desconocida: { value: 'x', updatedAt: 1 } },
      { databaseUrl: { value: 'x', updatedAt: 1 } },
      { steamApiKey: { value: '', updatedAt: 1 } },
      { steamApiKey: { value: 'ñ', updatedAt: 1 } },
      { steamApiKey: { value: 'a\tb', updatedAt: 1 } },
      { steamApiKey: { value: 'x'.repeat(4097), updatedAt: 1 } },
      { steamApiKey: { value: 3, updatedAt: 1 } },
      { steamApiKey: { value: 'x', updatedAt: -1 } },
      { steamApiKey: { value: 'x', updatedAt: 1.5 } },
      { steamApiKey: { value: 'x', updatedAt: '1' } },
      { steamApiKey: { value: 'x', updatedAt: 1, otro: 1 } },
      { saveStorageProvider: { value: 'azure', updatedAt: 1 } },
    ];
    for (const input of bad) {
      assert.throws(() => parseCredentialsBundle(input), /./, JSON.stringify(input));
    }
    assert.throws(
      () => parseCredentialsBundle({ steamApiKey: { value: 'ñ-secreto', updatedAt: 1 } }),
      (error: unknown) => error instanceof Error && !error.message.includes('secreto'),
    );
  });
});

describe('mergeCredentialBundles', () => {
  const entry = (value: string | null, updatedAt: number): CredentialEntry => ({
    value,
    updatedAt,
  });

  it('toma la entrante si la base no la tiene o es más nueva; los empates se quedan', () => {
    const base: CredentialsBundle = {
      steamApiKey: entry('base', 10),
      raApiKey: entry('base', 10),
      raUsername: entry('base', 10),
    };
    const incoming: CredentialsBundle = {
      steamApiKey: entry('entrante', 11),
      raApiKey: entry('entrante', 10),
      raUsername: entry('entrante', 9),
      anthropicApiKey: entry('nueva', 1),
    };

    assert.deepEqual(mergeCredentialBundles(base, incoming), {
      steamApiKey: entry('entrante', 11),
      raApiKey: entry('base', 10),
      raUsername: entry('base', 10),
      anthropicApiKey: entry('nueva', 1),
    });
  });

  it('es pura: no modifica ninguna de las dos', () => {
    const base: CredentialsBundle = { steamApiKey: entry('base', 1) };
    const incoming: CredentialsBundle = { steamApiKey: entry('entrante', 2) };
    mergeCredentialBundles(base, incoming);
    assert.deepEqual(base, { steamApiKey: entry('base', 1) });
    assert.deepEqual(incoming, { steamApiKey: entry('entrante', 2) });
  });
});
