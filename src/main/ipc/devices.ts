import { handle } from './contractHandlers';
import { appCtx } from '../db/v2/appDb';
import { getDevices } from '../db/v2/queries/devices';
import type { DeviceInfo } from '../../shared/devices';

// Los dispositivos que conoce esta base, para "Playing on PC-A" (§10.8) y
// "Installed on" (§11.4). Solo lectura: id, nombre, sistema y si es este PC.
export const registerDevicesHandlers = (): void => {
  handle('devices:getAll', async (): Promise<DeviceInfo[]> => getDevices(appCtx()));
};
