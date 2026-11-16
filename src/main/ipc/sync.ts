import { handle } from './contractHandlers';
import { getSyncRuntime } from '../sync/instance';
import type { PairRequest, SyncStatus } from '../../shared/sync/status';
import type { PairResult } from '../sync/runtime';

// El sync 2.0 visto desde Ajustes (AFTERPLAY-2.0.md §9.3): emparejar este PC
// con un hub, ver cómo va, forzar un ciclo y olvidar el hub. Revocar el
// dispositivo en el hub se hace desde la web, no desde aquí.
//
// Sin sync en este proceso (un test E2E) todo contesta "no disponible" en vez
// de fallar: la pantalla sigue pintándose.

const UNAVAILABLE: SyncStatus = {
  available: false,
  paired: false,
  hubUrl: null,
  running: false,
  lastPushAt: null,
  lastPullAt: null,
  problem: null,
  disabledReason: null,
};

export const registerSyncHandlers = (): void => {
  handle('sync:getStatus', (): SyncStatus => getSyncRuntime()?.status() ?? UNAVAILABLE);

  // Devuelve el resultado en vez de lanzar: un error lanzado cruza el IPC con
  // el prefijo "Error invoking remote method" y la frase ya viene redactada.
  handle(
    'sync:pair',
    async (_event, request: PairRequest): Promise<PairResult> =>
      getSyncRuntime()?.pair({
        hubUrl: String(request?.hubUrl ?? ''),
        code: String(request?.code ?? ''),
      }) ?? { ok: false, message: 'Sync is not available right now.' },
  );

  handle('sync:unpair', (): SyncStatus => getSyncRuntime()?.unpair() ?? UNAVAILABLE);

  handle('sync:syncNow', (): void => {
    getSyncRuntime()?.syncNow();
  });
};
