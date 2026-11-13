import { LOCAL, T0, fakeWall, openTestDb } from '../../../__tests__/helpers';
import { createQueryContext, ensureThisDevice } from '../../common';
import type { QueryFixture } from '../../common/__tests__/fixtures';
import { saveMaintenanceForeignWriteRule } from '../maintenanceRule';

// Como `openQueryDb` de common, pero con la regla de R-13 registrada en la
// puerta (como hará el cambio final al abrir la base) o sin ella, para probar
// que sin registrarla todo sigue prohibido. Datos inventados.

export interface OpenSavesDbOptions {
  /** Por defecto true: la regla de mantenimiento registrada. */
  readonly withRule?: boolean;
}

export function openSavesDb(options: OpenSavesDbOptions = {}): QueryFixture {
  const wall = fakeWall(T0);
  const local = openTestDb({
    deviceId: LOCAL,
    wall: wall.wall,
    foreignWriteRules: (options.withRule ?? true) ? [saveMaintenanceForeignWriteRule] : [],
  });
  const ctx = createQueryContext(local, { now: () => new Date(wall.wall()) });
  ensureThisDevice(ctx, {
    name: 'PC-A',
    home: 'C:/Users/ana',
    appVersion: '2.0.0-test',
    schemaVersion: 1,
    now: ctx.now(),
  });
  return { local, ctx, wall, close: () => local.close() };
}
