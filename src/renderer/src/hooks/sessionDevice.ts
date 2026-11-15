import { useDeviceContext } from './devices';
import { useNow } from './useNow';
import {
  formatSignalAge,
  hasNoSignal,
  isOwnLiveSession,
  signalAgeMs,
  type LiveSessionSignal,
} from '../../../shared/liveSession';

// Los hooks de "una sesión en vivo en otro dispositivo" (§10.8). Lo que se pinta
// con ellos vive en components/sessions/RemoteLive.tsx.

/**
 * "No signal for 7 min" si la sesión ajena lleva más de 3 minutos sin señal; si
 * no, null. Con `null` en la sesión no hace nada ni arranca ningún reloj.
 */
export const useNoSignalText = (session: LiveSessionSignal | null): string | null => {
  const now = useNow(session !== null);
  if (session === null || !hasNoSignal(session, now)) return null;
  return `No signal for ${formatSignalAge(signalAgeMs(session, now))}`;
};

// Lo que una fila de sesión necesita saber de su dispositivo (§10.8): si está
// abierta en OTRO PC (entonces se pinta "Playing on PC-A" y no "Live now"), su
// falta de señal, y el nombre para la lista (solo con más de un dispositivo
// conocido, para no ensuciar la vista de quien tiene un solo PC; y no en las
// manuales de la 1.x, que no se jugaron en ningún PC concreto).
export type SessionDeviceInfo = {
  readonly remote: boolean;
  readonly deviceName: string;
  readonly noSignal: string | null;
  readonly deviceTag: string | null;
};

export const useSessionDevice = (session: {
  readonly deviceId: string;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly lastHeartbeatAt: Date | null;
  readonly isManual: boolean;
}): SessionDeviceInfo => {
  const { thisDeviceId, hasSeveral, nameOf } = useDeviceContext();
  const remote = session.endedAt === null && !isOwnLiveSession(session, thisDeviceId);
  const noSignal = useNoSignalText(remote ? session : null);
  const deviceName = nameOf(session.deviceId);
  return {
    remote,
    deviceName,
    noSignal,
    deviceTag: hasSeveral && !session.isManual ? deviceName : null,
  };
};
