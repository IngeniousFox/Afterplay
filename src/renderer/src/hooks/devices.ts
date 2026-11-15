import type { UseQueryResult } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { deviceNameFor, hasSeveralDevices, type DeviceInfo } from '../../../shared/devices';
import { queryKeys } from './queryKeys';

// Los dispositivos vivos que conoce la base (§10.8, §11.4). Mismo staleTime
// Infinity que el resto: los invalida el aviso de cambios del main
// (useWatcherSync), que es también por donde llega lo que trae el sync.
export const useDevices = (): UseQueryResult<DeviceInfo[], Error> =>
  useQuery({
    queryKey: queryKeys.devices.all,
    queryFn: () => window.api.devices.getAll(),
    staleTime: Infinity,
  });

const NO_DEVICES: readonly DeviceInfo[] = [];

export type DeviceContext = {
  readonly devices: readonly DeviceInfo[];
  /** El id de este PC; null mientras la lista no ha llegado (o falta su fila). */
  readonly thisDeviceId: string | null;
  /** Más de un dispositivo conocido: solo entonces se enseña el dispositivo de cada sesión. */
  readonly hasSeveral: boolean;
  /** Nombre de un dispositivo, o "another PC" si no se conoce. */
  readonly nameOf: (deviceId: string) => string;
};

// Lo que casi todos los sitios que pintan sesiones necesitan de los
// dispositivos, ya resuelto. Memoizado sobre `data` para que quien lo pasa por
// props o dependencias no se re-renderice sin motivo.
export const useDeviceContext = (): DeviceContext => {
  const { data } = useDevices();
  return useMemo((): DeviceContext => {
    const devices = data ?? NO_DEVICES;
    return {
      devices,
      thisDeviceId: devices.find((device) => device.isThisDevice)?.id ?? null,
      hasSeveral: hasSeveralDevices(devices),
      nameOf: (deviceId) => deviceNameFor(devices, deviceId),
    };
  }, [data]);
};
