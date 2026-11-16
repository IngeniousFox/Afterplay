import type { Tray } from 'electron';
import type { ScanWatcher } from '../scan/watcher';
import type { NetworkWatch } from '../sync/networkWatch';
import type { SyncRuntime } from '../sync/runtime';
import type { ProcessWatcher } from '../watcher/watcher';

// Las piezas vivas del proceso principal que varias fases del arranque y el
// cierre necesitan alcanzar. Un único dueño: cada fase las asigna al crearlas y
// el cierre (lifecycle/quit.ts) las para, sin pasarse referencias de mano en
// mano. Todo es null hasta que su fase corre.
export const appState: {
  watcher: ProcessWatcher | null;
  scanWatcher: ScanWatcher | null;
  tray: Tray | null;
  // El sync 2.0 (AFTERPLAY-2.0.md §8.5). Sin hub emparejado, o en un test E2E,
  // no hace nada.
  syncRuntime: SyncRuntime | null;
  networkWatch: NetworkWatch | null;
  // El tic de la detección de recaps (AFTERPLAY-LOOP.md §3.3). Cada hora, pero
  // el trabajo real solo pasa una vez por día de calendario (ver
  // memories/detect.ts) — el intervalo corto es solo para no perder el cambio
  // de día por mucho que la app viva en la bandeja.
  memoriesTimer: ReturnType<typeof setInterval> | null;
} = {
  watcher: null,
  scanWatcher: null,
  tray: null,
  syncRuntime: null,
  networkWatch: null,
  memoriesTimer: null,
};
