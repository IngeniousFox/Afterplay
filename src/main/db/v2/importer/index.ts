import type { DatabaseSync } from 'node:sqlite';
import type { LocalDatabase } from '../connection';
import {
  buildImportPlan,
  ImportBlockedError,
  type ImportPlan,
  type SourceTableCount,
} from './build';
import { claimInstalls, type ClaimReport } from './installs';
import { readLegacyData, withLegacySource } from './source';
import { validateImport, type ValidationReport } from './validate';
import { writePlan, type TargetTableCount } from './write';

// IMPORTADOR 1.x → 2.0 (AFTERPLAY-2.0.md §19.5), primera versión.
//
// Puro respecto a Electron: sin `app`, sin IPC. Lo llaman el script
// `scripts/import-1x-to-v2.ts` y, más adelante, el arranque de la app.
//
// Pasos:
// 1. Leer el origen entero (solo lectura) y negarse a seguir si tiene
//    sesiones abiertas u órdenes pendientes en el buzón (§19.7).
// 2. Construir el plan: todas las filas 2.0 con ids y relojes deterministas
//    (build.ts). Mismo origen → mismo plan, en cualquier PC.
// 3. En UNA transacción de la puerta: escribir "si no existe", reclamar las
//    instalaciones de este PC si se pide, y validar. Si la validación falla,
//    se deshace todo y se lanza `ImportValidationError` con el informe.

export { ImportBlockedError } from './build';
export { LEGACY_DEVICE_ID } from './build';
export { legacyUuid } from './legacyIds';
export type { ValidationReport } from './validate';

export interface ImportLegacyOptions {
  /** La base 1.x: su ruta (se abre en solo lectura) o una conexión ya abierta en solo lectura. */
  readonly source: string | DatabaseSync;
  /** La base 2.0, abierta con `openLocalDatabase`. */
  readonly target: LocalDatabase;
  /** Si se indica, tiene que ser el de `target` (el dueño de lo reclamado). */
  readonly deviceId?: string;
  /** Crear `game_installs`/`emulator_installs` de este PC para las rutas que existen aquí. */
  readonly claimInstalls?: boolean;
  /** Hora de "ahora" para lo reclamado (tests). Lo importado no la usa. */
  readonly now?: number;
  /** Moneda de los gastos (D-23). Por defecto EUR: la 1.x solo pinta euros. */
  readonly currency?: string;
  /** Desarrollo: importar las sesiones abiertas cerradas en su último latido. */
  readonly devCloseOpenSessions?: boolean;
  /** Desarrollo: seguir aunque el buzón tenga órdenes pendientes. */
  readonly devIgnorePendingMailbox?: boolean;
  /** Para los tests de instalaciones: qué rutas "existen". */
  readonly pathExists?: (path: string) => boolean;
}

export interface ImportReport {
  /** Por tabla 1.x: leídas, importadas y descartadas con su motivo. */
  readonly source: Record<string, SourceTableCount>;
  /** Por tabla 2.0: previstas, insertadas y ya presentes (idénticas o no). */
  readonly target: Record<string, TargetTableCount>;
  readonly facts: Record<string, number>;
  readonly installs: ClaimReport | null;
  readonly validation: ValidationReport;
  readonly elapsedMs: number;
}

export class ImportValidationError extends Error {
  readonly report: ImportReport;

  constructor(report: ImportReport) {
    super(
      `La validación de la importación ha fallado: ${report.validation.differenceCount} diferencias en los ` +
        `valores derivados y ${report.validation.columns.differences} columna a columna. No se ha escrito nada.`,
    );
    this.name = 'ImportValidationError';
    this.report = report;
  }
}

export function importLegacyDatabase(options: ImportLegacyOptions): ImportReport {
  const started = performance.now();
  const { target } = options;
  if (options.deviceId !== undefined && options.deviceId !== target.deviceId) {
    throw new Error('importLegacyDatabase: deviceId no coincide con el de la base 2.0');
  }
  const data = withLegacySource(options.source, readLegacyData);
  if (data.pendingMailbox > 0 && !options.devIgnorePendingMailbox) {
    throw new ImportBlockedError(
      `El buzón del móvil tiene ${data.pendingMailbox} orden(es) pendiente(s). Abre la 1.x para que se apliquen ` +
        'antes de importar (§19.7).',
    );
  }
  const plan: ImportPlan = buildImportPlan(data, {
    currency: options.currency ?? 'EUR',
    devCloseOpenSessions: options.devCloseOpenSessions ?? false,
  });
  if (data.pendingMailbox > 0) {
    plan.facts['órdenes pendientes del buzón ignoradas (opción de desarrollo)'] =
      data.pendingMailbox;
  }

  return target.store.transaction(() => {
    const written = writePlan(target.db.$client, plan);
    const installs = options.claimInstalls
      ? claimInstalls(target, plan.context, {
          pathExists: options.pathExists,
          now: options.now ?? Date.now(),
        })
      : null;
    const validation = validateImport(target.db.$client, plan);
    const report: ImportReport = {
      source: plan.source,
      target: written,
      facts: plan.facts,
      installs,
      validation,
      elapsedMs: Math.round(performance.now() - started),
    };
    if (!validation.ok) throw new ImportValidationError(report);
    return report;
  });
}

/** Solo construye el plan (sin escribir): para tests y diagnósticos. */
export function planLegacyImport(
  source: string | DatabaseSync,
  options: { currency?: string; devCloseOpenSessions?: boolean } = {},
): ImportPlan {
  const data = withLegacySource(source, readLegacyData);
  return buildImportPlan(data, {
    currency: options.currency ?? 'EUR',
    devCloseOpenSessions: options.devCloseOpenSessions ?? false,
  });
}
