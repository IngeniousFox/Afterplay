import type { SchedulerTimers } from './scheduler';
import { realTimers } from './scheduler';

// "La red ha vuelto" (§8.5). Electron no avisa de ello en el proceso principal
// (`net.online` existe, pero no hay evento), así que se pregunta cada pocos
// segundos y se avisa solo en el paso de sin-red a con-red. Es una pregunta al
// sistema, no una petición: no cuesta tráfico.

export const NETWORK_POLL_MS = 10_000;

export interface NetworkWatch {
  stop(): void;
}

export function watchNetworkBack(options: {
  readonly isOnline: () => boolean;
  readonly onBack: () => void;
  readonly intervalMs?: number;
  readonly timers?: SchedulerTimers;
}): NetworkWatch {
  const timers = options.timers ?? realTimers;
  const interval = options.intervalMs ?? NETWORK_POLL_MS;
  let wasOnline = options.isOnline();
  let handle: unknown = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    const online = options.isOnline();
    if (online && !wasOnline) options.onBack();
    wasOnline = online;
    handle = timers.setTimeout(tick, interval);
  };
  handle = timers.setTimeout(tick, interval);

  return {
    stop: () => {
      stopped = true;
      if (handle !== null) timers.clearTimeout(handle);
    },
  };
}
