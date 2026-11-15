import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Administra el HUB DE DESARROLLO (`afterplay-dev-hub`) sin PWA, con el token
// de administración (hub/worker/src/adminToken.ts):
//
//   npm run hub:dev -- code             -> código de emparejado de un solo uso
//   npm run hub:dev -- devices          -> dispositivos emparejados
//   npm run hub:dev -- revoke <tokenId> -> revocar uno
//
// El token se lee de hub/worker/.dev.vars.admin-token (que git ignora) y no se
// imprime nunca. El código que sale se teclea en la app, en Ajustes →
// Connections → Sync, junto con la dirección del hub.
//
// Solo habla con el hub de desarrollo: la dirección está fija aquí y el perfil
// de desarrollo de la app tampoco acepta otra (devProfileRules.ts).

const HUB_URL =
  process.env.AFTERPLAY_DEV_HUB_URL ?? 'https://afterplay-dev-hub.afterplay-worker.workers.dev';
const TOKEN_FILE = join(process.cwd(), 'hub', 'worker', '.dev.vars.admin-token');

const fail = (message: string): never => {
  console.error(`[hub:dev] ${message}`);
  process.exit(1);
};

const readToken = (): string => {
  let text: string;
  try {
    text = readFileSync(TOKEN_FILE, 'utf8');
  } catch {
    return fail(`no encuentro ${TOKEN_FILE}: es el token del hub de desarrollo`);
  }
  const match = /^HUB_ADMIN_TOKEN=(.+)$/m.exec(text);
  return match ? match[1].trim() : fail(`${TOKEN_FILE} no tiene HUB_ADMIN_TOKEN=...`);
};

const call = async (method: 'GET' | 'POST', path: string): Promise<unknown> => {
  const response = await fetch(`${HUB_URL}/api/v2${path}`, {
    method,
    headers: { 'x-afterplay-admin-token': readToken() },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body ? String(body.message) : '';
    fail(`el hub respondió ${response.status}: ${message}`);
  }
  return body;
};

const main = async (): Promise<void> => {
  const [command, argument] = process.argv.slice(2);

  switch (command) {
    case 'code': {
      const { code, expiresAt } = (await call('POST', '/devices/enroll-code')) as {
        code: string;
        expiresAt: number;
      };
      console.log(`Hub:    ${HUB_URL}`);
      console.log(`Código: ${code}`);
      console.log(`Caduca: ${new Date(expiresAt).toLocaleString()}`);
      break;
    }
    case 'devices':
      console.log(JSON.stringify(await call('GET', '/devices'), null, 2));
      break;
    case 'revoke':
      if (!argument) fail('falta el id del token: npm run hub:dev -- revoke <tokenId>');
      console.log(JSON.stringify(await call('POST', `/devices/${argument}/revoke`), null, 2));
      break;
    default:
      fail('uso: npm run hub:dev -- code | devices | revoke <tokenId>');
  }
};

void main();
