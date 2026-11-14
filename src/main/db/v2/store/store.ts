import { and, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { HybridClock, Clock } from '../../../../shared/sync/clock';
import {
  DELETED_COLUMN,
  changedColumns,
  clocksAfterPatch,
  clocksForNewRow,
  compactClocks,
  expandClocks,
  parseSyncFields,
  type RowClocks,
} from '../../../../shared/sync/fieldClocks';
import {
  isSyncedTableName,
  registry,
  syncedEntries,
  type SyncedTableEntry,
  type SyncedTableName,
} from '../registry';
import { playthroughs, sessions } from '../schema';
import { normalizeValues, tableInfo, type TableInfo } from './columns';
import { isStoreError, StoreError } from './errors';
import { idForNewRow } from './ids';
import { foreignWriteAllowed, type ForeignWrite, type ForeignWriteRule } from './owner';
import type {
  CreateResult,
  CreateValues,
  DataColumnOf,
  LocalDb,
  PatchResult,
  PatchValues,
  RemoveResult,
  RowRef,
  StoreChange,
  StoreChangeListener,
} from './types';

// La puerta única de escritura (AFTERPLAY-2.0.md §8.6).
//
// TODAS las escrituras locales a tablas sincronizadas pasan por aquí. Si una
// sola se la saltara, su cambio no llevaría reloj ni `syncDirty` y no subiría
// nunca (o subiría con relojes viejos y perdería en la fusión). La puerta:
// - compara el parche con la fila y solo da reloj nuevo a lo que cambia (F-33);
// - crea filas con `BOTTOM` en lo no indicado (H-2);
// - convierte los borrados en lápidas y marca a los hijos (§7.7);
// - impone las reglas locales que no pueden ser restricciones de la base:
//   el dueño de las filas O (§7.1) y una sesión abierta por objetivo (§7.7);
// - avisa de lo que cambió cuando la transacción se confirma (§15.4, §8.5).
//
// No fusiona réplicas ni habla con el hub: eso es el motor de sync (fase 3),
// que aplicará las filas recibidas por su cuenta y no pasa por estas reglas.
//
// Todo es síncrono, como el driver (§8.9): una escritura es una transacción
// de SQLite completa antes de devolver, sin `await` por medio.

export interface WriteStoreOptions {
  readonly db: LocalDb;
  readonly clock: HybridClock;
  /** El `machineId` de este dispositivo (D-11): dueño de sus filas O. */
  readonly deviceId: string;
  /** Reloj de pared para los UUIDv7. Por defecto `Date.now`. */
  readonly wall?: () => number;
  /** Excepciones a la regla del dueño (fase 4). Ver `ForeignWriteRule`. */
  readonly foreignWriteRules?: readonly ForeignWriteRule[];
  /** Qué hacer si un oyente de cambios lanza. Por defecto, `console.error`. */
  readonly onListenerError?: (error: unknown) => void;
}

type StoredRow = Record<string, unknown> & {
  id: string;
  syncCreated: Clock;
  syncUpdated: Clock;
  syncFields: unknown;
  syncDeleted: Clock | null;
};

/**
 * Cómo llega una escritura a `applyChanges`, que decide qué reglas aplican:
 * - `create`: "escribir encima" de una fila que ya existía; el dueño ya se
 *   comprobó sobre los valores y las columnas del id coinciden por construcción;
 * - `patch`: parche de quien llama, con todas las reglas;
 * - `cascade`: lápida a un hijo al borrar el padre (sin regla del dueño);
 * - `nullify`: anular una referencia al borrar el padre (el dueño ya se
 *   comprobó antes de empezar a escribir).
 */
type WriteMode = 'create' | 'patch' | 'cascade' | 'nullify';

/** Un padre del registro de una tabla (la entrada `children` vista desde el hijo). */
interface ParentLink {
  readonly parent: SyncedTableEntry;
  readonly column: string;
  readonly onlyWhereNull: string | undefined;
}

/** Columnas de una sesión que deciden si está abierta y para qué objetivo. */
const SESSION_STATE_COLUMNS = ['endedAt', 'playthroughId', 'emulatorId', DELETED_COLUMN];

export class WriteStore {
  private readonly db: LocalDb;
  private readonly clock: HybridClock;
  private readonly deviceId: string;
  private readonly wall: () => number;
  private readonly rules: readonly ForeignWriteRule[];
  private readonly onListenerError: (error: unknown) => void;
  private readonly listeners = new Set<StoreChangeListener>();
  private readonly immutableCache = new Map<string, ReadonlySet<string>>();
  private readonly readById = new Map<string, { get(values: { id: string }): unknown }>();
  private readonly parentCache = new Map<string, readonly ParentLink[]>();

  /** Profundidad de `transaction`: 0 = fuera de toda transacción de la puerta. */
  private depth = 0;
  /**
   * Revisión, hallazgo 3: una función de `transaction` devolvió una promesa.
   * Hasta que el control vuelva al bucle de eventos, toda escritura lanza: lo
   * que esa función hiciera tras su primer `await` correría fuera de la
   * transacción ya deshecha y se confirmaría suelto.
   */
  private poisoned = false;
  /**
   * Revisión, hallazgo 4: SQLite deshizo la transacción exterior por su cuenta
   * (SQLITE_FULL, IOERR, NOMEM…). Guarda el error original; mientras la
   * transacción exterior no termine, toda escritura lanza.
   */
  private aborted: { readonly cause: unknown } | null = null;
  /** Lo tocado en la transacción en curso, para avisar al confirmarla. */
  private pending = new Map<SyncedTableName, Set<string>>();

  constructor(options: WriteStoreOptions) {
    if (options.deviceId.length === 0) throw new Error('WriteStore: deviceId vacío');
    this.db = options.db;
    this.clock = options.clock;
    this.deviceId = options.deviceId;
    this.wall = options.wall ?? Date.now;
    this.rules = options.foreignWriteRules ?? [];
    this.onListenerError =
      options.onListenerError ??
      ((error) => console.error('[store] un oyente de cambios ha fallado', error));
  }

  // ── Escrituras ────────────────────────────────────────────────────────────

  /**
   * Crea una fila (§7.2, §8.3).
   *
   * - Las columnas indicadas llevan el reloj de creación; las no indicadas,
   *   `BOTTOM`, también las que tienen DEFAULT en el esquema (se escribe el
   *   DEFAULT, pero como "nadie lo ha escrito"). Así, si dos PCs crean offline
   *   la misma fila de id determinista, el segundo no pisa con valores por
   *   defecto lo que el primero escribió después (H-2). Indicar `null` SÍ es
   *   indicar: si a quien llama no le consta un valor, debe omitirlo; si le
   *   importa uno igual al DEFAULT, debe escribirlo para que lleve reloj.
   * - Si la fila ya existe (id determinista, compuesto o `given`), no es un
   *   error: se comporta como un parche con los valores indicados, y lo no
   *   indicado se queda como estaba. Si tenía lápida, resucita (§8.3.3) con
   *   los valores que tuviera; sus hijos siguen borrados.
   * - Con id aleatorio, que exista es un error (`exists`).
   */
  create<N extends SyncedTableName>(table: N, values: CreateValues<N>): CreateResult<N> {
    return this.transaction(() => {
      const entry = this.entryOf(table);
      const info = tableInfo(entry.table);
      const { id: requested, ...rest } = values as Record<string, unknown>;
      const normalized = normalizeValues(info, rest);
      this.assertComplete(info, normalized);
      const { id, random } = idForNewRow(entry, normalized, requested, this.wall);
      if (entry.owner) {
        const owner = normalized[entry.owner.column];
        const write: ForeignWrite = { kind: 'create', table, values: normalized };
        if (owner !== this.deviceId && !foreignWriteAllowed(write, this.rules)) {
          throw new StoreError(
            'not_owner',
            `${table}: no se puede crear una fila de otro dispositivo (${String(owner)})`,
          );
        }
      }

      const existing = this.readRow(entry, info, id);
      if (existing) {
        if (random) throw new StoreError('exists', `${table}: ya existe una fila con id ${id}`);
        const wasDeleted = existing.syncDeleted !== null;
        const changes = wasDeleted ? { ...normalized, [DELETED_COLUMN]: null } : normalized;
        const changed = this.applyChanges(entry, info, existing, changes, 'create');
        return {
          id,
          outcome: wasDeleted ? 'resurrected' : changed.length > 0 ? 'updated' : 'unchanged',
          changed: dataColumns<N>(changed),
        };
      }

      this.assertParentsAlive(entry, normalized, null);
      if (table === 'sessions') {
        this.assertSingleOpenSession(id, { ...normalized, [DELETED_COLUMN]: null }, null);
      }
      const clock = this.clock.now();
      const provided = Object.keys(normalized);
      const { clocks } = clocksForNewRow(clock, info.dataColumns, provided);
      this.db
        .insert(entry.table)
        .values({
          ...normalized,
          id,
          syncCreated: clock,
          syncUpdated: clock,
          syncFields: compactClocks(clock, clocks, info.dataColumns),
          syncDeleted: null,
          syncDirty: true,
        })
        .run();
      this.record(table, id);
      return { id, outcome: 'created', changed: dataColumns<N>(provided) };
    });
  }

  /**
   * Parchea una fila viva. Solo las columnas que de verdad cambian reciben
   * reloj nuevo; si no cambia nada, no escribe, no gasta reloj y no marca
   * `syncDirty` (F-33). Devuelve las columnas que cambiaron.
   *
   * Una fila inexistente (`not_found`) o con lápida (`deleted`) es un error y
   * no un no-op: quien parchea cree que la fila está viva, y tragarse el
   * parche escondería el fallo (o, con lápida, una edición sobre algo que otro
   * PC acaba de borrar y que la interfaz debe contar). Para volver a dar vida
   * a una fila está `create`, que es lo que §8.3.3 entiende por resucitar.
   *
   * No se pueden cambiar las columnas que forman un id determinista o
   * compuesto, ni el dueño de una fila O (`immutable`): el id dejaría de
   * corresponder a su contenido, y cambiar `deviceId` sería regalar la fila a
   * otro dispositivo saltándose la regla del dueño.
   */
  patch<N extends SyncedTableName>(table: N, id: string, changes: PatchValues<N>): PatchResult<N> {
    return this.transaction(() => {
      const entry = this.entryOf(table);
      const info = tableInfo(entry.table);
      const normalized = normalizeValues(info, changes as Record<string, unknown>);
      for (const [column, value] of Object.entries(normalized)) {
        if (value === null && info.columns.get(column)?.notNull) {
          throw new StoreError('incomplete', `${table}.${column}: no admite null`);
        }
      }
      const row = this.readRow(entry, info, id);
      if (!row) throw new StoreError('not_found', `${table}: no existe la fila ${id}`);
      if (row.syncDeleted !== null) {
        throw new StoreError('deleted', `${table}: la fila ${id} está borrada`);
      }
      return { changed: dataColumns<N>(this.applyChanges(entry, info, row, normalized, 'patch')) };
    });
  }

  /**
   * Pone la lápida a una fila y, en la misma transacción, a sus hijos del
   * registro (recursivo: juego → playthroughs → eventos y sesiones…), y anula
   * las referencias marcadas `nullify` (§7.7). Toda la operación lleva un
   * único reloj.
   *
   * - Idempotente: si la fila ya tiene lápida no escribe nada (ni repasa la
   *   cascada: sus hijos se marcaron al borrarla, y un hijo que llegase vivo
   *   después por sync ya lo trata como borrado la regla de lectura, F-11).
   * - Solo toca filas vivas: los hijos o referencias ya borrados se dejan.
   * - La cascada alcanza filas O de otros dispositivos, sesiones abiertas
   *   incluidas: es la decisión explícita del usuario (ver `owner.ts`).
   * - La fila pedida sí pasa por la regla del dueño: la sesión de otro PC solo
   *   se borra directamente si está cerrada.
   */
  remove<N extends SyncedTableName>(table: N, id: string): RemoveResult {
    return this.transaction(() => {
      const entry = this.entryOf(table);
      if (!entry.deletable) {
        throw new StoreError('not_deletable', `${table}: sus filas no se borran`);
      }
      const info = tableInfo(entry.table);
      const row = this.readRow(entry, info, id);
      if (!row) throw new StoreError('not_found', `${table}: no existe la fila ${id}`);
      if (row.syncDeleted !== null) return { removed: [], nullified: [] };
      if (entry.owner && row[entry.owner.column] !== this.deviceId) {
        if (!foreignWriteAllowed({ kind: 'remove', table, row }, this.rules)) {
          throw new StoreError('not_owner', `${table}: la fila ${id} es de otro dispositivo`);
        }
      }

      // 1. El árbol de filas vivas que reciben lápida.
      type Target = { entry: SyncedTableEntry; info: TableInfo; row: StoredRow };
      const doomed: Target[] = [];
      const seen = new Set<string>();
      const keyOf = (name: string, rowId: string): string => `${name}\u0000${rowId}`;
      const visit = (target: Target): void => {
        const key = keyOf(target.entry.name, target.row.id);
        if (seen.has(key)) return;
        seen.add(key);
        doomed.push(target);
        for (const child of target.entry.children) {
          const childEntry = this.entryOf(child.table);
          const childInfo = tableInfo(childEntry.table);
          const conditions: SQL[] = [
            eq(this.columnOf(childInfo, child.column), target.row.id),
            isNull(childInfo.deletedColumn),
          ];
          if (child.onlyWhereNull) {
            conditions.push(isNull(this.columnOf(childInfo, child.onlyWhereNull)));
          }
          for (const childRow of this.readRows(childEntry, and(...conditions))) {
            visit({ entry: childEntry, info: childInfo, row: childRow });
          }
        }
      };
      visit({ entry, info, row });

      // 2. Las referencias vivas que hay que anular, agrupadas por fila: una
      // fila que apunta a dos padres borrados recibe un solo parche.
      const toNullify = new Map<string, Target & { columns: Set<string> }>();
      for (const target of doomed) {
        for (const ref of target.entry.references) {
          if (ref.onParentDelete !== 'nullify') continue;
          const refEntry = this.entryOf(ref.table);
          const refInfo = tableInfo(refEntry.table);
          const condition = and(
            eq(this.columnOf(refInfo, ref.column), target.row.id),
            isNull(refInfo.deletedColumn),
          );
          for (const refRow of this.readRows(refEntry, condition)) {
            const key = keyOf(refEntry.name, refRow.id);
            if (seen.has(key)) continue; // recibe lápida en esta misma operación
            const found = toNullify.get(key);
            if (found) found.columns.add(ref.column);
            else
              toNullify.set(key, {
                entry: refEntry,
                info: refInfo,
                row: refRow,
                columns: new Set([ref.column]),
              });
          }
        }
      }
      // La regla del dueño de las anulaciones se comprueba ANTES de escribir
      // nada: si fallase a mitad, quien capture el error dentro de una
      // transacción más grande se quedaría con media cascada.
      for (const target of toNullify.values()) {
        this.assertOwnerForPatch(target.entry, target.row, [...target.columns]);
      }

      // 3. Un solo reloj para toda la operación, mayor que el de todas las
      // filas tocadas (si no, la lápida perdería contra su propio pasado).
      for (const target of [...doomed, ...toNullify.values()]) {
        this.clock.observe(target.row.syncUpdated);
      }
      const clock = this.clock.now();
      const now = (): Clock => clock;
      for (const target of doomed) {
        this.applyChanges(
          target.entry,
          target.info,
          target.row,
          { [DELETED_COLUMN]: clock },
          'cascade',
          now,
        );
      }
      const nullified: (RowRef & { columns: string[] })[] = [];
      for (const target of toNullify.values()) {
        const columns = [...target.columns];
        const changes = Object.fromEntries(columns.map((column) => [column, null]));
        this.applyChanges(target.entry, target.info, target.row, changes, 'nullify', now);
        nullified.push({ table: target.entry.name as SyncedTableName, id: target.row.id, columns });
      }
      return {
        removed: doomed.map((target) => ({
          table: target.entry.name as SyncedTableName,
          id: target.row.id,
        })),
        nullified,
      };
    });
  }

  // ── Transacciones y avisos ────────────────────────────────────────────────

  /**
   * Agrupa varias escrituras de forma atómica. Síncrona, como el driver: si
   * `fn` devuelve una promesa se deshace todo y falla, porque lo que hiciera
   * tras el primer `await` quedaría fuera de la transacción.
   *
   * Anidada, usa un SAVEPOINT: si la interna falla y quien la llama captura el
   * error, se deshace solo la interna (y sus avisos), no la externa.
   *
   * Los relojes siguen siendo estrictamente crecientes y NO retroceden al
   * deshacer: los relojes de lo deshecho quedan sin usar. Retroceder no
   * aportaría nada y podría repetir un reloj ya visto por un oyente o por el
   * motor de sync.
   *
   * No se puede abrir dentro de una transacción ajena (por ejemplo, un
   * `db.transaction` de Drizzle): la puerta no sabría cuándo se confirma y
   * avisaría de cambios que luego se deshacen.
   *
   * Dos defensas de la revisión:
   * - Hallazgo 3: una función `async` se rechaza ANTES de ejecutarla (lo de
   *   antes del primer `await` se desharía y lo de después se escribiría
   *   fuera). Si una función normal devuelve una promesa (llama a otra async),
   *   se deshace todo y la puerta queda bloqueada hasta que el control vuelva
   *   al bucle de eventos, para que la continuación tras el `await` no pueda
   *   escribir. Una continuación que espere a E/S real (un `fetch`) correría
   *   después y ya no estaría bloqueada: la defensa de verdad es el rechazo
   *   previo, y esto cubre el caso en que la promesa llega indirectamente.
   * - Hallazgo 4: si tras un error SQLite ya no está en transacción (la deshizo
   *   entera: disco lleno, E/S, memoria), no hay savepoint al que volver ni
   *   nada que confirmar. La operación exterior queda abortada: toda escritura
   *   posterior lanza `aborted` (con el error original en `cause`) y la
   *   exterior no confirma aunque quien llama capture el error. Sin esto,
   *   `ROLLBACK TO` fallaba con "no such savepoint" tapando el error real, y lo
   *   escrito después se confirmaba suelto, fuera de toda transacción.
   */
  transaction<T>(fn: () => T): T {
    if (this.poisoned) {
      throw new StoreError(
        'transaction',
        'la puerta está bloqueada: una transacción devolvió una promesa y su continuación no puede escribir',
      );
    }
    if (isAsyncFunction(fn)) {
      throw new StoreError(
        'transaction',
        'store.transaction necesita una función síncrona, no async (el driver es síncrono, §8.9)',
      );
    }
    const client = this.db.$client;
    if (this.depth === 0) {
      if (client.isTransaction) {
        throw new StoreError(
          'transaction',
          'la puerta de escritura no puede trabajar dentro de una transacción ajena: usa store.transaction',
        );
      }
      // IMMEDIATE: toma el candado de escritura al empezar. Con DEFERRED, si
      // otro proceso (una herramienta, una segunda instancia) escribiera a la
      // vez, el paso de lectura a escritura fallaría con SQLITE_BUSY sin que
      // busy_timeout pudiera esperar.
      client.exec('BEGIN IMMEDIATE');
      this.depth = 1;
      this.pending = new Map();
      this.aborted = null;
      let result: T;
      try {
        result = this.assertSync(fn());
        // Quien llama pudo capturar el aviso de que la transacción se perdió
        // y devolver con normalidad: no hay nada que confirmar.
        if (this.aborted || !client.isTransaction) throw this.abortedError();
        client.exec('COMMIT');
      } catch (error) {
        if (client.isTransaction) client.exec('ROLLBACK');
        this.pending = new Map();
        throw error;
      } finally {
        this.depth = 0;
        this.aborted = null;
      }
      const change = this.takePending();
      if (change) this.emit(change);
      return result;
    }

    if (this.aborted || !client.isTransaction) throw this.abortedError();
    const savepoint = `store_${this.depth}`;
    const snapshot = clonePending(this.pending);
    client.exec(`SAVEPOINT ${savepoint}`);
    this.depth += 1;
    try {
      const result = this.assertSync(fn());
      client.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      if (this.aborted || !client.isTransaction) {
        // SQLite deshizo la transacción entera: no queda savepoint.
        if (isStoreError(error, 'aborted')) throw error;
        this.aborted ??= { cause: error };
        throw this.abortedError();
      }
      client.exec(`ROLLBACK TO ${savepoint}`);
      client.exec(`RELEASE ${savepoint}`);
      this.pending = snapshot;
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  /**
   * Falla si `fn` devolvió una promesa, y bloquea la puerta hasta la próxima
   * vuelta del bucle de eventos (hallazgo 3; ver `transaction`).
   */
  private assertSync<T>(result: T): T {
    if (!isThenable(result)) return result;
    // Que la promesa rechazada no acabe como "unhandled rejection": quien
    // llama recibe el error de la puerta, no la promesa.
    (result as unknown as Promise<unknown>).then(undefined, () => undefined);
    if (!this.poisoned) {
      this.poisoned = true;
      setImmediate(() => {
        this.poisoned = false;
      });
    }
    throw new StoreError(
      'transaction',
      'store.transaction necesita una función síncrona (el driver es síncrono, §8.9): devolvió una promesa',
    );
  }

  private abortedError(): StoreError {
    this.aborted ??= { cause: undefined };
    return new StoreError(
      'aborted',
      'SQLite ha deshecho la transacción entera (disco lleno, error de E/S o de memoria): ' +
        'no se puede seguir escribiendo en ella ni confirmarla',
      { cause: this.aborted.cause },
    );
  }

  /** Registra un oyente de cambios confirmados. Devuelve la función para quitarlo. */
  onChange(listener: StoreChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Interno ───────────────────────────────────────────────────────────────

  /**
   * Aplica cambios ya normalizados a una fila existente: calcula qué columnas
   * cambian, comprueba las reglas, asigna relojes y escribe SOLO esas columnas
   * más las de §7.3. Escribir la fila entera haría que SQLite comprobase
   * claves foráneas que no se tocan, y a mitad de una descarga puede haber
   * huérfanos legítimos (§7.7, H-4): la edición del usuario fallaría.
   *
   * Devuelve las columnas cambiadas (puede incluir `syncDeleted`).
   */
  private applyChanges(
    entry: SyncedTableEntry,
    info: TableInfo,
    row: StoredRow,
    changes: Readonly<Record<string, unknown>>,
    mode: WriteMode,
    now?: () => Clock,
  ): string[] {
    const name = entry.name as SyncedTableName;
    const changed = changedColumns(row, changes, info.dataColumns);
    if (changed.length === 0) return [];

    if (mode === 'patch') {
      const immutable = this.immutableColumns(entry);
      const touched = changed.filter((column) => immutable.has(column));
      if (touched.length > 0) {
        throw new StoreError('immutable', `${name}: no se puede cambiar ${touched.join(', ')}`);
      }
      this.assertOwnerForPatch(entry, row, changed);
    }
    const next: Record<string, unknown> = { ...row };
    for (const column of changed) next[column] = changes[column];
    // La cascada de `remove` pone lápidas y la anulación quita referencias:
    // ninguna de las dos deja un hijo vivo colgando de otro padre, así que la
    // regla solo mira lo que escribe quien llama (`create` y `patch`).
    if (mode === 'create' || mode === 'patch') {
      this.assertParentsAlive(entry, next, new Set(changed));
    }
    if (name === 'sessions') {
      this.assertSingleOpenSession(row.id, next, changed);
    }

    // Una fila que llegó por sync puede llevar un reloj por delante del
    // nuestro si el motor aún no lo ha observado; observarlo aquí garantiza
    // que la escritura gana a su propio pasado (§8.2).
    if (!now) this.clock.observe(row.syncUpdated);
    const result = clocksAfterPatch(
      this.rowClocks(info, row),
      row,
      changes,
      info.dataColumns,
      now ?? (() => this.clock.now()),
    );
    const set: Record<string, unknown> = {};
    for (const column of changed) set[column] = changes[column];
    set.syncUpdated = result.syncUpdated;
    set.syncFields = compactClocks(row.syncCreated, result.clocks, info.dataColumns);
    set.syncDirty = true;
    this.db.update(entry.table).set(set).where(eq(info.idColumn, row.id)).run();
    this.record(name, row.id);
    return changed;
  }

  private assertOwnerForPatch(
    entry: SyncedTableEntry,
    row: StoredRow,
    columns: readonly string[],
  ): void {
    if (!entry.owner || row[entry.owner.column] === this.deviceId) return;
    const table = entry.name as SyncedTableName;
    if (!foreignWriteAllowed({ kind: 'patch', table, row, columns }, this.rules)) {
      throw new StoreError(
        'not_owner',
        `${table}: la fila ${row.id} es de otro dispositivo; no se puede cambiar ${columns.join(', ')}`,
      );
    }
  }

  /**
   * Revisión, hallazgo 5: un hijo del registro (`children`) no puede quedar
   * VIVO bajo un padre con lápida. La regla de lectura (F-11) lo trataría como
   * borrado, así que desaparecería sin que nadie lo borrase (una sesión movida
   * a un playthrough borrado es tiempo jugado que se esfuma de todas las
   * lecturas), pero seguiría subiendo y ocupando sitio.
   *
   * Solo se comprueba lo que cambia: la columna que apunta al padre, la de
   * `onlyWhereNull` (que decide si la fila es hija) o la lápida de la propia
   * fila (resucitarla). `touched` null = fila nueva, todo cuenta. Así, editar
   * otra columna de un hijo huérfano llegado por sync (F-11, H-4) sigue
   * pudiéndose. Un padre que no existe no es asunto de esta regla: lo decide
   * la clave foránea.
   *
   * No aplica a la cascada de `remove` (pone lápidas) ni al importador, que
   * escribe por debajo de la puerta y crea legítimamente entradas del Plan con
   * lápida y filas cuyos padres pueden estar borrados.
   */
  private assertParentsAlive(
    entry: SyncedTableEntry,
    next: Readonly<Record<string, unknown>>,
    touched: ReadonlySet<string> | null,
  ): void {
    if (next[DELETED_COLUMN] != null) return; // con lápida no es un hijo vivo
    for (const link of this.parentLinks(entry)) {
      if (
        touched &&
        !touched.has(link.column) &&
        !touched.has(DELETED_COLUMN) &&
        !(link.onlyWhereNull !== undefined && touched.has(link.onlyWhereNull))
      ) {
        continue;
      }
      // Con `onlyWhereNull`, la fila solo es hija mientras esa columna sea
      // null (una sesión de emulador ya asignada a un juego no lo es).
      if (link.onlyWhereNull !== undefined && next[link.onlyWhereNull] != null) continue;
      const parentId = next[link.column];
      if (typeof parentId !== 'string') continue;
      const parent = this.readRow(link.parent, tableInfo(link.parent.table), parentId);
      if (parent && parent.syncDeleted !== null) {
        throw new StoreError(
          'parent_deleted',
          `${entry.name}.${link.column}: ${link.parent.name} ${parentId} está borrado`,
        );
      }
    }
  }

  /** Los padres del registro de una tabla: las entradas que la tienen en `children`. */
  private parentLinks(entry: SyncedTableEntry): readonly ParentLink[] {
    const cached = this.parentCache.get(entry.name);
    if (cached) return cached;
    const links: ParentLink[] = [];
    for (const parent of syncedEntries) {
      for (const child of parent.children) {
        if (child.table !== entry.name) continue;
        links.push({ parent, column: child.column, onlyWhereNull: child.onlyWhereNull });
      }
    }
    this.parentCache.set(entry.name, links);
    return links;
  }

  /**
   * "Como mucho una sesión abierta por dispositivo y objetivo" (§7.7). No es
   * un índice único porque no se puede desactivar durante la descarga: una
   * fila ajena que lo violase atascaría el sync (H-4). Solo se impone a las
   * sesiones PROPIAS: las de otros PCs no son asunto de este (§10.4).
   *
   * El objetivo es el juego (§10.4: "una abierta por juego y dispositivo"),
   * no el playthrough: dos playthroughs del mismo juego no se juegan a la vez
   * en el mismo PC. Una sesión de emulador sin asignar tiene por objetivo su
   * emulador.
   */
  private assertSingleOpenSession(
    id: string,
    next: Readonly<Record<string, unknown>>,
    changed: readonly string[] | null,
  ): void {
    if (next.deviceId !== this.deviceId) return;
    if (next.endedAt != null || next[DELETED_COLUMN] != null) return;
    if (changed && !changed.some((column) => SESSION_STATE_COLUMNS.includes(column))) return;

    let target: SQL | undefined;
    let what: string;
    if (typeof next.playthroughId === 'string') {
      const playthrough = this.db
        .select({ gameId: playthroughs.gameId })
        .from(playthroughs)
        .where(eq(playthroughs.id, next.playthroughId))
        .get();
      // Sin playthrough fallará la clave foránea al escribir; no es asunto de esta regla.
      if (!playthrough) return;
      const sameGame = this.db
        .select({ id: playthroughs.id })
        .from(playthroughs)
        .where(eq(playthroughs.gameId, playthrough.gameId));
      target = inArray(sessions.playthroughId, sameGame);
      what = `el juego ${playthrough.gameId}`;
    } else if (typeof next.emulatorId === 'string') {
      target = and(isNull(sessions.playthroughId), eq(sessions.emulatorId, next.emulatorId));
      what = `el emulador ${next.emulatorId}`;
    } else {
      return; // sin objetivo falla el CHECK de la tabla
    }
    const other = this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.deviceId, this.deviceId),
          isNull(sessions.endedAt),
          isNull(sessions.syncDeleted),
          ne(sessions.id, id),
          target,
        ),
      )
      .get();
    if (other) {
      throw new StoreError(
        'open_session',
        `sessions: ya hay una sesión abierta en este dispositivo para ${what} (${other.id})`,
      );
    }
  }

  /** Columnas que no se pueden parchear: las del id calculado y el dueño. */
  private immutableColumns(entry: SyncedTableEntry): ReadonlySet<string> {
    const cached = this.immutableCache.get(entry.name);
    if (cached) return cached;
    const columns = new Set<string>();
    if (entry.owner) columns.add(entry.owner.column);
    const shape = entry.id;
    // Con `fallback: 'random'` (juegos) el id no depende de la columna después
    // de crear la fila: un juego que gana igdbId conserva su id (§7.2).
    if (shape.kind === 'composite' || (shape.kind === 'deterministic' && !shape.fallback)) {
      for (const part of shape.parts) if ('column' in part) columns.add(part.column);
    }
    this.immutableCache.set(entry.name, columns);
    return columns;
  }

  private assertComplete(info: TableInfo, values: Readonly<Record<string, unknown>>): void {
    const missing: string[] = [];
    for (const column of info.columns.values()) {
      if (!column.notNull) continue;
      const value = values[column.name];
      // Con DEFAULT se puede omitir (se escribe el DEFAULT con reloj BOTTOM),
      // pero nunca indicar null: SQLite lo rechazaría más tarde con un
      // mensaje sin contexto.
      if (value === null || (value === undefined && !column.hasDefault)) missing.push(column.name);
    }
    if (missing.length > 0) {
      throw new StoreError('incomplete', `${info.name}: faltan valores para ${missing.join(', ')}`);
    }
  }

  private entryOf(table: string): SyncedTableEntry {
    if (!isSyncedTableName(table)) {
      throw new StoreError('unknown_table', `${table}: no es una tabla sincronizada`);
    }
    return registry[table];
  }

  private columnOf(info: TableInfo, name: string): TableInfo['idColumn'] {
    const column = info.columns.get(name)?.column;
    if (!column) throw new Error(`${info.name}.${name}: columna del registro inexistente`);
    return column;
  }

  private readRow(entry: SyncedTableEntry, info: TableInfo, id: string): StoredRow | undefined {
    // Toda escritura empieza leyendo su fila: la consulta se prepara una vez
    // por tabla (Drizzle compilaría el SQL y SQLite la sentencia en cada
    // llamada).
    let query = this.readById.get(entry.name);
    if (!query) {
      query = this.db
        .select()
        .from(entry.table)
        .where(eq(info.idColumn, sql.placeholder('id')))
        .prepare();
      this.readById.set(entry.name, query);
    }
    return query.get({ id }) as StoredRow | undefined;
  }

  private readRows(entry: SyncedTableEntry, where: SQL | undefined): StoredRow[] {
    return this.db.select().from(entry.table).where(where).all() as StoredRow[];
  }

  private rowClocks(info: TableInfo, row: StoredRow): RowClocks {
    // `parseSyncFields` valida cada reloj: un `syncFields` corrupto debe
    // fallar aquí y no producir relojes que se ordenan mal.
    const syncFields = parseSyncFields(JSON.stringify(row.syncFields ?? {}));
    return {
      syncCreated: row.syncCreated,
      syncUpdated: row.syncUpdated,
      clocks: expandClocks({ syncCreated: row.syncCreated, syncFields }, info.dataColumns),
    };
  }

  private record(table: SyncedTableName, id: string): void {
    let ids = this.pending.get(table);
    if (!ids) {
      ids = new Set();
      this.pending.set(table, ids);
    }
    ids.add(id);
  }

  private takePending(): StoreChange | null {
    const pending = this.pending;
    this.pending = new Map();
    if (pending.size === 0) return null;
    const ids: Partial<Record<SyncedTableName, string[]>> = {};
    for (const [table, set] of pending) ids[table] = [...set];
    return { tables: [...pending.keys()], ids };
  }

  private emit(change: StoreChange): void {
    // La transacción ya está confirmada: si un oyente falla, la escritura no
    // debe parecer fallida a quien la hizo.
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}

const dataColumns = <N extends SyncedTableName>(columns: readonly string[]): DataColumnOf<N>[] =>
  columns.filter((column) => column !== DELETED_COLUMN) as DataColumnOf<N>[];

const clonePending = (
  pending: Map<SyncedTableName, Set<string>>,
): Map<SyncedTableName, Set<string>> =>
  new Map([...pending].map(([table, ids]) => [table, new Set(ids)]));

const isThenable = (value: unknown): boolean =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof (value as { then?: unknown }).then === 'function';

/** ¿Es una función `async` (o un generador async)? Se ven sin ejecutarlas. */
const isAsyncFunction = (fn: unknown): boolean => {
  const tag = Object.prototype.toString.call(fn);
  return tag === '[object AsyncFunction]' || tag === '[object AsyncGeneratorFunction]';
};
