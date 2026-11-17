import type { DatabaseSync } from 'node:sqlite';
import type { LocalDatabase } from '../connection';
import { DEFAULT_CURRENCY } from '../queries/common/currency';
import { assertImportPathsAllowed, fileOf, type CutoverTarget } from './appData';
import {
  buildImportPlan,
  ImportBlockedError,
  type ImportPlan,
  type SourceTableCount,
} from './build';
import { claimInstalls, type ClaimReport } from './installs';
import type { LegacyQueryViews } from './legacyQueries';
import { resealMemorySignatures, type MemorySignatureReport } from './memorySignatures';
import { validateWithQueries, type QueryValidationReport } from './queryValidation';
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
// 3. En UNA transacción de la puerta: escribir "si no existe" (filas y mapa
//    de ids), recalcular las firmas de los recaps con los hechos ya escritos
//    (memorySignatures.ts), reclamar las instalaciones de este PC si se pide,
//    y validar. Si la validación falla, se deshace todo y se lanza
//    `ImportValidationError` con el informe.
//
// La validación tiene dos partes. La de `validate.ts` (recuentos, sumas,
// reglas de `shared/domain` sobre las filas, conciliación columna a columna)
// corre siempre. La de `queryValidation.ts` compara lo que DEVUELVEN las
// lecturas 1.x con lo que devuelven las consultas 2.0, para todos los juegos;
// corre cuando quien llama trae la foto de las lecturas 1.x
// (`legacyQueryViews`). Va así, y no siempre, porque esa foto solo se puede
// tomar con el código 1.x y su `getDb()` (asíncrono, fuera de la transacción;
// ver legacyQueries.ts): el importador no arrastra el driver de la 1.x. El
// script la toma siempre salvo que se le pida lo contrario, y el corte de la
// app (fase 10) tiene que pasarla: es una operación única y la foto cuesta
// segundos (ver el informe del ensayo).

export { ImportBlockedError } from './build';
export { LegacyNulTextError } from './source';
export { LEGACY_DEVICE_ID } from './build';
export { legacyUuid } from './legacyIds';
export type { ValidationReport } from './validate';
export type { LegacyQueryViews } from './legacyQueries';
export type { MemorySignatureReport } from './memorySignatures';
export { EXPECTED as EXPECTED_QUERY_DIFFERENCES } from './queryValidation';
export type { QueryValidationReport } from './queryValidation';

export interface ImportLegacyOptions {
  /** La base 1.x: su ruta (se abre en solo lectura) o una conexión ya abierta en solo lectura. */
  readonly source: string | DatabaseSync;
  /** La base 2.0, abierta con `openLocalDatabase`. */
  readonly target: LocalDatabase;
  /** Si se indica, tiene que ser el de `target` (el dueño de lo reclamado). */
  readonly deviceId?: string;
  /** Crear `game_installs`/`emulator_installs` de este PC para las rutas que existen aquí. */
  readonly claimInstalls?: boolean;
  /**
   * Hora de "ahora" (tests): la de lo reclamado y la que decide qué periodos
   * están cerrados al recalcular las firmas de los recaps. Las filas
   * importadas no la usan (llevan sus relojes antiguos).
   */
  readonly now?: number;
  /**
   * La foto de las lecturas 1.x sobre ESTE mismo origen
   * (`collectLegacyQueryViews`). Si se da, se valida también con las
   * consultas de verdad (queryValidation.ts).
   */
  readonly legacyQueryViews?: LegacyQueryViews;
  /**
   * Moneda de los gastos (D-23). Por defecto la de la 2.0 (`DEFAULT_CURRENCY`,
   * euros): la 1.x solo pinta euros, y así lo importado y lo nuevo no pueden
   * discrepar.
   */
  readonly currency?: string;
  /** Importar las sesiones abiertas cerradas en su último latido (§19.6 paso 3; el corte lo pide siempre). */
  readonly closeOpenSessions?: boolean;
  /** Desarrollo: seguir aunque el buzón tenga órdenes pendientes. */
  readonly devIgnorePendingMailbox?: boolean;
  /** Para los tests de instalaciones: qué rutas "existen". */
  readonly pathExists?: (path: string) => boolean;
  /**
   * Solo el corte de la fase 10 (§19.6): permite que la base 2.0 de destino
   * sea `Afterplay2.db` de esa carpeta de datos de la app, y ninguna otra
   * ruta dentro de ella. Sin esto, el importador no escribe nunca en la
   * carpeta de datos de la app ni de sus perfiles (appData.ts). El origen no
   * tiene excepción: tiene que ser una copia, nunca la base en uso.
   */
  readonly cutover?: CutoverTarget;
}

export interface ImportReport {
  /** Por tabla 1.x: leídas, importadas y descartadas con su motivo. */
  readonly source: Record<string, SourceTableCount>;
  /** Por tabla 2.0: previstas, insertadas y ya presentes (idénticas o no). */
  readonly target: Record<string, TargetTableCount>;
  readonly facts: Record<string, number>;
  readonly installs: ClaimReport | null;
  /** El recálculo de las firmas de los recaps (§19.5). */
  readonly memorySignatures: MemorySignatureReport;
  readonly validation: ValidationReport;
  /**
   * Lo que se comprobó del origen antes de construir el plan (revisión,
   * hallazgos 1 y 2). `futureStamps`: sellos de máquina posteriores a "ahora",
   * que no cuentan para el techo de los relojes (sus datos se importan tal
   * cual). `nulTexts`: textos con NUL; siempre 0 en un informe, porque con
   * alguno la importación se niega (`LegacyNulTextError`).
   */
  readonly sourceChecks: {
    readonly futureStamps: number;
    readonly futureStampsByColumn: Readonly<Record<string, number>>;
    readonly nulTexts: number;
  };
  /** La validación con las consultas, o null si no se trajo la foto 1.x. */
  readonly queryValidation: QueryValidationReport | null;
  readonly elapsedMs: number;
}

export class ImportValidationError extends Error {
  readonly report: ImportReport;

  constructor(report: ImportReport) {
    super(
      `La validación de la importación ha fallado: ${report.validation.differenceCount} diferencias en los ` +
        `valores derivados, ${report.validation.columns.differences} columna a columna y ` +
        `${report.queryValidation?.differenceCount ?? 0} con las consultas. No se ha escrito nada.`,
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
  assertImportPathsAllowed(
    typeof options.source === 'string' ? options.source : fileOf(options.source.location()),
    fileOf(target.db.$client.location()),
    options.cutover,
  );
  // "Ahora" antes de leer: el techo de los relojes no puede pasar de aquí (hallazgo 1).
  const now = options.now ?? Date.now();
  const data = withLegacySource(options.source, (db) => readLegacyData(db, { now }));
  if (data.pendingMailbox > 0 && !options.devIgnorePendingMailbox) {
    throw new ImportBlockedError(
      `El buzón del móvil tiene ${data.pendingMailbox} orden(es) pendiente(s). Abre la 1.x para que se apliquen ` +
        'antes de importar (§19.7).',
    );
  }
  const plan: ImportPlan = buildImportPlan(data, {
    currency: options.currency ?? DEFAULT_CURRENCY,
    closeOpenSessions: options.closeOpenSessions ?? false,
  });
  if (data.pendingMailbox > 0) {
    plan.facts['órdenes pendientes del buzón ignoradas (opción de desarrollo)'] =
      data.pendingMailbox;
  }

  const futureStamps = Object.values(data.futureStamps).reduce((sum, n) => sum + n, 0);
  return target.store.transaction(() => {
    const written = writePlan(target.db.$client, plan);
    const signatures = resealMemorySignatures(
      target,
      plan,
      new Date(now),
      written.insertedIds.get('generated_memories') ?? new Set(),
    );
    const installs = options.claimInstalls
      ? claimInstalls(target, plan.context, { pathExists: options.pathExists, now })
      : null;
    const validation = validateImport(target.db.$client, plan, {
      memoryHashes: signatures.expected,
    });
    const queryValidation = options.legacyQueryViews
      ? validateWithQueries({
          target,
          context: plan.context,
          legacy: options.legacyQueryViews,
          memories: signatures.expected,
          now: new Date(now),
          claimedInstalls: installs !== null,
        })
      : null;
    const report: ImportReport = {
      source: plan.source,
      target: written.counts,
      facts: plan.facts,
      installs,
      memorySignatures: signatures.report,
      validation,
      sourceChecks: {
        futureStamps,
        futureStampsByColumn: data.futureStamps,
        nulTexts: 0,
      },
      queryValidation,
      elapsedMs: Math.round(performance.now() - started),
    };
    if (!validation.ok || (queryValidation !== null && !queryValidation.ok)) {
      throw new ImportValidationError(report);
    }
    return report;
  });
}

/** Solo construye el plan (sin escribir): para tests y diagnósticos. */
export function planLegacyImport(
  source: string | DatabaseSync,
  options: { currency?: string; closeOpenSessions?: boolean; now?: number } = {},
): ImportPlan {
  const now = options.now ?? Date.now();
  const data = withLegacySource(source, (db) => readLegacyData(db, { now }));
  return buildImportPlan(data, {
    currency: options.currency ?? DEFAULT_CURRENCY,
    closeOpenSessions: options.closeOpenSessions ?? false,
  });
}
