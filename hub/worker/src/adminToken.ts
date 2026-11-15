// Segunda puerta de la API de la PWA (/api/v2/*): un token de administración
// guardado como secret del Worker (`HUB_ADMIN_TOKEN`).
//
// Por qué existe: la puerta normal es Cloudflare Access (§9.2), pero mientras
// no haya PWA 2.0 (fase 5) no hay ninguna página desde la que pedir un código
// de emparejado. Con este token, un script local (`scripts/hub-dev.ts`) puede
// pedirlo en nombre del anfitrión (`ADMIN_EMAIL`), y así se puede emparejar un
// PC con un hub de desarrollo sin montar Access.
//
// Reglas:
// - Solo existe si el secret está puesto. Sin él, esta puerta no abre nunca y
//   todo pasa por Access, que falla cerrado.
// - Exige un token largo (32 caracteres como mínimo): uno corto se rechaza
//   aunque coincida, para que un secret mal puesto no abra la API.
// - Solo actúa como el anfitrión: sin `ADMIN_EMAIL`, no abre.
// - La comparación es de tiempo constante sobre las huellas SHA-256 de los dos
//   valores, para no filtrar por tiempo cuántos caracteres coinciden.

import { AccessError } from './access';

export const ADMIN_TOKEN_HEADER = 'x-afterplay-admin-token';
export const MIN_ADMIN_TOKEN_LENGTH = 32;

export interface AdminTokenEnv {
  HUB_ADMIN_TOKEN?: string;
  ADMIN_EMAIL?: string;
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/**
 * Si la petición trae la cabecera del token de administración, decide con él:
 * devuelve la identidad del anfitrión o lanza `AccessError`. Si no la trae,
 * devuelve null y el llamador sigue con Access.
 */
export async function authenticateAdminToken(
  request: Request,
  env: AdminTokenEnv,
): Promise<{ email: string } | null> {
  const presented = request.headers.get(ADMIN_TOKEN_HEADER);
  if (presented === null) return null;
  const expected = env.HUB_ADMIN_TOKEN;
  if (!expected || expected.length < MIN_ADMIN_TOKEN_LENGTH) {
    throw new AccessError('token de administración no configurado');
  }
  if (!env.ADMIN_EMAIL) throw new AccessError('ADMIN_EMAIL no configurado');
  if (!(await sameSecret(presented, expected))) {
    throw new AccessError('token de administración no válido');
  }
  return { email: env.ADMIN_EMAIL };
}
