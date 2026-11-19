// Tipos de la API v2 de la PWA: la cuenta (quién soy), los dispositivos y las
// invitaciones. Las fechas viajan como milisegundos epoch, igual que en el
// protocolo de sincronización.

/** `GET /me`. `isHost`: es el anfitrión (ADMIN_EMAIL) y puede invitar. */
export interface MeResponse {
  readonly email: string;
  readonly isHost: boolean;
}

/** `POST /devices/enroll-code`. El código es de un solo uso y caduca. */
export interface EnrollCodeResponse {
  readonly code: string;
  readonly expiresAt: number;
}

/** Un dispositivo emparejado, tal como lo lista `GET /devices`. Nunca lleva el secreto del token. */
export interface DeviceDto {
  readonly tokenId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly shortDeviceId: string;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
}

/** `POST /devices/:tokenId/revoke`. */
export interface RevokeDeviceResponse {
  readonly revoked: boolean;
}

/** `POST /invitations` (201). */
export interface InvitationDto {
  readonly email: string;
  readonly invitedBy: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly acceptedAt: number | null;
}
