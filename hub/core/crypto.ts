// Primitivas de aleatoriedad y huella del hub. Usan Web Crypto
// (`globalThis.crypto`), que existe igual en Node y en Workers: así el núcleo
// no importa `node:crypto` (§9.6).
//
// Solo `sha256Hex` es asíncrona (`crypto.subtle.digest` lo es). Por eso en el
// núcleo solo son asíncronos el emparejado y la autenticación, y siempre
// calculan la huella ANTES de abrir una transacción: dentro de una
// `transactionSync` no se puede esperar nada.

const encoder = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `length` caracteres de `alphabet` elegidos al azar, sin sesgo de módulo. */
export function randomString(length: number, alphabet: string): string {
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Secreto de token: 43 caracteres base64url = 258 bits de entropía. */
export const randomSecret = (): string => randomString(43, BASE64URL);

export const randomId = (): string => crypto.randomUUID();
