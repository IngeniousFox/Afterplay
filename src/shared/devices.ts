// LOS DISPOSITIVOS COMO LOS VE LA INTERFAZ (AFTERPLAY-2.0.md §10.8 y §11.4).
//
// Un dispositivo es cada PC (o el móvil) que escribe en la misma base. La
// interfaz solo necesita saber cómo se llaman, si es este y poco más: las
// rutas y la demás intimidad de un PC no salen de su fila (§11.4, F-31).

export type DeviceInfo = {
  readonly id: string;
  readonly name: string;
  /** `devices.os` tal cual ('windows', 'web'…); la interfaz no lo interpreta. */
  readonly os: string;
  readonly isThisDevice: boolean;
};

/** Cómo se nombra un dispositivo que esta base aún no conoce (sync a medias). */
export const UNKNOWN_DEVICE_NAME = 'another PC';

/** El nombre del dispositivo `deviceId`, o "another PC" si no consta. */
export const deviceNameFor = (devices: readonly DeviceInfo[], deviceId: string): string =>
  devices.find((device) => device.id === deviceId)?.name.trim() || UNKNOWN_DEVICE_NAME;

/**
 * ¿Hay más de un dispositivo conocido? Solo entonces la interfaz enseña en qué
 * dispositivo se jugó cada sesión: quien tiene un solo PC no necesita ese ruido.
 */
export const hasSeveralDevices = (devices: readonly DeviceInfo[]): boolean => devices.length > 1;

// Una instalación de un juego en un dispositivo, SIN ruta (§11.4: "Instalado
// en: PC-A, PC-B"). La ruta de otro PC no cruza nunca el IPC.
export type InstalledOn = {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly isThisDevice: boolean;
};

// Lo que dice la comprobación del ejecutable de ESTE PC (§11.3). Nunca se
// escribe en la base: es una lectura del disco cada vez que se pide.
//  · 'present'  — el ejecutable existe.
//  · 'missing'  — la instalación consta pero el fichero ya no está.
//  · 'none'     — este PC no tiene instalación (o no tiene ejecutable).
export type ExecutableStatus = 'present' | 'missing' | 'none';

// Lo que la ficha pregunta de las instalaciones del juego (games:getInstallInfo).
export type GameInstallInfo = {
  readonly installedOn: readonly InstalledOn[];
  readonly executable: ExecutableStatus;
};

/**
 * ¿Hay que enseñar "Installed on"? Con un solo dispositivo conocido es ruido,
 * salvo que el juego no esté instalado aquí pero sí en otro (§11.4), que ya es
 * información que explica por qué Play está apagado.
 */
export const shouldShowInstalledOn = (
  installedOn: readonly InstalledOn[],
  knownDevices: number,
): boolean => {
  if (installedOn.length === 0) return false;
  if (knownDevices > 1) return true;
  return !installedOn.some((install) => install.isThisDevice);
};
