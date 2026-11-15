// Cifrado de secretos en reposo del hub (F-29, §9.3): AES-256-GCM con Web
// Crypto, que existe igual en Node y en Workers (como `crypto.ts`).
//
// La clave maestra es un secret del Worker (`HUB_SECRETS_KEY`) y NUNCA se
// guarda junto a los datos: quien lea el almacenamiento del Durable Object
// sin el secret ve solo texto cifrado. De ella se deriva (HKDF-SHA256) una
// clave distinta por inquilino y por finalidad, así que un cifrado de una
// persona no se abre con la clave de otra aunque alguien lo copie de sitio.
//
// Formato del sobre (cadena, para guardarlo en una columna TEXT):
//   `v1.<iv>.<cifrado>`, con iv de 12 bytes aleatorios y `cifrado` = texto
//   cifrado + etiqueta GCM de 16 bytes, ambos en base64url sin relleno.
// Datos autenticados (AAD): `afterplay-secret:v1:<finalidad>:<inquilino>`.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SECRET_BOX_VERSION = 'v1';
/** Una clave maestra más corta que esto no es una clave: se rechaza. */
export const MIN_MASTER_KEY_LENGTH = 32;

/** El sobre no se puede abrir: clave equivocada, datos alterados o formato roto. */
export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SecretBoxError('base64 no válido');
  const padded = text
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(
  masterKey: string,
  purpose: string,
  tenantId: string,
  usage: 'encrypt' | 'decrypt',
): Promise<Awaited<ReturnType<typeof crypto.subtle.deriveKey>>> {
  if (masterKey.length < MIN_MASTER_KEY_LENGTH) {
    throw new SecretBoxError(
      `la clave maestra debe tener al menos ${MIN_MASTER_KEY_LENGTH} caracteres`,
    );
  }
  const material = await crypto.subtle.importKey('raw', encoder.encode(masterKey), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('afterplay-hub-secrets'),
      info: encoder.encode(`${purpose}:${tenantId}`),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

const aad = (purpose: string, tenantId: string): Uint8Array =>
  encoder.encode(`afterplay-secret:${SECRET_BOX_VERSION}:${purpose}:${tenantId}`);

/** Cifra `plaintext`. Cada llamada usa un iv nuevo: el mismo texto da sobres distintos. */
export async function sealSecret(
  masterKey: string,
  purpose: string,
  tenantId: string,
  plaintext: string,
): Promise<string> {
  const key = await deriveKey(masterKey, purpose, tenantId, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(purpose, tenantId) },
    key,
    encoder.encode(plaintext),
  );
  return `${SECRET_BOX_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

/** Abre un sobre. Lanza `SecretBoxError` sin decir nada del contenido. */
export async function openSecret(
  masterKey: string,
  purpose: string,
  tenantId: string,
  envelope: string,
): Promise<string> {
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== SECRET_BOX_VERSION) {
    throw new SecretBoxError('formato de sobre desconocido');
  }
  let iv: Uint8Array;
  let cipher: Uint8Array;
  try {
    iv = fromBase64Url(parts[1]);
    cipher = fromBase64Url(parts[2]);
  } catch {
    throw new SecretBoxError('sobre mal formado');
  }
  if (iv.length !== 12) throw new SecretBoxError('sobre mal formado');
  const key = await deriveKey(masterKey, purpose, tenantId, 'decrypt');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(purpose, tenantId) },
      key,
      cipher,
    );
    return decoder.decode(plain);
  } catch {
    throw new SecretBoxError('no se pudo descifrar (clave distinta o datos alterados)');
  }
}
