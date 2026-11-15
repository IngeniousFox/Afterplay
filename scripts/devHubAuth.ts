import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Las credenciales con las que los scripts de desarrollo hablan con
// `/api/v2/*` del HUB DE DESARROLLO, leídas de hub/worker/.dev.vars.admin-token
// (que git ignora). Nunca se imprimen.
//
//   HUB_ADMIN_TOKEN=...           el token de administración (adminToken.ts)
//   CF_ACCESS_CLIENT_ID=...       token de servicio de Cloudflare Access
//   CF_ACCESS_CLIENT_SECRET=...   (opcionales: solo si Access protege el hub)
//
// Con Access delante del hub, una petición sin sesión de navegador no llega al
// Worker: Access la manda a su pantalla de login. El token de servicio es lo
// que la deja pasar; después, el hub sigue exigiendo el token de
// administración.

export const DEV_HUB_TOKEN_FILE = join(process.cwd(), 'hub', 'worker', '.dev.vars.admin-token');

const valueOf = (text: string, key: string): string | undefined =>
  new RegExp(`^${key}=(.+)$`, 'm').exec(text)?.[1]?.trim() || undefined;

/** Las cabeceras para `/api/v2/*`. Lanza si falta el fichero o el token de administración. */
export function devHubHeaders(file: string = DEV_HUB_TOKEN_FILE): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`no encuentro ${file}: es el token del hub de desarrollo`);
  }
  const adminToken = valueOf(text, 'HUB_ADMIN_TOKEN');
  if (!adminToken) throw new Error(`${file} no tiene HUB_ADMIN_TOKEN=...`);
  const headers: Record<string, string> = { 'x-afterplay-admin-token': adminToken };
  const clientId = valueOf(text, 'CF_ACCESS_CLIENT_ID');
  const clientSecret = valueOf(text, 'CF_ACCESS_CLIENT_SECRET');
  if (clientId && clientSecret) {
    headers['CF-Access-Client-Id'] = clientId;
    headers['CF-Access-Client-Secret'] = clientSecret;
  }
  return headers;
}
