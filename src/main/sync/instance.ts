import type { SyncRuntime } from './runtime';

// El sync de este proceso, para quien lo pide sin haber visto cómo se creó
// (el IPC se registra ANTES de abrir la base; el sync se crea DESPUÉS). Sin
// nada (aún, o en un test E2E) los handlers contestan "sin sync".
let current: SyncRuntime | null = null;

export const setSyncRuntime = (runtime: SyncRuntime | null): void => {
  current = runtime;
};

export const getSyncRuntime = (): SyncRuntime | null => current;
