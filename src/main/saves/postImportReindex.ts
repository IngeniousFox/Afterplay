import { appCtx } from '../db/v2/appDb';
import {
  isSaveReindexPending,
  recordSaveReindexRun,
  seedOwnLastSyncedHashes,
} from '../db/v2/queries/saves';
import { recoverIndexFromCloud } from './recovery';
import * as r2 from './r2';

// Reindexado de las partidas tras importar la 1.x (AFTERPLAY-2.0.md §19.5-19.6).
//
// El importador no migra `save_backups`: lo único que hace restaurable una
// copia es su fila, y el bucket se explica solo. Tras importar, `runtime.ts`
// deja un marcador local (`markSaveReindexPending`) y esto lo cumple FUERA de
// la importación y sin bloquear el arranque, en cuanto hay credenciales:
//
//   1. `recoverIndexFromCloud`: recrea las filas desde el bucket; la huella de
//      cada versión (`contentHash`) sale de su mapping.yaml.
//   2. `seedOwnLastSyncedHashes`: `lastSyncedHash` de cada juego = huella de la
//      última copia de ESTE PC.
//
// Si no hay credenciales, o algo falla, el marcador sigue ahí y se reintenta
// (en el siguiente arranque y en el tic horario de los trabajos de fondo).
// Las dos fases son idempotentes: repetirlas no duplica filas ni pisa huellas.

export type PostImportReindexOutcome =
  | { status: 'not_pending' }
  | { status: 'not_configured' }
  | { status: 'running' }
  | { status: 'failed'; error: string }
  | { status: 'done'; recovered: number; seeded: number };

let running = false;

/** Cumple el reindexado pendiente, si lo hay y si se puede ahora. Nunca lanza. */
export async function runPendingSaveReindex(): Promise<PostImportReindexOutcome> {
  const ctx = appCtx();
  if (!isSaveReindexPending(ctx)) return { status: 'not_pending' };
  // Sin credenciales (o perfil de desarrollo con un bucket que no es el suyo)
  // no se cuenta como intento: el marcador espera.
  if (!r2.isR2Configured()) return { status: 'not_configured' };
  if (running) return { status: 'running' };
  running = true;
  try {
    const result = await recoverIndexFromCloud();
    // Una carpeta sin mapping.yaml legible no se reintenta en bucle: es un
    // estado del bucket, no un fallo transitorio (los fallos de red lanzan).
    // Queda a la vista del inventario de la nube (scanBucket).
    if (result.unreadableFolders > 0) {
      console.warn(`[saves] ${result.unreadableFolders} carpeta(s) del bucket sin mapping legible`);
    }
    const seeded = seedOwnLastSyncedHashes(ctx);
    recordSaveReindexRun(ctx, { ok: true });
    console.log(
      `[saves] reindexado tras la migración: ${result.recovered} copia(s), ${seeded} huella(s) sembradas`,
    );
    return { status: 'done', recovered: result.recovered, seeded };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordSaveReindexRun(ctx, { ok: false, error: message });
    console.warn('[saves] el reindexado tras la migración falló (se reintentará):', message);
    return { status: 'failed', error: message };
  } finally {
    running = false;
  }
}
