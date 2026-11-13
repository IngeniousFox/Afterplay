import type { DatabaseSync } from 'node:sqlite';
import { sameValue } from '../../../../shared/sync/fieldClocks';
import type { ImportContext } from './build';
import {
  LEGACY_COLUMN_MAP,
  type ColumnFate,
  type Expectation,
  type ReconcileContext,
  type Row,
} from './columnMap';
import type { LegacyData } from './source';

// Conciliación COLUMNA A COLUMNA entre el origen 1.x y el destino 2.0.
//
// Recorre todas las filas del origen y, para cada columna, comprueba en el
// destino lo que declara `columnMap.ts` (igualdad exacta: texto, números,
// fechas por milisegundos, JSON por estructura, null frente a null). Los
// recuentos y los valores derivados de `validate.ts` no ven que se pierda una
// nota o una valoración; esto sí. Cualquier diferencia hace fallar la
// validación. El informe solo lleva ids antiguos y nombres de columna, nunca
// el contenido.

export interface ColumnReport {
  readonly fate: ColumnFate;
  readonly to: string;
  /** Filas del origen que pasaron por esta columna. */
  rows: number;
  /** Valores comparados en el destino (una fila puede dar varios). */
  compared: number;
  matches: number;
  differences: number;
  discarded: Record<string, number>;
}

export interface ColumnDifference {
  readonly legacyTable: string;
  readonly legacyId: number | string;
  readonly column: string;
  /** Dónde se esperaba el valor (`tabla.columna`), sin el valor. */
  readonly target: string;
  readonly kind: 'distinto' | 'falta la fila' | 'sobra la fila';
}

export interface ColumnReconciliation {
  readonly tables: Record<string, Record<string, ColumnReport>>;
  readonly compared: number;
  readonly differences: number;
  /** Las primeras diferencias (acotadas). */
  readonly sample: ColumnDifference[];
}

const MAX_SAMPLE = 200;

/** Filas del origen de cada tabla, tal como se importaron. */
function sourceRows(data: LegacyData, ctx: ImportContext): Record<string, readonly Row[]> {
  return {
    games: data.games,
    radar_games: data.radarGames,
    // Las sesiones con las abiertas ya cerradas si se pidió (opción de desarrollo).
    sessions: ctx.sessions,
    iterations: data.iterations,
    state_events: data.stateEvents,
    emulators: data.emulators,
    curiosities: data.curiosities,
    achievements: data.achievements,
    achievement_unlocks: data.unlocks,
    generated_memories: data.memories,
    spend_events: data.spendEvents,
  };
}

/** Recuentos de las tablas cuyas filas no se leen. */
function unreadCounts(data: LegacyData): Record<string, number> {
  return { save_backups: data.saveBackupCount, plan_mailbox: data.mailboxCount };
}

export function reconcileContext(ctx: ImportContext): ReconcileContext {
  const curiosityIndex = new Map<number, number>();
  const byGame = new Map<number, number[]>();
  for (const c of ctx.data.curiosities) {
    const list = byGame.get(Number(c.gameId)) ?? [];
    list.push(Number(c.id));
    byGame.set(Number(c.gameId), list);
  }
  for (const list of byGame.values()) {
    list.sort((a, b) => a - b).forEach((id, index) => curiosityIndex.set(id, index));
  }
  const iterationPosition = new Map<number, number>();
  const iterationsByGame = new Map<number, number[]>();
  for (const i of ctx.data.iterations) {
    if (ctx.droppedIterations.has(Number(i.id))) continue;
    const list = iterationsByGame.get(Number(i.gameId)) ?? [];
    list.push(Number(i.id));
    iterationsByGame.set(Number(i.gameId), list);
  }
  for (const list of iterationsByGame.values()) {
    list.sort((a, b) => a - b).forEach((id, index) => iterationPosition.set(id, index + 1));
  }
  const catalogSourcesByGame = new Map<number, Set<'steam' | 'ra'>>();
  for (const entry of ctx.classified) {
    const gameId = Number(entry.achievement.gameId);
    const set = catalogSourcesByGame.get(gameId) ?? new Set();
    for (const source of entry.sources) set.add(source);
    catalogSourcesByGame.set(gameId, set);
  }
  return {
    ...ctx,
    curiosityIndex,
    iterationPosition,
    achievementsById: new Map(ctx.data.achievements.map((a) => [Number(a.id), a])),
    catalogSourcesByGame,
  };
}

/** Lector perezoso del destino: cada tabla se carga entera una vez. */
class TargetReader {
  private readonly tables = new Map<string, Map<string, Record<string, unknown>>>();
  private readonly parsed = new Map<string, unknown>();

  constructor(private readonly client: DatabaseSync) {}

  row(table: string, id: string): Record<string, unknown> | undefined {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = new Map();
      if (table === 'local_legacy_ids') {
        for (const row of this.client.prepare('SELECT * FROM "local_legacy_ids"').all()) {
          rows.set(`${String(row.legacyTable)}:${String(row.legacyId)}`, { ...row });
        }
      } else {
        for (const row of this.client.prepare(`SELECT * FROM "${table}"`).all()) {
          rows.set(String(row.id), { ...row });
        }
      }
      this.tables.set(table, rows);
    }
    return rows.get(id);
  }

  /** Valor de una columna JSON, ya parseado (una vez por celda). */
  json(table: string, id: string, column: string, text: unknown): unknown {
    const key = `${table}\u0000${id}\u0000${column}`;
    if (!this.parsed.has(key)) {
      let value: unknown;
      try {
        value = typeof text === 'string' ? JSON.parse(text) : text;
      } catch {
        value = Symbol('JSON inválido');
      }
      this.parsed.set(key, value);
    }
    return this.parsed.get(key);
  }
}

function satisfied(
  reader: TargetReader,
  expectation: Expectation,
): 'ok' | 'distinto' | 'falta la fila' | 'sobra la fila' {
  const row = reader.row(expectation.table, expectation.id);
  if ('absent' in expectation) return row === undefined ? 'ok' : 'sobra la fila';
  if (row === undefined) return 'falta la fila';
  let actual: unknown = row[expectation.column] ?? null;
  if (expectation.json)
    actual = reader.json(expectation.table, expectation.id, expectation.column, actual);
  if (expectation.pick) actual = expectation.pick(actual);
  if ('test' in expectation) return expectation.test(actual) ? 'ok' : 'distinto';
  let expected = expectation.value ?? null;
  if (expectation.json && typeof expected === 'string' && !expectation.pick) {
    try {
      expected = JSON.parse(expected);
    } catch {
      return 'distinto';
    }
  }
  // `undefined` (un elemento que no está en el agregado) nunca coincide.
  if (actual === undefined) return 'distinto';
  return sameValue(actual, expected) ? 'ok' : 'distinto';
}

export function reconcileColumns(
  client: DatabaseSync,
  importContext: ImportContext,
): ColumnReconciliation {
  const ctx = reconcileContext(importContext);
  const reader = new TargetReader(client);
  const rowsByTable = sourceRows(ctx.data, ctx);
  const unread = unreadCounts(ctx.data);
  const tables: Record<string, Record<string, ColumnReport>> = {};
  const sample: ColumnDifference[] = [];
  let compared = 0;
  let differences = 0;

  for (const [legacyTable, decl] of Object.entries(LEGACY_COLUMN_MAP)) {
    const reports: Record<string, ColumnReport> = {};
    tables[legacyTable] = reports;
    for (const [column, columnDecl] of Object.entries(decl.columns)) {
      reports[column] = {
        fate: columnDecl.fate,
        to: columnDecl.to,
        rows: 0,
        compared: 0,
        matches: 0,
        differences: 0,
        discarded: {},
      };
    }
    const bump = (report: ColumnReport, reason: string, by = 1): void => {
      report.discarded[reason] = (report.discarded[reason] ?? 0) + by;
    };

    if (decl.rowsNotMigrated) {
      const n = unread[legacyTable] ?? 0;
      for (const report of Object.values(reports)) {
        report.rows = n;
        if (n > 0) bump(report, decl.rowsNotMigrated, n);
      }
      continue;
    }

    const rows = rowsByTable[legacyTable];
    if (!rows) throw new Error(`conciliación: no hay filas de origen para ${legacyTable}`);
    for (const row of rows) {
      const skipRow = decl.rowSkip?.(row, ctx) ?? null;
      for (const [column, columnDecl] of Object.entries(decl.columns)) {
        const report = reports[column];
        report.rows += 1;
        if (skipRow !== null) {
          bump(report, skipRow);
          continue;
        }
        if (!columnDecl.check) {
          bump(report, columnDecl.to);
          continue;
        }
        const check = columnDecl.check(row, ctx);
        if ('skip' in check) {
          bump(report, check.skip);
          continue;
        }
        for (const expectation of check) {
          report.compared += 1;
          compared += 1;
          const outcome = satisfied(reader, expectation);
          if (outcome === 'ok') {
            report.matches += 1;
            continue;
          }
          report.differences += 1;
          differences += 1;
          if (sample.length < MAX_SAMPLE) {
            sample.push({
              legacyTable,
              legacyId: typeof row.id === 'number' ? row.id : String(row.id),
              column,
              target: `${expectation.table}.${expectation.column}`,
              kind: outcome,
            });
          }
        }
      }
    }
  }
  return { tables, compared, differences, sample };
}
