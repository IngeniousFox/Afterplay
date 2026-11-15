import type { CredentialsValues } from './types';

// EL MAPA "campo interno -> nombre de variable de entorno", en UN solo sitio.
//
// Vive aquí y no en main/config/credentials.ts porque lo necesitan los dos
// lados: la app (para leer y escribir sus credenciales) y el andamio de los
// tests E2E (que fabrica el credentials.json del sandbox a partir de un
// .env.test). El andamio corre en Node puro, y credentials.ts importa
// electron — o sea que importarlo desde ahí es imposible, y la alternativa
// era una segunda copia del mapa. Una copia de esto es exactamente la clase
// de divergencia que se paga tarde: añades una clave nueva, el sandbox no la
// conoce, y el test que la necesita falla por un motivo que no es el suyo.
export const ENV_BY_CREDENTIAL_KEY: Record<keyof CredentialsValues, string> = {
  twitchClientId: 'TWITCH_CLIENT_ID',
  twitchClientSecret: 'TWITCH_CLIENT_SECRET',
  steamGridDbApiKey: 'STEAMGRIDDB_API_KEY',
  databaseUrl: 'DATABASE_URL',
  databaseAuthToken: 'DATABASE_AUTH_TOKEN',
  r2AccountId: 'R2_ACCOUNT_ID',
  r2Bucket: 'R2_BUCKET',
  r2AccessKeyId: 'R2_ACCESS_KEY_ID',
  r2SecretAccessKey: 'R2_SECRET_ACCESS_KEY',
  s3Endpoint: 'S3_ENDPOINT',
  s3Region: 'S3_REGION',
  s3Bucket: 'S3_BUCKET',
  s3AccessKeyId: 'S3_ACCESS_KEY_ID',
  s3SecretAccessKey: 'S3_SECRET_ACCESS_KEY',
  s3AddressingMode: 'S3_ADDRESSING_MODE',
  anthropicApiKey: 'ANTHROPIC_API_KEY',
  steamApiKey: 'STEAM_API_KEY',
  steamUserId64: 'STEAM_USER_ID64',
  raUsername: 'RA_USERNAME',
  raApiKey: 'RA_API_KEY',
};

export const CREDENTIAL_KEYS = Object.keys(ENV_BY_CREDENTIAL_KEY) as (keyof CredentialsValues)[];

// Las DOS que deciden con qué base de datos habla la app. Se nombran aparte
// porque son las únicas cuyo destino importa de verdad: el resto abre una API
// externa, estas abren TU biblioteca. El andamio E2E las trata distinto (no
// entran en el sandbox salvo que un test pida sync a propósito) y por eso
// necesita poder señalarlas sin escribir los nombres a mano.
export const DATABASE_CREDENTIAL_KEYS = ['databaseUrl', 'databaseAuthToken'] as const;

// LAS DEL SYNC 2.0: la dirección del hub y el token de este PC (`ap1.…`, §9.2).
// Son "de base de datos" a todos los efectos —el token abre la biblioteca
// entera—, pero se tratan APARTE de las de arriba por una razón concreta: no
// son un campo de `CredentialsValues`, así que no viajan al renderer con
// `settings:getCredentials`, no entran en el fichero de claves exportado, no
// se vuelcan a `process.env` ni las adopta el .env legado, y el borrador de la
// pestaña Connections no puede borrarlas al guardar. Se emparejan y se
// desemparejan solo por su propia vía (main/sync/runtime.ts). Viven en el
// mismo credentials.json, cifradas igual.
//
// El andamio E2E las quita como a las otras dos (e2e/credentials.ts), y un
// perfil de desarrollo solo acepta un hub cuyo nombre diga que es de
// desarrollo (devProfileBlocksHub).
export const SYNC_CREDENTIAL_KEYS = ['syncHubUrl', 'syncHubToken'] as const;

export type SyncCredentialKey = (typeof SYNC_CREDENTIAL_KEYS)[number];
