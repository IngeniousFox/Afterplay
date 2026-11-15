import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatClock } from '../src/shared/sync/clock';
import { PROTOCOL_VERSION } from '../src/shared/sync/protocol';
import { createHttpTransport, enroll } from '../src/main/sync/httpTransport';
import { APP_SCHEMA_VERSION } from '../src/main/db/v2/schemaVersion';

// Prueba de humo del HUB DE DESARROLLO con el código real del cliente
// (httpTransport.ts): empareja un dispositivo de prueba, comprueba status,
// sube una fila, la baja, pide y cierra una concesión, y revoca el
// dispositivo al terminar. Deja en el hub solo esa fila de prueba y el token
// revocado.
//
//   npm run hub:dev:smoke
//
// Lee el token de administración de hub/worker/.dev.vars.admin-token y no lo
// imprime.

const HUB_URL =
  process.env.AFTERPLAY_DEV_HUB_URL ?? 'https://afterplay-dev-hub.afterplay-worker.workers.dev';
const ADMIN_TOKEN = /^HUB_ADMIN_TOKEN=(.+)$/m
  .exec(readFileSync(join(process.cwd(), 'hub', 'worker', '.dev.vars.admin-token'), 'utf8'))?.[1]
  ?.trim();

const admin = async (method: 'GET' | 'POST', path: string): Promise<unknown> => {
  const response = await fetch(`${HUB_URL}/api/v2${path}`, {
    method,
    headers: { 'x-afterplay-admin-token': ADMIN_TOKEN ?? '' },
  });
  if (!response.ok) throw new Error(`admin ${path}: ${response.status}`);
  return response.json();
};

const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'OK ' : 'MAL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) process.exitCode = 1;
};

const main = async (): Promise<void> => {
  if (!ADMIN_TOKEN) throw new Error('falta HUB_ADMIN_TOKEN');
  const version = { protocolVersion: PROTOCOL_VERSION, schemaVersion: APP_SCHEMA_VERSION };
  const deviceId = `smoke-${Date.now()}`;

  const { code } = (await admin('POST', '/devices/enroll-code')) as { code: string };
  const enrolled = await enroll(HUB_URL, {
    ...version,
    code,
    deviceId,
    deviceName: 'Prueba de humo',
  });
  check('emparejado', enrolled.token.startsWith('ap1.'), `id corto ${enrolled.shortDeviceId}`);

  await enroll(HUB_URL, { ...version, code, deviceId, deviceName: 'x' }).then(
    () => check('el código no se puede reutilizar', false),
    (error: { code?: string }) =>
      check('el código no se puede reutilizar', error.code === 'enroll_code_invalid'),
  );

  const hub = createHttpTransport({ baseUrl: HUB_URL, token: enrolled.token });
  const status = await hub.status(version);
  check('status', status.hubId === enrolled.hubId, `seq ${status.seq}`);
  check('hora del hub razonable', Math.abs(status.serverTime - Date.now()) < 60_000);

  const clock = formatClock(Date.now(), 0, enrolled.shortDeviceId);
  const row = {
    table: 'devices',
    id: deviceId,
    created: clock,
    deleted: null,
    fields: { name: 'Prueba de humo', kind: 'desktop', os: 'windows', firstSeenAt: Date.now() },
    clocks: { name: clock, kind: clock, os: clock, firstSeenAt: clock, syncDeleted: clock },
  };
  const pushed = await hub.push({ ...version, rows: [row] });
  check('subida aceptada', pushed.accepted.length === 1 && pushed.rejected.length === 0);
  const echo = await hub.push({ ...version, rows: [row] });
  check('el eco no sube la secuencia', echo.seq === pushed.seq, `seq ${echo.seq}`);

  const ahead = formatClock(Date.now() + 24 * 3600_000, 0, enrolled.shortDeviceId);
  const rejected = await hub.push({
    ...version,
    rows: [{ ...row, fields: { name: 'del futuro' }, clocks: { name: ahead } }],
  });
  check('reloj adelantado rechazado', rejected.rejected[0]?.reason === 'clock_ahead');

  const pulled = await hub.pull(pushed.seq - 1, 100, version);
  const back = pulled.rows.find((r) => r.id === deviceId);
  check('bajada devuelve la fila', back?.fields.name === 'Prueba de humo');

  const lease = await hub.claimJob({ kind: 'radar', key: `smoke-${deviceId}`, ttlSec: 60 });
  check('concesión concedida', lease.granted);
  const again = await hub.claimJob({ kind: 'radar', key: `smoke-${deviceId}`, ttlSec: 60 });
  check('segunda petición denegada', !again.granted);
  if (lease.granted) {
    const done = await hub.doneJob({ leaseId: lease.leaseId, outcome: 'ok' });
    check('concesión cerrada', done.closed);
  }

  const devices = (await admin('GET', '/devices')) as { tokenId: string; deviceId: string }[];
  const mine = devices.find((d) => d.deviceId === deviceId);
  check('aparece en la lista de dispositivos', mine !== undefined);
  if (mine) await admin('POST', `/devices/${mine.tokenId}/revoke`);
  await hub.status(version).then(
    () => check('token revocado ya no entra', false),
    (error: { code?: string }) =>
      check('token revocado ya no entra', error.code === 'unauthorized'),
  );
};

main().catch((error: unknown) => {
  console.error('[smoke] falló:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
