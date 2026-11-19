import { ApiFailure } from '../api';
import type { DeviceDto } from '../api';
import { formatDate, relativeDay } from './format';

// Los dispositivos revocados siguen en la lista del hub (con `revokedAt`), pero
// a la persona no le sirven de nada: ya no sincronizan y no se pueden revivir.
export const activeDevices = (devices: readonly DeviceDto[]): DeviceDto[] =>
  devices.filter((device) => device.revokedAt === null);

// "Last seen" cuando el PC ya ha hablado con el hub; si nunca lo ha hecho (se
// emparejó y no ha llegado a sincronizar), cuándo se añadió.
export const deviceSeenLabel = (device: DeviceDto): string =>
  device.lastUsedAt === null
    ? `Added ${formatDate(device.createdAt)}, hasn't synced yet`
    : `Last seen ${relativeDay(device.lastUsedAt).toLowerCase()}`;

// Lo que queda del código, como m:ss. Redondea hacia arriba: con 0,4 s por
// delante todavía se puede teclear, y "0:00" con el código vivo confundiría.
export const formatCountdown = (msLeft: number): string => {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

// Los mensajes del hub son notas en español; la interfaz está en inglés. Aquí
// se traducen por CÓDIGO los errores de una invitación.
export const inviteErrorMessage = (error: unknown): string => {
  if (error instanceof ApiFailure) {
    switch (error.code) {
      case 'invalid_request':
        return "That doesn't look like a valid email address.";
      case 'conflict':
        return 'That person already has their own Afterplay space.';
      case 'forbidden':
        return 'Only the owner of this Afterplay can invite people.';
      default:
        return error.message;
    }
  }
  return 'Something went wrong. Try again.';
};
