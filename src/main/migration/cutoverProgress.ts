// PUENTE 1.x → L3: se va con el orquestador (`cutover.ts`).
//
// La marca de progreso del corte en disco y la decisión de si hace falta
// cortar en este arranque. Sin Electron: se prueba con carpetas temporales.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { legacyDatabasePath, localDatabasePath } from '../db/v2/runtime';
import type { CutoverProgress, ProgressStore } from './cutover';

/** Fichero de progreso, junto a las bases (no se sincroniza; no lleva secretos). */
export const CUTOVER_PROGRESS_FILE = 'cutover-progress.json';

const progressSchema = z.object({
  version: z.literal(1),
  role: z.enum(['migrator', 'secondary', 'local']),
  startedAt: z.number(),
  imported: z.boolean().optional(),
  laggingAck: z.boolean().optional(),
  localDone: z.boolean().optional(),
  seeded: z.boolean().optional(),
  completed: z.boolean().optional(),
});

/** La marca de progreso en un fichero JSON; una ilegible cuenta como "no hay". */
export const createFileProgressStore = (userDataDir: string): ProgressStore => {
  const path = join(userDataDir, CUTOVER_PROGRESS_FILE);
  return {
    read(): CutoverProgress | null {
      try {
        return progressSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      } catch {
        return null;
      }
    },
    write(progress) {
      // Escritura atómica: un cierre a mitad no deja un JSON cortado.
      const temp = `${path}.tmp`;
      writeFileSync(temp, JSON.stringify(progress, null, 2));
      renameSync(temp, path);
    },
    clear() {
      rmSync(path, { force: true });
      rmSync(`${path}.tmp`, { force: true });
    },
  };
};

export interface CutoverTrigger {
  readonly userDataDir: string;
  /** Un test e2e: el corte no existe nunca. */
  readonly isE2E: boolean;
  /** El perfil de desarrollo: sigue importando solo, sin Turso, salvo `force`. */
  readonly isDevProfile: boolean;
  /** Forzar el corte real en un perfil de desarrollo (nunca en un e2e). */
  readonly force: boolean;
}

/**
 * ¿Hay que hacer el corte en este arranque? Sí si hay una `Afterplay.db` 1.x y
 * este PC aún no migró: no hay `Afterplay2.db`, o hay una marca de progreso sin
 * terminar (§19.6). El perfil de desarrollo y los e2e se saltan el corte (su
 * importación automática de `db/v2/runtime.ts` no usa Turso), salvo `force`.
 */
export function cutoverNeeded(trigger: CutoverTrigger, store?: ProgressStore): boolean {
  if (trigger.isE2E) return false;
  if (trigger.isDevProfile && !trigger.force) return false;
  if (!existsSync(legacyDatabasePath(trigger.userDataDir))) return false;
  if (!existsSync(localDatabasePath(trigger.userDataDir))) return true;
  const progress = (store ?? createFileProgressStore(trigger.userDataDir)).read();
  return progress !== null && progress.completed !== true;
}
