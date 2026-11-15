// UNA SESIÓN EN VIVO EN OTRO DISPOSITIVO (AFTERPLAY-2.0.md §10.8).
//
// Una sesión abierta de otro PC se pinta "Playing on PC-A" y sin botón Stop:
// solo su dueño la cierra (§10.1). Dos excepciones, ambas aquí y no repartidas
// por la interfaz:
//  · un CRONÓMETRO (`startedBy === 'timer'`) lo para cualquier PC, porque lo
//    abrió una persona a mano (móvil o escritorio) y otra persona lo cierra;
//  · si lleva más de 3 minutos sin señal, se dice ("No signal for X") para que
//    nadie espere a un PC apagado. No se cierra sola por eso: la limpieza es
//    del barrido del hub (§10.5).

/** Cuánto puede callarse una sesión ajena antes de avisar de que no hay señal. */
export const NO_SIGNAL_AFTER_MS = 3 * 60_000;

// Lo mínimo que hace falta saber de una sesión abierta. `lastHeartbeatAt` es la
// señal de vida SINCRONIZADA (`lastSeenAt`, cada ≥60 s), no el latido local.
export type LiveSessionSignal = {
  readonly startedAt: Date;
  readonly lastHeartbeatAt: Date | null;
};

/** La última señal de vida, o el arranque si nunca llegó a latir. */
export const lastSignalAt = (session: LiveSessionSignal): Date =>
  session.lastHeartbeatAt ?? session.startedAt;

/** Cuánto lleva sin dar señal (nunca negativo: relojes de dos PCs no cuadran). */
export const signalAgeMs = (session: LiveSessionSignal, now: number): number =>
  Math.max(0, now - lastSignalAt(session).getTime());

/** ¿Lleva más de 3 minutos sin señal? Justo 3 minutos todavía no. */
export const hasNoSignal = (session: LiveSessionSignal, now: number): boolean =>
  signalAgeMs(session, now) > NO_SIGNAL_AFTER_MS;

/** "4 min", "2 h 5 min", "1 d 3 h": para "No signal for X". */
export const formatSignalAge = (ms: number): string => {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
};

export type LiveSessionOwner = {
  readonly deviceId: string;
  readonly startedBy: string;
};

/** ¿La sesión abierta es de este dispositivo? */
export const isOwnLiveSession = (
  session: Pick<LiveSessionOwner, 'deviceId'>,
  thisDeviceId: string | null,
): boolean => thisDeviceId === null || session.deviceId === thisDeviceId;

/**
 * ¿Un juego de la biblioteca está en vivo en OTRO dispositivo? (`liveDeviceId`
 * es el de este PC si hay una propia abierta, así que "ajeno" = solo ajenas.)
 */
export const isLiveElsewhere = (
  game: { readonly isLive: boolean; readonly liveDeviceId?: string | null },
  thisDeviceId: string | null,
): boolean =>
  game.isLive &&
  thisDeviceId !== null &&
  game.liveDeviceId !== undefined &&
  game.liveDeviceId !== null &&
  game.liveDeviceId !== thisDeviceId;

/**
 * ¿Se puede parar desde este PC? La propia, siempre; la ajena solo si es un
 * cronómetro. `sessions:close` cierra con `closedBy: 'user'`, que es lo que
 * permite el cierre de un cronómetro desde otro dispositivo.
 *
 * Con `thisDeviceId` null (la lista de dispositivos aún no ha llegado) se
 * trata como propia: es el comportamiento de antes y dura un parpadeo.
 */
export const canStopLiveSession = (
  session: LiveSessionOwner,
  thisDeviceId: string | null,
): boolean => isOwnLiveSession(session, thisDeviceId) || session.startedBy === 'timer';
